import type {
  AfterTurnHandler,
  AgentNotice,
  AgentSettings,
  AppNoticeViews,
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
  StoredMessage,
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

/** Открыть законченный разговор заново (`flow.reopen`). С 0.68. */
export interface FlowReopenInput {
  ownerId: string;
  chatId: string;
  /** Почему открыт, словами приложения: придёт в `onReopen.reason`. */
  reason?: string;
  /** Открыть, только если разговор закончился не раньше этого момента; раньше — `ended_too_long_ago`. Политика давности — приложения. */
  endedAfter?: Date;
}

/**
 * Почему разговор не открыт: не по сценарию (`not_flow`), не закончен или уже открыт другим вызовом (`not_ended`), конец,
 * который не открывается (`final`, `deadline`, `blocked`), срок программы уже вышел (`deadline_passed`), закончился раньше
 * `endedAfter` (`ended_too_long_ago`).
 */
export type FlowReopenRefusal = "not_flow" | "not_ended" | "final" | "deadline" | "blocked" | "deadline_passed" | "ended_too_long_ago";

export type FlowReopenResult = { reopened: true } | { reopened: false; reason: FlowReopenRefusal };

/** Разговор открыт заново: приложение возвращает статус «идёт». */
export interface FlowReopen {
  ownerId: string;
  chatId: string;
  flowId: string;
  versionId: string;
  /** Чем разговор кончился: `abandoned` или своя причина приложения. */
  endReason: FlowEndReason;
  endedAt: Date;
  /** Причина открытия из `flow.reopen`. */
  reason?: string;
  /** День программы сейчас, от исходного старта; без «Дней и времени» — `null`. */
  day: number | null;
  /** Нода, где разговор продолжается: та, где кончился. */
  state: string;
  tags: string[];
  /** Место после открытия: путь с записью «открыт заново», заметки, счётчики. */
  run: FlowRun;
  at: Date;
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
  /**
   * Журнал входа судьи, с 0.62: что ушло (цель, реплики, условия — усечённо, без ключей) и что ответил — в `logJudge`.
   * По умолчанию тексты реплик пишутся только в тестовом чате редактора, каждый вопрос. Боевой переход по судье —
   * запись без текстов реплик и слов агента: выход, вероятность, число и длины реплик. Реплики людей бывают с паролями
   * и телефонами, а журнал сервера общий. `"transitions"` — боевые переходы с текстами; `"always"` — каждый вопрос с
   * текстами; `"off"` — никогда.
   */
  journal?: "transitions" | "always" | "off";
}

/** Запись журнала судьи: один вопрос и ответ. Тексты усечены до 300 знаков. */
export interface FlowJudgeEntry {
  ownerId: string;
  chatId: string;
  /** `after_turn` — судья после хода, `claim` — заявка агента `flow_exit`. */
  kind: "after_turn" | "claim";
  model: string;
  threshold: number;
  /** Кто ответил; `null` — ни основной судья, ни запасная модель. */
  source: "decision" | "fallback" | null;
  goal?: string;
  /** Слова агента при заявке; только в записи с текстами. */
  agentWords?: string;
  /** Реплики, которые видел судья. Нет — запись без текстов (по умолчанию у боевых переходов). */
  conversation?: JudgeMessage[];
  /** Число реплик и длина каждой, как её видел судья. */
  replies: Array<{ role: JudgeMessage["role"]; length: number }>;
  /** Условия в порядке вопроса; `probability: null` — ответа нет. */
  conditions: Array<{ exitId: string; text: string; probability: number | null; confirmed: boolean }>;
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
    /** Тестовый чат редактора: журнал судьи пишется всегда. */
    testChat?: boolean;
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
    /** Тестовый чат редактора: журнал судьи пишется всегда. */
    testChat?: boolean;
  }): Promise<JudgeVerdict[]>;
}

// ---------- Таймеры и «писать первым» ----------

export interface FlowTimerSettings {
  /** Как часто смотреть наступившие таймеры, мс. По умолчанию 15 000. */
  tickMs?: number;
  /** Аренда таймера копией сервера, мс. По умолчанию 60 000. */
  leaseMs?: number;
  /**
   * Мягкий потолок ходов сервера подряд без сообщения человека (касания, переходы по таймерам), с 0.53. Дошли — строка в
   * журнал, касания и переходы по таймерам ждут сообщения человека; «срок вышел» и «не завершил» — в свой срок.
   * По умолчанию 50; `false` — без потолка.
   */
  maxServerTurnsInRow?: number | false;
}

export interface FlowTimers {
  start(): void;
  stop(): Promise<void>;
  /** Один обход (тесты, ручной запуск). */
  tick(): Promise<void>;
  /** Пересчитать ближайший таймер чата после хода или перехода. `failedAt` — касание не дошло (часы сервера): срок не раньше. */
  reschedule(input: { ownerId: string; chatId: string; run: FlowRun; branchHead: string | null; failedAt?: number }): Promise<void>;
  /** Слушать, что сработало по таймеру чата (ход «пишет первым», «срок вышел», «не завершил»); возврат — отписка. */
  watch?(chatId: string, onFired: (fired: FlowTestClockReason) => void): () => void;
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
    /** День программы этого чата (как `flowDay`): по нему потолок `maxPerDayByDay`. */
    programDay?: number;
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
  /** Готовый, проверенный текст: текстовые части ответа подряд. */
  text: string;
  /**
   * Все части ответа, которые надо доставить человеку (с 0.53): текст, файлы, вызовы инструментов с результатом —
   * карточка ролика (`tool-show_video`), картинка, виджет. Без рассуждений модели и служебных частей (`deliverableParts`).
   * Карточки строит приложение, как для обычного ответа.
   */
  parts: StoredMessage["parts"];
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
  | { status: "failed" }
  /**
   * Канал сломан и ждёт починки снаружи (например, отозван токен бота): ответ ждёт, попытка не тратится, сроков нет.
   * Починили — `resumeDelivery`. Только для своей доставки (`attach({ deliver })`). С 0.81.
   */
  | { status: "await_repair" };

/** Каналы приложения: служба чата на чат и, если нужно, своя доставка. */
export interface FlowAttachment {
  /** Служба чата этого разговора: у разных продуктов — разные службы с разной инструкцией. Может отвечать позже (обещанием). */
  portFor: (chat: { ownerId: string; chatId: string }) => FlowPort | Promise<FlowPort>;
  /** Своя доставка ответа, написанного первым. Нет — доставляют каналы SDK, как в 0.48. */
  deliver?: (message: FlowOutgoing) => Promise<FlowDeliveryOutcome>;
}

/** Исход доставки из каналов SDK (`createMessengers({ onAnswerDelivery })`). Каналы SDK повторяют сами: `await_repair` нет. */
export interface FlowDeliveryReport {
  chatId: string;
  messageId: string;
  outcome: Exclude<FlowDeliveryOutcome, { status: "await_repair" }>;
}

/** Канал починили: отправить ответ, который ждал починки (`await_repair`). */
export interface FlowResumeDeliveryInput {
  ownerId: string;
  chatId: string;
  messageId: string;
}

/**
 * `resumed` — отправка поставлена таймеру (сам `deliver` позже, не в этом вызове); `pending` — уже не ждёт починки
 * (возобновлена раньше, идёт или ждёт повтора); `busy` — у чата живая аренда, повторить позже; `not_found` — такого
 * ожидания у этого человека нет; `dropped` — ответ устарел (его нет в ветке или человек уже написал после него): снят без
 * отправки и без засчитывания.
 */
export type FlowResumeDeliveryResult = "resumed" | "pending" | "busy" | "not_found" | "dropped";

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

/**
 * Перемотка тестового чата: на `ms`, до начала следующего дня сценария или ровно к моменту, когда сценарий напишет первым
 * (`next_first_message`, с 0.64).
 */
export type FlowTestClockInput = { ownerId: string; chatId: string } & (
  | { ms: number; to?: undefined }
  | { to: "next_day_start" | "next_first_message"; ms?: undefined }
);

/**
 * Что случилось в момент, куда перемотал `next_first_message`: вид — первая причина хода «пишет первым» (`transition`,
 * `morning`, `silence`…), `deadline` — «срок вышел», `give_up` — «не завершил». `stateId` — нода после срабатывания,
 * `exitId` — выход ноды по таймеру, `reasons` — все причины хода.
 */
export interface FlowTestClockReason {
  kind: FlowFirstReason["kind"] | "deadline" | "give_up";
  stateId: string;
  exitId?: string;
  reasons?: FlowFirstReason[];
}

/** Итог перемотки тестового чата: новый сдвиг часов, мс; у `next_first_message` — что сработало. */
export interface FlowTestClockResult {
  timeOffset: number;
  reason?: FlowTestClockReason;
}

export interface FlowAdmitInput {
  ownerId: string;
  chatId: string;
  text?: string;
  /**
   * Сколько сообщений человека решается разом (пачка, склеенная в один ход): все идут в счёт дня. Пачка доходит до
   * `hardAt` — готовая фраза один раз на всю пачку; начинается уже за ним — молчание. По умолчанию 1.
   */
  messages?: number;
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
  /**
   * Что он написал: ложится в историю сообщением сотрудника (`ChatService.appendStaffMessage`, с 0.53) — агент увидит
   * его в своём контексте и продолжит, не противореча; словами человека оно не считается. Нет — только продление паузы.
   */
  text?: string;
  /** Имя сотрудника (с 0.53): модель и экран назовут его. */
  staffName?: string;
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

/** Чат сценария, который отбор (`filter`) решает считать и переводить или нет. */
export interface FlowChatCandidate {
  chatId: string;
  ownerId: string;
  flowId: string;
  /** Версия, на которой чат сейчас. */
  versionId: string;
  stateId: string;
  /** Разговор закончился (`flow.end`, конец сценария, срок вышел). */
  ended: boolean;
  endReason: FlowEndReason | null;
  /** Тестовый чат редактора (`FlowTestChat`, создан с `flowTestChatData()`). */
  test: boolean;
  /** Данные чата (`Chat.data`): пометки приложения. Чата уже нет в службе — пусто. */
  data: Record<string, unknown>;
}

/**
 * Какие чаты сценария считать и переводить. Одинаково в `chatsByState` и `migrateChats`: что посчитали, то и переведут.
 * По умолчанию закончившиеся разговоры и тестовые чаты редактора не берутся.
 */
export interface FlowChatSelection {
  /** Только эти чаты. */
  chatIds?: string[];
  /** Свой отбор приложения: `false` — чат не считать и не переводить. */
  filter?: (chat: FlowChatCandidate) => boolean | Promise<boolean>;
  /** Брать и закончившиеся разговоры. */
  includeEnded?: boolean;
  /** Брать и тестовые чаты редактора. */
  includeTestChats?: boolean;
}

export interface ChatsByStateOptions extends FlowChatSelection {
  /** Без чатов, которые уже на этой версии. */
  exceptVersionId?: string;
}

export interface MigrateChatsInput extends FlowChatSelection {
  /** Strict: без подходящего SDK receipt чат остаётся на исходной immutable версии. */
  requiresConfirmation?: import("../engine/confirmation").FlowConfirmationRef;
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
  chatsByState(flowId: string, options?: ChatsByStateOptions): Promise<ChatsInState[]>;
  /** Переводит пачками отобранные чаты; они применят перевод в начале своего следующего хода. */
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
  /** Свои проекции пометок приложения для экрана (`createChatService({ appNoticeViews })`): `withChat` добавляет к ним сценарные. */
  appNoticeViews?: AppNoticeViews;
}

export interface AgentFlowOptions {
  /** Серверные подтверждения. Не поля карточки, не инструменты записи фактов и не JSON редактора. */
  confirmations?: readonly import("./confirmations").FlowConfirmationSpec[];
  exitGuards?: readonly import("./confirmations").FlowExitGuard[];
  /** Какой сценарий у чата; `null` — чат без сценария. Зовётся, пока чат не закреплён за версией. */
  loadFlow: (input: { ownerId: string; chat: Chat }) => Promise<LoadedFlow | null>;
  /** `memoryFlowStore()`, `sqliteFlowStore(path)`, `postgresFlowStore(pool)`. */
  store: FlowStore;
  judge: JudgeSettings;
  /** Правила «писать первым». По умолчанию тихие часы 21:00–09:00 и не больше 3 в сутки; `false` — без ограничений; «не сейчас» — `canWriteNow`. */
  firstMessages?: FirstMessagesSetting;
  onTransition?: (event: FlowTransitionEvent) => void | Promise<void>;
  /** Разговор закончился (`final`, `deadline`, `abandoned`, `blocked`). Ошибка приложения не ломает сценарий. */
  onFinish?: (event: FlowFinish) => void | Promise<void>;
  /** Разговор открыт заново (`flow.reopen`). Ошибка приложения не ломает сценарий. С 0.68. */
  onReopen?: (event: FlowReopen) => void | Promise<void>;
  /** Карточка клиента в хранилище приложения. Нет — таблица модуля. */
  clientCard?: ClientCardStore;
  /**
   * Свободные факты о человеке в карточке («ведёт блог»): агент пишет их тем же `flow_note { fact }`, блок `flow:client`
   * показывает, «забудь» стирает. В инструкции появляется правило, как делить факты и долгую память SDK. По умолчанию нет.
   */
  clientFacts?: boolean;
  /** Пояс человека в хранилище приложения. Нет — таблица модуля. */
  people?: FlowPeople;
  /**
   * Пояс по умолчанию (IANA, «Europe/Moscow»), с 0.53: по нему дни, тихие часы и касания, пока пояс человека неизвестен
   * (до первого хода, мессенджер без страницы). Порядок: человек → страница → `defaultTimeZone` → пояс службы
   * (`agent.timeZone`) → сервер. Не пояс — `TypeError` при создании.
   */
  defaultTimeZone?: string;
  pause?: FlowPauseSettings;
  timers?: FlowTimerSettings;
  logError?: (message: string) => void;
  /** Журнал судьи (`judge.journal`), с 0.62. По умолчанию — строка `[сценарий] судья: {…}` в `console.info`. */
  logJudge?: (entry: FlowJudgeEntry) => void;
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
  /** Read-only strict preview. Старый path/card/currentState не восстанавливают proof. */
  previewMigration(input: Pick<MigrateChatsInput, "flowId" | "toVersionId" | "requiresConfirmation" | "chatIds" | "filter" | "includeEnded" | "includeTestChats"> & { requiresConfirmation: import("../engine/confirmation").FlowConfirmationRef }): Promise<{
    eligible: string[];
    keepOriginal: Array<{ chatId: string; status: "ambiguous"; reason: string }>;
  }>;
  /** Только доверенный backend: исправление атрибуции. busy/stale требуют обработки приложением. */
  revokeConfirmation(input: import("./confirmations").FlowRevokeConfirmationInput): Promise<import("./confirmations").FlowRevokeConfirmationResult>;
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
  /**
   * Открыть законченный разговор заново: «не завершил» (`abandoned`) или своя причина приложения (`flow.end`). Нода,
   * история, память и `chatId` те же; ряд касаний — с первого шага от открытия; дни и срок программы — от исходного
   * старта. Событие `onReopen`, запись «reopen» в пути, сроки поставлены. Не открывается — `reopened: false` и причина,
   * ничего не меняется. Повтор и гонка копий безопасны: открывает один вызов. С 0.68.
   */
  reopen(input: FlowReopenInput): Promise<FlowReopenResult>;
  /** Сообщение человека в канале приложения: отвечать, ответить готовой фразой, промолчать. Звать до хода. */
  admit(input: FlowAdmitInput): Promise<FlowAdmitDecision>;
  /** Отвечает живой сотрудник: агент молчит, таймеры и касания стоят. */
  pause(input: FlowPauseInput): Promise<void>;
  resume(input: { ownerId: string; chatId: string }): Promise<void>;
  /** Сотрудник ответил человеку: пауза продлевается на `staffSilenceHours`, его реплика — в контекст агента. */
  noteStaffReply(input: FlowStaffReply): Promise<void>;
  /** Исход доставки ответа из каналов SDK (`onAnswerDelivery`). `await_repair` здесь — `TypeError`. */
  reportDelivery(input: FlowDeliveryReport): Promise<void>;
  /**
   * Канал приложения починили: ответ, который ждал починки (`await_repair`), уходит в `deliver` с тем же `messageId`
   * ближайшим обходом таймеров. Повтор вызова безопасен (`pending`). С 0.81.
   */
  resumeDelivery(input: FlowResumeDeliveryInput): Promise<FlowResumeDeliveryResult>;
  readRun(ownerId: string, chatId: string): Promise<FlowRunView | null>;
  chatsByState: ChatMigrator["chatsByState"];
  migrateChats: ChatMigrator["migrateChats"];
  readClientCard: ClientCardTools["read"];
  forgetClientCard: ClientCardTools["forget"];
  /**
   * Тестовый чат редактора (создан с `flowTestChatData()`): промотать его часы вперёд на `ms` или до начала следующего
   * дня сценария (`to: "next_day_start"`, по часам человека). Наступивший таймер срабатывает сразу; ответ ждёт конца
   * его хода. Рабочий чат — ошибка. `to: "next_first_message"` — ровно к моменту, когда сценарий сам напишет первым
   * (касание, утреннее, выход ноды по сроку, «срок вышел», «не завершил»), с учётом ночи и потолков; впереди ничего —
   * `FlowTestClockError` с кодом `nothing_scheduled`, часы не тронуты.
   */
  advanceTestClock(input: FlowTestClockInput): Promise<FlowTestClockResult>;
  start(): void;
  stop(): Promise<void>;
  /**
   * Один обход таймеров сейчас: сработает всё, чей срок наступил. Для тестов и ручного обхода (свой планировщик вместо
   * `start()`); в обычной работе обходы идут сами после `start()`.
   */
  tick(): Promise<void>;
  /** Дождаться фоновой работы: судья после хода, доставка, `onTransition`, `onFinish`. Для тестов и остановки. */
  settled(): Promise<void>;
}

/** Служебное сообщение сценария для модели: вид `app` ядра. */
export type FlowNotice = AgentNotice & { kind: "app" };
