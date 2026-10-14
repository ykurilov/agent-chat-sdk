import type {
  AfterTurnHandler,
  AgentNotice,
  AgentSettings,
  AgentToolsModel,
  AskModel,
  BeforeTurnHandler,
  Chat,
  ChatInstructions,
  ChatService,
  ModelChoice,
  RecordUsage,
  ReplyChecksSetting,
  StateChangedHandler,
  StepContextInput,
} from "@ykurilov/agent-chat-core";
import type { ToolSet } from "ai";
import type { AgentFlow, FlowAfterEnd, FlowSchedule } from "../format/flow-format";
import type { FirstMessagesSetting, FlowEndReason, FlowRun, Transition } from "../engine/flow-run";
import type { StateMap } from "../engine/migrate-run";
import type { FlowDayInfo } from "../engine/flow-days";
import type { FlowFirstReason } from "../engine/nudges";
import type { ChatsInState, ClientCardEntry, ClientFact, FlowChatRecord, FlowStore } from "../store/flow-store";

export type { FlowDayInfo } from "../engine/flow-days";
export type { FlowFirstReason } from "../engine/nudges";

/** Сценарий, по которому идёт чат: приложение хранит графы у себя и отдаёт нужную версию. */
export interface LoadedFlow {
  flowId: string;
  /** Номер версии приложения; чат закрепляется за ней до перевода. */
  versionId: string;
  /** JSON сценария (как сохранил редактор) или уже разобранный. */
  flow: AgentFlow | unknown;
  /** Закрепить чат сразу в этом состоянии (перенос из старой системы). Нет — `start` сценария. */
  stateId?: string;
  /** Когда начался разговор: от него дни и срок сценария. Нет — сейчас. */
  startedAt?: Date;
  /** Когда чат вошёл в `stateId`: от него таймеры ноды. Нет — `startedAt`. */
  enteredAt?: Date;
  // Перенос идущего чата целиком: сроки касаний и потолок дня продолжаются с того места, где их оставила старая система.
  /** Последнее сообщение человека: от него «не завершил» (`giveUpAfter`) и «человек ответил». */
  lastHumanAt?: Date;
  /** Последнее сообщение агента — ответ или касание: от него тишина, касания и утреннее. */
  lastAgentAt?: Date;
  /** Какой шаг ряда касаний `afterSilence` следующий, с 0: сколько касаний уже было после последней реплики человека. Нет — 0. */
  nudgeStep?: number;
  /** Счёт за сегодня по часам человека. */
  today?: FlowTodayCounts;
  /** Пояс человека (IANA, `Europe/Moscow`), если старая система его знает: по нему ночь, «сегодня» и потолок дня до первого хода. */
  timeZone?: string;
}

/** Что уже было сегодня в старой системе: продолжает дневной потолок и рамки дня. */
export interface FlowTodayCounts {
  /** Сколько сообщений агент сегодня написал первым: идут в потолок `maxPerDay`. */
  firstMessages?: number;
  /** Сколько сообщений человек написал за день сценария: идут в рамки дня (`dayFrame`). Только с «Днями и временем». */
  humanMessages?: number;
  /** День закрыт («на сегодня всё»): сегодня агент первым не пишет. Только с «Днями и временем». */
  dayClosed?: boolean;
}

/**
 * Что видит `agent.stepContext` приложения со сценарием: в ходе «пишет первым» — все его причины (касание, утро,
 * переход по таймеру, прощание). Ход на сообщение человека — `firstReasons` нет. Хвост не кэшируется: постоянная
 * инструкция от причины не зависит.
 */
export type FlowStepContextInput = StepContextInput & { firstReasons?: FlowFirstReason[] };

/** Закончить разговор по решению приложения: человека перевели на другой продукт, отдали менеджеру и т. п. */
export interface FlowEndInput {
  ownerId: string;
  chatId: string;
  /** Своя причина («switched»): придёт в `onFinish.reason`, `admit` и `readRun`. */
  reason: string;
  /** Итог словами приложения: придёт в `onFinish.outcome`. */
  outcome?: string;
}

/** Перенести идущий чат сразу, без хода: сценарий и место — как у `loadFlow`. */
export type FlowAdoptInput = LoadedFlow & { ownerId: string; chatId: string };

/** Переход с метками: приложение по ним пишет письмо, зовёт оператора, считает аналитику. */
export interface FlowTransitionEvent extends Transition {
  ownerId: string;
  chatId: string;
  flowId: string;
  versionId: string;
  /** День сценария в момент перехода; без «Дней и времени» — нет поля. */
  day?: FlowDayInfo;
}

/** Место чата для редактора и приложения: плюс день сценария, если у сценария есть «Дни и время». */
export type FlowRunView = FlowRun & { day?: FlowDayInfo };

// ---------- Судья ----------

/** Реплика разговора для судьи: только текст. */
export interface JudgeMessage {
  role: "human" | "agent";
  text: string;
}

export interface JudgeVerdict {
  exitId: string;
  /** Уверенность, 0…1. Запасная модель вероятностей не даёт: 1 или 0. */
  probability: number;
  /** Условие выполнено: уверенность не ниже порога `threshold`. */
  confirmed: boolean;
  /** Кто решил: основной судья или запасная модель. */
  source: "decision" | "fallback";
}

export interface JudgeSettings {
  /** С какой уверенности переходить. По умолчанию 0.7. */
  threshold?: number;
  /** Основной судья. По умолчанию `microsoft/microsoft-decision-1`. */
  model?: string;
  /** Запасная модель каталога приложения: когда основной судья не ответил. */
  fallback: ModelChoice;
  /** Ключ и адрес OpenRouter; не заданы — из окружения сервера. `headers` — свои заголовки запроса (прокси). */
  openrouter?: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> };
  /** Срок основного судьи, мс. По умолчанию 5000. */
  timeoutMs?: number;
}

export interface FlowJudge {
  /**
   * Агент заявил переход — подтвердить или нет. Вероятность приходит и ниже порога (`confirmed: false`).
   * `null` — ни один судья не ответил («не проверено»).
   */
  checkClaim(input: {
    ownerId: string;
    chatId: string;
    exitId: string;
    condition: string;
    /** Цель состояния. */
    goal?: string;
    /** Слова агента при заявке. */
    why?: string;
    messages: JudgeMessage[];
    signal?: AbortSignal;
  }): Promise<JudgeVerdict | null>;
  /** После хода: условия словами, которые выполнены, в порядке `conditions` (своё раньше общего). Пусто — ни одно или не проверено. */
  checkAll(input: {
    ownerId: string;
    chatId: string;
    /** Цель состояния. */
    goal?: string;
    conditions: Array<{ exitId: string; text: string }>;
    messages: JudgeMessage[];
    signal?: AbortSignal;
  }): Promise<JudgeVerdict[]>;
}

// ---------- Таймеры и «писать первым» ----------

export interface FlowTimerSettings {
  /** Как часто смотреть наступившие таймеры, мс. По умолчанию 15 000. */
  tickMs?: number;
  /** Аренда таймера копией сервера, мс. По умолчанию 60 000. */
  leaseMs?: number;
}

export interface FlowTimers {
  start(): void;
  stop(): Promise<void>;
  /** Один обход (тесты, ручной запуск). */
  tick(): Promise<void>;
  /** Пересчитать ближайший таймер чата после хода или перехода. `failedAt` — касание не дошло (часы сервера): срок не раньше. */
  reschedule(input: { ownerId: string; chatId: string; run: FlowRun; branchHead: string | null; failedAt?: number }): Promise<void>;
}

export interface FirstMessageRules {
  /** Можно ли написать первым сейчас; нет — когда повторить (мс) или `null`. */
  check(input: {
    ownerId: string;
    chatId: string;
    at: number;
    timeZone: string;
    /** «Дни и время» сценария: его ночь и потолок главнее настроек приложения, закрытый день — до следующего. */
    schedule?: FlowSchedule;
    /** Запись чата: окно канала, пауза сотрудника, закрытый день — запрет до правил приложения. */
    chat?: Pick<FlowChatRecord, "dayClosedOn" | "pausedUntil" | "windowClosed">;
  }): Promise<{ allowed: true } | { allowed: false; retryAt: number | null }>;
  /** Записать, что агент написал первым. */
  record(input: { ownerId: string; at: number; timeZone: string }): Promise<void>;
}

// ---------- Карточка клиента ----------

/** Ход чата для инструментов карточки: кто говорит, где состояние чата и по какому сценарию идёт разговор. */
export interface CardToolsTurn {
  model: AgentToolsModel;
  /** Сценарий чата; `null` — чат без сценария. */
  flow(): Promise<{ flowId: string; versionId: string; flow: AgentFlow } | null>;
}

export interface ClientCardTools {
  /** `flow_note` и `client_card`: агент записывает узнанное. Функция — инструменты собираются на ход чата. */
  tools: ToolSet | ((turn: CardToolsTurn) => ToolSet);
  /** Блок «что известно о человеке» для запроса. */
  block(input: { ownerId: string; flow: AgentFlow; run: FlowRun }): Promise<string>;
  read(ownerId: string): Promise<ClientCardEntry[]>;
  forget(ownerId: string, fieldId: string | "all"): Promise<void>;
}

/** Свободные факты о человеке в хранилище приложения. Нет — они лежат в таблице модуля вместе с карточкой. */
export interface ClientFactStore {
  read(ownerId: string): Promise<ClientFact[]>;
  /** Записать один факт; ошибка — инструмент ответит агенту «не записано». Тот же `fact.id` — тот же факт. */
  add(input: { ownerId: string; fact: { id: string; text: string }; chatId: string; flowId: string; at: Date }): Promise<void>;
  /** Стереть один факт по `id` или все факты человека. */
  forget(ownerId: string, factId: string | "all"): Promise<void>;
}

/** Карточка клиента в хранилище приложения. Нет — таблица модуля (`store.readCard` и др.), как в 0.48. */
export interface ClientCardStore {
  read(ownerId: string): Promise<ClientCardEntry[]>;
  /** Записать одно поле; ошибка — инструмент ответит агенту «не записано». */
  write(input: { ownerId: string; fieldId: string; value: unknown; chatId: string; flowId: string; at: Date }): Promise<void>;
  forget(ownerId: string, fieldId: string | "all"): Promise<void>;
  /**
   * Свои таблицы фактов (`clientFacts: true`). Нет — факты лежат в таблице модуля. «Стереть всё» зовёт `forget("all")`
   * и здесь, и в полях.
   */
  facts?: ClientFactStore;
}

// ---------- Человек ----------

/** Пояс человека в хранилище приложения. Нет — таблица модуля `flow_people`. */
export interface FlowPeople {
  /** IANA-пояс; не знаем — `null`. */
  readTimeZone(ownerId: string): Promise<string | null>;
  writeTimeZone(ownerId: string, timeZone: string): Promise<void>;
}

// ---------- Доставка в каналы приложения ----------

/** Ответ агента, который он написал первым, для канала приложения. */
export interface FlowOutgoing {
  ownerId: string;
  chatId: string;
  /** Ключ повтора: тот же текст при `retry` уходит с тем же `messageId`. */
  messageId: string;
  /** Готовый, проверенный текст. */
  text: string;
  reasons: FlowFirstReason[];
  /** Номер попытки, с 1. */
  attempt: number;
}

export type FlowDeliveryOutcome =
  | { status: "delivered" }
  /** Человек заблокировал канал: конец разговора `blocked`. */
  | { status: "blocked" }
  /** Канал не принимает сообщения первым (окно ВК): молчать, пока человек не напишет. */
  | { status: "window_closed" }
  /** Повторить тот же текст; нет `afterMs` — по ряду 1 мин · 5 мин · 30 мин. */
  | { status: "retry"; afterMs?: number }
  /** Не доставлено окончательно: текст помечается недоставленным, в счётчик дня не идёт. */
  | { status: "failed" };

/** Каналы приложения: служба чата на чат и, если нужно, своя доставка. */
export interface FlowAttachment {
  /** Служба чата этого разговора: у разных продуктов — разные службы с разной инструкцией. Может отвечать позже (обещанием). */
  portFor: (chat: { ownerId: string; chatId: string }) => FlowPort | Promise<FlowPort>;
  /** Своя доставка ответа, написанного первым. Нет — доставляют каналы SDK, как в 0.48. */
  deliver?: (message: FlowOutgoing) => Promise<FlowDeliveryOutcome>;
}

/** Исход доставки из каналов SDK (`createMessengers({ onAnswerDelivery })`). */
export interface FlowDeliveryReport {
  chatId: string;
  messageId: string;
  outcome: FlowDeliveryOutcome;
}

// ---------- Решение о входящем, пауза, конец ----------

/** Сообщение человека пришло: как с ним поступить. Каналы приложения зовут `admit` до хода. */
export type FlowAdmitDecision =
  | { kind: "answer" }
  /** Ответить готовой фразой, без модели (жёсткая рамка дня). */
  | { kind: "reply"; text: string }
  /** Записать и промолчать до `until`: после жёсткой рамки дня, до начала следующего дня. Ночью агент отвечает. */
  | { kind: "hold"; until: Date }
  /**
   * Разговор закончен. Каналы SDK сами ответят по общей части сценария (→ В6); канал приложения решает сам: ответить
   * (ход как обычно), промолчать или передать во «Входящие».
   */
  | { kind: "ended"; reason: FlowEndReason; afterEnd: FlowAfterEnd }
  /** Отвечает живой сотрудник: агент молчит. */
  | { kind: "paused" };

/** Перемотка тестового чата: на `ms` или до начала следующего дня сценария. */
export type FlowTestClockInput = { ownerId: string; chatId: string } & ({ ms: number; to?: undefined } | { to: "next_day_start"; ms?: undefined });

export interface FlowAdmitInput {
  ownerId: string;
  chatId: string;
  text?: string;
}

/** Пауза «отвечает живой сотрудник» (→ В4). */
export interface FlowPauseSettings {
  /** Пауза снимается сама через столько часов молчания сотрудника; каждый ответ сотрудника продлевает. По умолчанию 2. */
  staffSilenceHours?: number;
}

/** Сотрудник ответил человеку вручную (→ В4). */
export interface FlowStaffReply {
  ownerId: string;
  chatId: string;
  /** Что он написал: агент увидит это в своём контексте и продолжит, не противореча. Нет — только продление паузы. */
  text?: string;
}

export interface FlowPauseInput {
  ownerId: string;
  chatId: string;
  /** До какого момента; нет — `staffSilenceHours` от сейчас. */
  until?: Date;
}

/** Разговор закончился: срок вышел, конечная нода, человек ушёл или заблокировал канал. */
export interface FlowFinish {
  ownerId: string;
  chatId: string;
  flowId: string;
  versionId: string;
  reason: FlowEndReason;
  /** Итог словами приложения: передан в `flow.end`. Других концов — нет. */
  outcome?: string;
  /** День сценария; без «Дней и времени» — `null`. */
  day: number | null;
  /** Нода, в которой закончился разговор. */
  state: string;
  /** Метки этой ноды: итог разговора («записался», «отказ»). */
  tags: string[];
  /**
   * Место в сценарии на момент конца: путь, заметки чата (`notes`), счётчики. Вместе с карточкой человека
   * (`readClientCard(ownerId)`) — всё, чтобы передать человека дальше.
   */
  run: FlowRun;
  at: Date;
}

// ---------- Перевод чатов на новую версию ----------

export interface MigrateChatsInput {
  flowId: string;
  toVersionId: string;
  /** Куда перевести чаты из состояний, которых нет в новой версии: id старого → id нового. */
  map: StateMap;
  /**
   * Сценарий новой версии (JSON или разобранный). Нужен, если по этой версии ещё не шёл ни один чат: SDK сохранит копию.
   * Версия уже сохранена — должна совпасть.
   */
  flow?: AgentFlow | unknown;
}

export interface ChatMigrator {
  /** Сколько чатов в каких состояниях; `exceptVersionId` — без чатов, которые уже на этой версии. */
  chatsByState(flowId: string, options?: { exceptVersionId?: string }): Promise<ChatsInState[]>;
  /** Переводит пачками; чаты применят перевод в начале своего следующего хода. */
  migrateChats(input: MigrateChatsInput): Promise<{ moved: number }>;
}

// ---------- Подключение ----------

/** Что сценарию нужно от службы чата. Приложение передаёт её в `attach` после `createChatServer`. */
export type FlowPort = Pick<ChatService, "deliverNotices" | "getChatState" | "peekHistory" | "getChatData" | "updateChatData" | "assertWithinLimit" | "markUndelivered"> &
  /** Поток идущего хода: перемотка часов тестового чата ждёт по нему конца хода. */
  Partial<Pick<ChatService, "subscribe">> & {
  askModel: AskModel;
  recordUsage: RecordUsage;
};

/** Часть настроек службы чата, которую `withChat` дополняет; остальное проходит как есть. */
export interface FlowChatOptions {
  agent: AgentSettings;
  chatInstructions?: ChatInstructions;
  privateStateKeys?: string[];
  /** Свои ворота приложения идут первыми; пропустили — решение сценария (рамки дня, пауза). */
  beforeTurn?: BeforeTurnHandler;
  afterTurn?: AfterTurnHandler;
  onStateChanged?: StateChangedHandler;
  /**
   * Проверки ответа службы (`createChatService({ replyChecks })`). С ними `withChat` добавляет тексты сценария чата
   * (`flowKnownTexts`) к `knownTexts`: ссылка из первого сообщения или прощания не считается выдуманной. Нет — не трогается.
   */
  replyChecks?: ReplyChecksSetting;
}

export interface AgentFlowOptions {
  /** Какой сценарий у чата; `null` — чат без сценария. Зовётся, пока чат не закреплён за версией. */
  loadFlow: (input: { ownerId: string; chat: Chat }) => Promise<LoadedFlow | null>;
  /** `memoryFlowStore()`, `sqliteFlowStore(path)`, `postgresFlowStore(pool)`. */
  store: FlowStore;
  judge: JudgeSettings;
  /** Правила «писать первым». По умолчанию тихие часы 21:00–09:00 и не больше 3 в сутки; `false` — без ограничений; запрет — `canWriteNow`, вернувший `false`. */
  firstMessages?: FirstMessagesSetting;
  onTransition?: (event: FlowTransitionEvent) => void | Promise<void>;
  /** Разговор закончился (`final`, `deadline`, `abandoned`, `blocked`). Ошибка приложения не ломает сценарий. */
  onFinish?: (event: FlowFinish) => void | Promise<void>;
  /** Карточка клиента в хранилище приложения. Нет — таблица модуля. */
  clientCard?: ClientCardStore;
  /**
   * Свободные факты о человеке в карточке («ведёт блог»): агент пишет их тем же `flow_note { fact }`, блок `flow:client`
   * показывает, «забудь» стирает. В инструкции появляется правило, как делить факты и долгую память SDK. По умолчанию нет.
   */
  clientFacts?: boolean;
  /** Пояс человека в хранилище приложения. Нет — таблица модуля. */
  people?: FlowPeople;
  pause?: FlowPauseSettings;
  timers?: FlowTimerSettings;
  logError?: (message: string) => void;
  /** Часы; для тестов. */
  now?: () => Date;
}

/** Событие приложения вне хода: кнопка страницы, оплата, событие сервера. */
export interface FlowSignalInput {
  ownerId: string;
  chatId: string;
  name: string;
  data?: unknown;
  /** Разбудить агента: он ответит сразу. Нет — переход применится в начале следующего хода. */
  wakeAgent?: boolean;
}

export interface AgentFlowHandle {
  /** Склеивает сценарий с настройками службы чата: инструкция, инструменты, блоки, `prepareTurn`, `afterTurn`. */
  withChat<T extends FlowChatOptions>(options: T): T;
  /** Служба чата (`attach(service)`, как в 0.48) или служба на чат и своя доставка. */
  attach(target: FlowPort | FlowAttachment): void;
  signal(input: FlowSignalInput): Promise<void>;
  /**
   * Закрепить идущий чат за сценарием сразу, не дожидаясь хода: место, последние реплики, шаг касаний и счёт дня — из
   * старой системы, таймер касаний ставится тут же. Чат уже закреплён — `adopted: false`, ничего не меняется. Сценарий с
   * ошибками или нет состояния — исключение. Чат должен быть в службе чата (`createChat`).
   */
  adopt(input: FlowAdoptInput): Promise<{ adopted: boolean }>;
  /**
   * Закончить разговор сейчас со своей причиной: событие `onFinish`, как у остальных концов; сроки и касания сняты, место
   * остаётся в своей ноде; дальше — как настроено `afterEnd`. Уже законченный или чат не по сценарию — `ended: false`.
   */
  end(input: FlowEndInput): Promise<{ ended: boolean }>;
  /** Сообщение человека в канале приложения: отвечать, ответить готовой фразой, промолчать. Звать до хода. */
  admit(input: FlowAdmitInput): Promise<FlowAdmitDecision>;
  /** Отвечает живой сотрудник: агент молчит, таймеры и касания стоят. */
  pause(input: FlowPauseInput): Promise<void>;
  resume(input: { ownerId: string; chatId: string }): Promise<void>;
  /** Сотрудник ответил человеку: пауза продлевается на `staffSilenceHours`, его реплика — в контекст агента. */
  noteStaffReply(input: FlowStaffReply): Promise<void>;
  /** Исход доставки ответа из каналов SDK (`onAnswerDelivery`). */
  reportDelivery(input: FlowDeliveryReport): Promise<void>;
  readRun(ownerId: string, chatId: string): Promise<FlowRunView | null>;
  chatsByState: ChatMigrator["chatsByState"];
  migrateChats: ChatMigrator["migrateChats"];
  readClientCard: ClientCardTools["read"];
  forgetClientCard: ClientCardTools["forget"];
  /**
   * Тестовый чат редактора (создан с `flowTestChatData()`): промотать его часы вперёд на `ms` или до начала следующего
   * дня сценария (`to: "next_day_start"`, по часам человека). Наступивший таймер срабатывает сразу; ответ ждёт конца
   * его хода. Рабочий чат — ошибка.
   */
  advanceTestClock(input: FlowTestClockInput): Promise<{ timeOffset: number }>;
  start(): void;
  stop(): Promise<void>;
  /** Дождаться фоновой работы: судья после хода, доставка, `onTransition`, `onFinish`. Для тестов и остановки. */
  settled(): Promise<void>;
}

/** Служебное сообщение сценария для модели: вид `app` ядра. */
export type FlowNotice = AgentNotice & { kind: "app" };
