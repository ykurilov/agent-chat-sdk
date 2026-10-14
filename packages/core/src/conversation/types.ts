import type { UIMessage } from "ai";
import type { ChatClosure } from "../access/chat-closure";

/** Версия формата сообщений. 1 — формат `UIMessage` из `ai` 7. */
export const CURRENT_FORMAT_VERSION = 1;

/** `awaiting_approval` — ход остановлен: агент ждёт, разрешит ли человек вызов инструмента. Ожидание без срока. */
export type AnswerStatus = "streaming" | "complete" | "stopped" | "error" | "interrupted" | "awaiting_approval";

export type FinalAnswerStatus = Exclude<AnswerStatus, "streaming">;

export type ChatErrorKind = "overloaded" | "rate_limited" | "insufficient_funds" | "invalid_key" | "context_overflow" | "other";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Вход, записанный в кэш провайдера. Есть у тех, кто это сообщает; нет — 0. */
  cacheWriteTokens?: number;
  /**
   * Размер контекста после ответа: вход плюс выход последнего шага, числа провайдера. У сообщений,
   * записанных до появления сжатия, поля нет.
   */
  contextTokens?: number;
  /** Есть, если хоть один шаг прикинут по длине текста: провайдер не сообщил числа или шаг оборвался (FR-050, FR-051). */
  estimated?: true;
  /**
   * Только в идущем ответе: шаги хода, ещё не записанного в журнал, с провайдером каждого. По ним восстановление после
   * перезапуска пишет каждому провайдеру свою запись и выбирает ступень цены по входу каждого шага (FR-052).
   */
  pendingSteps?: PendingStepUsage[];
}

/** Расход одного шага идущего хода и провайдер, у которого он сделан. */
export type PendingStepUsage = Omit<TokenUsage, "pendingSteps" | "contextTokens"> & {
  providerId: string;
  /** Когда ушёл запрос шага (ISO): по нему цена часов пик. У записей до появления поля нет — берётся начало хода. */
  at?: string;
};

export interface Chat {
  id: string;
  ownerId: string;
  modelId: string;
  providerId: string;
  /** Id уровня рассуждений; нет — уровень по умолчанию модели. */
  reasoning?: string;
  /** Название для списка чатов; нет — чат ещё без названия. */
  title?: string;
  /** Из какого мессенджера создан чат; нет — чат создан в вебе. */
  origin?: ExternalChannel;
  /** Ключ объекта приложения (урок, заказ…): у владельца не больше одного чата с этим ключом. Нет — обычный чат. */
  subjectKey?: string;
  /**
   * Данные чата для приложения (JSON-объект до 16 КБ): откуда пришёл человек, режим, номер формы. Есть у любого чата.
   * В браузер и модели не уходят. Нет — у чата нет данных.
   */
  data?: Record<string, unknown>;
  /** То же значение, что `data`: прежнее имя, для старого кода. */
  subjectData?: Record<string, unknown>;
  /** Чат закрыт: ходы и правки не идут, на экране — этот текст. Нет — чат открыт. */
  closed?: ChatClosure;
  createdAt: string;
  updatedAt: string;
}

/** Объект приложения, к которому привязан чат (урок, заказ…): ключ и данные чата объекта. Только для сервера. */
export interface ChatSubject {
  /** Ключ объекта, см. `Chat.subjectKey`. */
  key: string;
  /** Данные объекта, см. `Chat.subjectData`; нет — чат объекта без данных. */
  data?: Record<string, unknown>;
}

/** Объект чата для инструментов и хуков; у обычного чата (без ключа) — `undefined`. */
export function subjectOfChat(chat: Pick<Chat, "subjectKey" | "subjectData">): ChatSubject | undefined {
  if (chat.subjectKey === undefined) return undefined;
  return { key: chat.subjectKey, ...(chat.subjectData !== undefined && { data: chat.subjectData }) };
}

/** Мессенджеры, из которых приходят чаты. */
export type ExternalChannel = "telegram" | "vk" | "max";

/** Откуда пришёл ход: веб или мессенджер. */
export type AgentChannel = "web" | ExternalChannel;

/** С кем говорит агент: один человек или группа. */
export type AgentAudience = "private" | "group";

/**
 * Групповой ход: без снимка памяти, инструментов памяти и поиска по истории; из инструментов приложения — только
 * `allowedTools`; имя автора — в хвосте сообщения человека.
 */
export interface GroupTurn {
  allowedTools: readonly string[];
  author: string;
}

/**
 * Отметка обрыва озвучки: человек перебил голосом, и ответ агента прозвучал не до конца.
 * `partIndex` — часть текста сообщения, `charOffset` — знак в ней, до которого дошла озвучка, `spokenTail` — хвост
 * озвученного (последние ≈ 60 знаков) для цитаты на экране. Ядро только хранит поле: считает его расширение голоса.
 */
export interface VoiceCut {
  partIndex: number;
  charOffset: number;
  spokenTail: string;
}

/** Что сообщение несёт в `UIMessage.metadata` по дороге в браузер. */
export interface ChatMessageMetadata {
  modelId?: string;
  providerId?: string;
  usage?: TokenUsage;
  reasoningDurationsMs?: Record<string, number>;
  status?: AnswerStatus;
  error?: { kind: ChatErrorKind };
  /** Есть, если озвучку ответа оборвало перебивание. */
  voiceCut?: VoiceCut;
  /** Ответ не дошёл до человека (`markUndelivered`): модель его не видит, экран подписывает «не доставлено». */
  undelivered?: true;
}

export type AgentChatMessage = UIMessage<ChatMessageMetadata>;

export interface StoredMessage {
  id: string;
  chatId: string;
  parentId: string | null;
  role: "user" | "assistant";
  parts: AgentChatMessage["parts"];
  formatVersion: number;
  status: AnswerStatus;
  modelId: string | null;
  providerId: string | null;
  usage: TokenUsage | null;
  reasoningDurationsMs: Record<string, number>;
  error: { kind: ChatErrorKind } | null;
  /**
   * Отметка обрыва озвучки. Необязательное поле: старые данные и хранилища без голосового режима его не знают;
   * встроенные хранилища читают отсутствие как `null`.
   */
  voiceCut?: VoiceCut | null;
  /**
   * Состояние хука итога хода у ответа агента: `pending` — хук ещё не отработал, `done` — отработал, `failed` — не
   * отработал после всех попыток. Нет или `null` — хук не зовётся. Необязательное поле: хранилища без состояния хука
   * его не знают.
   */
  afterTurn?: AfterTurnState | null;
  createdAt: string;
  /**
   * Знак жизни идущего ответа (FR-060), только для записи: хранилища его не возвращают. Ход ставит его при вставке и
   * с каждой записью, а в тишине — раз в `ANSWER_ALIVE_EVERY_MS`. По нему восстановление отличает ответ упавшей копии
   * сервера от живого ответа другой копии. Нет — последним знаком считается `createdAt`.
   */
  alive?: AnswerAliveMark;
}

/** Состояние хука итога хода у ответа агента, см. `StoredMessage.afterTurn`. */
export type AfterTurnState = "pending" | "done" | "failed";

/**
 * Знак жизни при записи. `"now"` — ответ жив сейчас; время ставит хранилище по своим часам: у базы, к которой ходят
 * копии сервера с разных машин, — по часам базы, так что расхождение часов машин знак не ломает. `"released"` — ответ
 * брошен штатной остановкой сервера: он молчит дольше любого порога, и следующая проверка прерывает его сразу.
 */
export type AnswerAliveMark = "now" | "released";

/** Сообщение с обычными значениями полей: задайте `id`, `chatId`, `role` и то, что отличается. */
export function newStoredMessage(
  fields: Pick<StoredMessage, "id" | "chatId" | "role"> & Partial<StoredMessage>,
): StoredMessage {
  return {
    parentId: null,
    parts: [],
    formatVersion: CURRENT_FORMAT_VERSION,
    status: "complete",
    modelId: null,
    providerId: null,
    usage: null,
    reasoningDurationsMs: {},
    error: null,
    voiceCut: null,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

/**
 * Отметка «сводка заменяет сообщения с `fromMessageId` по `throughMessageId`». Записи только добавляются,
 * оригиналы сообщений остаются. Активна на ветке та запись, чей `throughMessageId` лежит на этой ветке.
 */
export interface StoredCompaction {
  id: string;
  chatId: string;
  fromMessageId: string;
  throughMessageId: string;
  summary: string;
  /** Размер сводки по числу провайдера: выход без рассуждений. */
  summaryTokens: number;
  modelId: string;
  providerId: string;
  /** Расход на само сжатие. */
  usage: TokenUsage | null;
  createdAt: string;
}

/**
 * Отметка «в момент `selectedAt` на развилке выбрано сообщение `messageId`». Записи только добавляются:
 * сообщения не меняются. Выбранное сообщение считается «тронутым» в этот момент и побеждает соседей, созданных раньше.
 */
export interface StoredBranchSelection {
  id: string;
  chatId: string;
  messageId: string;
  selectedAt: string;
}

/**
 * Что потратило деньги: ответ агента, фоновое сжатие, дела долгой памяти (оптимизация дублей), озвучка ответа голосом,
 * распознавание звуков человека (смех, вздох), вызов веб-службы (поиск, чтение страницы) или создание картинок (`images`). У озвучки `inputTokens` —
 * число знаков, отправленных на озвучку, у звуков — число секунд звука, отправленных на распознавание; остальные счётчики 0.
 * У веб-службы все счётчики 0, а вместо модели — имя инструмента; у картинок все счётчики 0, а `modelId` — модель картинок. `answer_correction` — поправка оценки ответа до настоящего
 * расхода, который провайдер сообщил позже (FR-058): разница, числа и деньги могут быть меньше нуля. `judge` — судья
 * переходов сценария агента (`@ykurilov/agent-chat-flows`).
 * `first_message` — ход, в котором агент пишет первым (касание, утро сценария): `deliverNotices({ usageSource })`.
 * `voice_input` — диктовка через сервер (`@ykurilov/agent-chat-voice`, режим `relay`): `inputTokens` — секунды звука,
 * `modelId` — модель распознавания. `voice_polish` — чистка надиктованного текста моделью.
 */
export const BUILT_IN_USAGE_SOURCES = [
  "answer",
  "answer_correction",
  "compaction",
  "memory",
  "speech",
  "sounds",
  "web_tools",
  "images",
  "helper",
  "background",
  "judge",
  "first_message",
  "voice_input",
  "voice_polish",
] as const;

/** Штатные виды расхода SDK. */
export type BuiltInUsageSource = (typeof BUILT_IN_USAGE_SOURCES)[number];

/**
 * Вид расхода: штатный или свой вид приложения (`"font_download"`) — строкой, без приведения типа; подсказки редактора
 * для штатных остаются. Хранилища держат вид текстом, лимиты суммируют все виды.
 */
export type UsageSource = BuiltInUsageSource | (string & {});

/**
 * Один расход токенов одной моделью у одного провайдера. Записи только добавляются и переживают удаление чата:
 * месячный расход человека от удаления переписки не убывает. Деньги ядро не считает — это делает расширение лимитов.
 * `outputTokens` включает рассуждения (`reasoningTokens` — их часть), `inputTokens` включает кэш.
 */
export interface UsageRecord {
  id: string;
  /** Владелец чата на момент расхода. */
  ownerId: string;
  chatId: string;
  /** Сообщение агента; у сжатия нет. */
  messageId: string | null;
  source: UsageSource;
  modelId: string;
  providerId: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Доллары по ценам модели на момент расхода; 0 — у модели не было цены. Лимит суммирует именно их. */
  costUsd: number;
  /** Начало хода (сжатия), которому принадлежит расход: так расход попадает в тот период, в котором ход начался. */
  createdAt: string;
  /** `true` — числа «примерно»: прикинуты по длине текста, а не сообщены провайдером. Нет — числа провайдера. */
  estimated?: boolean;
}

/** Выбор записей расхода: по владельцу, чату, сообщению и источнику, начиная с момента `since` включительно. */
export interface UsageFilter {
  ownerId?: string;
  chatId?: string;
  /** Расход одного сообщения: так восстановление после перезапуска узнаёт, что из расхода ответа уже в журнале. */
  messageId?: string;
  source?: UsageSource;
  since?: string;
}

/** Фильтр суммы расхода по списку чатов (`sumUsageByChat`). */
export interface UsageByChatFilter {
  chatIds: readonly string[];
  ownerId?: string;
  source?: UsageSource;
  since?: string;
}

/** Сумма расхода одного чата одной моделью у одного провайдера. */
export interface UsageChatSum extends UsageSum {
  chatId: string;
}

/** Сумма расхода одной моделью у одного провайдера: токены и деньги, записанные в момент расхода. */
export interface UsageSum {
  modelId: string;
  providerId: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;  costUsd: number;
}
