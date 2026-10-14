import type { ResolvedUser } from "@ykurilov/agent-chat-core";
import type { MessengerChatService } from "./chat-port";
import type { Button, ExternalAccount, ExternalChat, MessengerAdapter, MessengerName, SentMessage } from "./messenger-adapter";
import type { MessengerTexts } from "./messenger-texts";

export type { ExternalAccount } from "./messenger-adapter";

/** Группа в мессенджере, в которую добавлен бот. */
export interface ExternalGroup {
  messenger: MessengerName;
  botId: string;
  externalChatId: string;
  title?: string;
}

/** Бот одного мессенджера: `telegramBot(…)`, `vkBot(…)`, `maxBot(…)`. */
export interface MessengerBot {
  readonly messenger: MessengerName;
  /** Стабильный id бота: ключ его аккаунтов и разговоров в базе. */
  readonly botId: string;
  /** Как принимаются обновления. */
  readonly receive: "webhook" | "polling";
  readonly adapter: MessengerAdapter;
  /** Свои фразы этого бота: перекрывают общие `texts` из `createMessengers`. */
  readonly texts?: Partial<MessengerTexts>;
  /** Ставить ли меню команд этому боту; перекрывает общую `commandsMenu` из `createMessengers`. */
  readonly commandsMenu?: boolean;
}

/** Зачем нужен чат для разговора. */
export type ChatRequestReason = "first" | "new" | "chat_gone" | "start_payload";

/** Что приложение решает про чат для разговора (`chatForConversation`). */
export interface ChatRequest {
  userId: string;
  account: ExternalAccount;
  reason: ChatRequestReason;
  /** Метка из ссылки на бота, если она не код привязки. */
  startPayload?: string;
  currentChatId?: string;
}

/** Файл человека → вложение в чат. Реализация — `ingestFile` пакета вложений. */
export type AttachmentIngest = (input: {
  ownerId: string;
  chatId: string;
  name: string;
  mediaType: string;
  bytes: Uint8Array;
}) => Promise<{ ok: true; attachment: { id: string; name: string; mediaType: string; size: number } } | { ok: false; reason: string }>;

/** Голосовое человека → текст. Реализация — `transcribeAudioFile` пакета голоса. */
export type AudioTranscriber = (input: {
  ownerId: string;
  chatId: string;
  audio: Uint8Array;
  mediaType: string;
}) => Promise<{ text: string } | { skipped: "limit" | "unavailable" }>;

/** Голосовой ответ: тонкий интерфейс, реализация — `createVoiceReplies(…)` из `@ykurilov/agent-chat-voice-dialog/server`. */
export interface VoiceReplies {
  speak(input: {
    text: string;
    ownerId: string;
    chatId: string;
    messageId: string;
    signal: AbortSignal;
  }): Promise<{ audio: Uint8Array; mediaType: "audio/ogg"; durationMs: number } | { skipped: "limit" | "unavailable" }>;
}

/** Настройки `createMessengers`, нужные и с чатом, и без него. */
export interface MessengersBaseOptions {
  store: MessengerStore;
  /** Для адресов привязки: кто сейчас в приложении. */
  resolveUser(request: Request): Promise<ResolvedUser>;
  bots: MessengerBot[];
  /** Например `/api/messengers`. */
  basePath: string;
  /** Кто пишет; по умолчанию — только привязанные аккаунты. */
  resolveAccount?(account: ExternalAccount): Promise<{ userId: string } | { refuse: string }>;
  /**
   * Человек привязал аккаунт мессенджера: код принят, привязка сохранена. Ждётся до ответа «привязано»; ошибка уходит
   * в `logError` и привязку не ломает. Сигнал может прийти снова для того же аккаунта мессенджера (человек привязал его
   * заново, в том числе после отвязки): награду выдавайте идемпотентно, например по паре `messenger` + `externalUserId`.
   * Аккаунт, привязанный к другому пользователю, чужой код не переносит: человек получает `linkTaken`, сигнала нет.
   */
  onLinked?(link: MessengerLink): Promise<void> | void;
  /**
   * Привязка снята и уже удалена из базы: человек отвязал аккаунт в приложении (`DELETE /links/<мессенджер>`, по
   * сигналу на каждый его аккаунт этого мессенджера). Ошибка уходит в `logError` и отвязку не отменяет. Сигнал может
   * повториться: обработчик должен быть идемпотентным. Ответ 204 на отвязку ждёт обработчик: долгую работу ставьте в
   * очередь.
   */
  onUnlinked?(link: MessengerLink): Promise<void> | void;
  /**
   * Ставить ли ботам меню команд при `start()`; у бота своя `commandsMenu`, она главнее. `false` — меню не ставится,
   * а поставленное раньше снимается. Без `service` меню снимается всегда: команд, которые бот выполняет, нет.
   * По умолчанию `true`.
   */
  commandsMenu?: boolean;
  /**
   * Свои фразы бота для всех ботов; у бота — свои `texts`, они главнее. Незаданные — по умолчанию
   * (`defaultMessengerTexts`; у бота без `service` `linked` и `howToConnect` — из `defaultMessengerTextsWithoutChat`,
   * без обещания разговора). Пустая строка или фраза-функция, вернувшая "", — бот ничего не отправляет. Нажатие
   * своей кнопки бот всё равно подтверждает, только без текста. Фразы над кнопками (`chatsTitle`, `approvalQuestion`,
   * `taskApprovalQuestion`) заглушить нельзя: пустая — фраза по умолчанию.
   */
  texts?: Partial<MessengerTexts>;
  /**
   * Чужие страницы, которым можно выдавать и снимать привязку с куками человека (`POST`, `DELETE` на `/links`), например
   * `["https://school.getcourse.ru"]`; правила те же, что у `allowedOrigins` чата. Свой сайт вносить не нужно.
   */
  allowedOrigins?: string[];
  logError?(error: unknown): void;
}

/** Настройки разговора с агентом: работают только вместе со службой чата `service`. */
export interface MessengersChatOptions {
  /** Служба чата из `createChatServer` (`ChatServerService` подходит как есть). */
  service: MessengerChatService;
  attachments?: AttachmentIngest;
  transcribe?: AudioTranscriber;
  /** Кнопка «Открыть в приложении» / «Открыть чат». */
  webChatUrl?(chatId: string): string;
  /** `single`: одна переписка, без `/new` и `/chats`. По умолчанию `single`. */
  conversations?: "single" | "many";
  /** Чат для разговора; по умолчанию — новый пустой чат с `origin`. `agentStarts` — указание, с которого агент пишет первым. */
  chatForConversation?(input: ChatRequest): Promise<{ chatId: string; agentStarts?: string }>;
  /** Нет поля — группы выключены. */
  groups?: {
    /** Инструменты приложения, доступные в группе; по умолчанию ни одного. */
    allowedTools?: readonly string[];
    /** `mentions`: упоминание бота и ответ на его сообщение. По умолчанию `mentions`. */
    answerTo?: "mentions" | "all";
    /** Чей лимит тратится в группе; по умолчанию — подключивший. `null` — не отвечать. */
    payer?(group: ExternalGroup, connectedBy: string): Promise<string | null>;
    /** Обращений участника в час; по умолчанию 20. */
    perMemberHourly?: number;
  };
  /** Нет поля — ответ текстом. */
  voiceReplies?: VoiceReplies;
  /**
   * Склейка пачки в личке: человек пишет несколько сообщений подряд — агент отвечает одним ходом, когда человек замолчал
   * на `quietMs` (по умолчанию 3000 мс); сообщения, пришедшие во время ответа, получают один общий ход после него.
   * В истории сообщения отдельные. По умолчанию включена; `false` — каждое сообщение со своим ответом, как до 0.54.
   * Группы и нажатия кнопок не склеиваются.
   */
  messageBursts?: false | { quietMs?: number };
  /** `true`: «Задача готова» в мессенджер, когда вкладка закрыта. */
  taskReadyPing?: boolean;
  /**
   * Исход доставки каждого ответа агента в мессенджер — и на сообщение человека, и написанного первым (ход `notice`).
   * Сценарию — одной строкой: `onAnswerDelivery: (report) => flow.reportDelivery(report)`. Ошибка уходит в `logError` и
   * доставку не ломает. Один ответ может дать несколько исходов: `retry`, потом итог повтора; разбирать по `messageId`,
   * последний главнее.
   */
  onAnswerDelivery?(report: AnswerDeliveryReport): Promise<void> | void;
}

/**
 * Исход доставки ответа агента в мессенджер.
 * - `delivered` — дошёл (или человек сам остановил его на середине `/stop`).
 * - `blocked` — человек заблокировал бота; разговор помечен заблокированным.
 * - `window_closed` — мессенджер не пускает писать первым (ВК 950), пока человек не напишет сам.
 * - `retry` — мессенджер временно недоступен: итог лежит в хранилище и уйдёт сам; итог повтора придёт отдельным исходом.
 * - `failed` — не дошёл и не дойдёт: ход сорвался, ответ пустой или мессенджер отказал насовсем.
 */
export type AnswerDeliveryOutcome = { status: "delivered" } | { status: "blocked" } | { status: "window_closed" } | { status: "retry" } | { status: "failed" };

/** Чей ответ и как начат ход: `human` — ответ на сообщение человека, `notice` — агент пишет первым. */
export interface AnswerRef {
  ownerId: string;
  chatId: string;
  /** Номер ответа агента в чате. */
  messageId: string;
  trigger: "human" | "notice";
}

/** `onAnswerDelivery`: ответ и исход его доставки. */
export interface AnswerDeliveryReport extends AnswerRef {
  outcome: AnswerDeliveryOutcome;
}

/**
 * Без службы чата: бот только привязывает аккаунты, а приложение шлёт уведомления само. Настройки разговора задать
 * нельзя. Привязанному человеку на любое сообщение, команду, голос, файл и кнопку — фраза `notifyOnly` (пустая —
 * тишина), отказ `resolveAccount` главнее; ход агента не начинается, файлы не скачиваются.
 */
export type MessengersWithoutChatOptions = { service?: undefined } & { [Name in Exclude<keyof MessengersChatOptions, "service">]?: never };

/** Настройки `createMessengers`. Всё, что про поведение, — настройки приложения; значения по умолчанию безопасны. */
export type MessengersOptions = MessengersBaseOptions & (MessengersChatOptions | MessengersWithoutChatOptions);

export interface MessengerLink {
  messenger: MessengerName;
  botId: string;
  externalUserId: string;
  userId: string;
  name: string;
  username?: string;
  linkedAt: string;
}

export interface MessengerConversation {
  messenger: MessengerName;
  botId: string;
  externalChatId: string;
  type: "private" | "group";
  /** Личный чат — привязанный пользователь; группа — плательщик. */
  userId: string;
  connectedBy?: string;
  currentChatId?: string;
  blocked: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Ключ внешнего чата в базе. */
export interface ConversationKey {
  messenger: MessengerName;
  botId: string;
  externalChatId: string;
}

export type UpdateStatus = "received" | "done" | "failed";

/** Обновление в работе: чьё оно, его содержимое (`InboundUpdate`) и за кем оно до какого срока. */
export interface UpdateWork {
  messenger: MessengerName;
  botId: string;
  update: unknown;
  holder: string;
  leaseUntil: string;
}

/** Обновление, которое бросила упавшая копия или отпустил сбой обработки. `attempts` — сколько раз его уже забирали. */
export interface AbandonedUpdate {
  key: string;
  update: unknown;
  receivedAt: string;
  attempts: number;
}

/** Действие за кнопкой: общий слой знает свои виды, поэтому хранилище держит его как есть. */
export type ButtonAction = { type: string; [field: string]: unknown };

/**
 * Итог, ещё не ушедший в мессенджер: лежит в базе за копией сервера, которая его шлёт (аренда). Отправлен — удаляется;
 * копия упала и аренда истекла — его забирает и отправляет другая копия или та же после перезапуска.
 */
export interface PendingDelivery extends ConversationKey {
  id: string;
  chat: ExternalChat;
  message: { text: string; markup: "html" | "plain"; buttons?: Button[][] };
  /** Правка уже отправленного сообщения вместо нового. */
  edit?: SentMessage;
  /** Кнопки с номерами и действиями: после отправки действия сохраняются, как при обычной отправке. */
  rows?: Array<Array<{ id: string; text: string; action: ButtonAction }>>;
  /** Итог ответа агента: после повтора его исход уходит в `onAnswerDelivery`. */
  answer?: AnswerRef;
  createdAt: string;
}

/** Хранилище мессенджеров: память, SQLite, Postgres (контракт один). Времена — ISO 8601. */
export interface MessengerStore {
  // Привязка
  saveLinkCode(code: { codeHash: string; userId: string; messenger: MessengerName; expiresAt: string }): Promise<void>;
  /** Принимает код один раз: не истёк, не использован и выдан для этого мессенджера. `null` — код не подошёл (и не сгорел). */
  consumeLinkCode(codeHash: string, messenger: MessengerName, now: string): Promise<{ userId: string } | null>;
  saveLink(link: MessengerLink): Promise<void>;
  findLink(messenger: MessengerName, botId: string, externalUserId: string): Promise<MessengerLink | null>;
  listLinks(userId: string): Promise<MessengerLink[]>;
  removeLinks(userId: string, messenger: MessengerName): Promise<void>;

  // Разговоры
  getConversation(key: ConversationKey): Promise<MessengerConversation | null>;
  saveConversation(conversation: MessengerConversation): Promise<void>;
  setCurrentChat(key: ConversationKey, chatId: string | null, at: string): Promise<void>;
  setBlocked(key: ConversationKey, blocked: boolean, at: string): Promise<void>;
  setActive(key: ConversationKey, active: boolean, at: string): Promise<void>;
  /** Разговоры, у которых текущий чат — этот (чат удалён или перешёл в другой). */
  listConversationsOfChat(chatId: string): Promise<MessengerConversation[]>;
  /** Разговоры человека: его личные чаты с ботами и группы, где он плательщик. */
  listConversationsOfUser(userId: string): Promise<MessengerConversation[]>;

  // Группы: обращения участников
  addMemberHit(hit: ConversationKey & { id: string; externalUserId: string; at: string }): Promise<void>;
  countMemberHits(key: ConversationKey, externalUserId: string, since: string): Promise<number>;

  // Повторы обновлений
  /**
   * `true` — обновление принято впервые; `false` — уже было. С `work` обновление записывается с содержимым за держателем
   * до `leaseUntil`: копия упала, не закончив, — его забирает `takeAbandonedUpdates`. Без `work` — только метка «было».
   */
  claimUpdate(key: string, now: string, work?: UpdateWork): Promise<boolean>;
  /** Обработка закончена: обновление больше не забирается, содержимое не хранится. */
  finishUpdate(key: string, status: Exclude<UpdateStatus, "received">, now: string): Promise<void>;
  /** Держатель жив: названные обновления в работе, которые ещё за ним, остаются за ним до `leaseUntil`. */
  renewUpdates(keys: readonly string[], holder: string, leaseUntil: string): Promise<void>;
  /** Обработка сорвалась: обновление, если ещё за `holder`, свободно с `retryAt` — его заберёт любая копия. */
  releaseUpdate(key: string, holder: string, retryAt: string): Promise<void>;
  /**
   * Необработанные обновления бота с истёкшей к `now` арендой, по порядку приёма: теперь они за `holder`, счёт попыток
   * вырос на один. Одно обновление достаётся одному.
   */
  takeAbandonedUpdates(bot: { messenger: MessengerName; botId: string }, holder: string, now: string, leaseUntil: string, limit: number): Promise<AbandonedUpdate[]>;

  // Кнопки
  saveButton(button: ConversationKey & { id: string; action: ButtonAction; createdAt: string }): Promise<void>;
  /** Отдаёт действие и помечает кнопку использованной; повторное нажатие — `null`. */
  takeButton(key: ConversationKey, id: string, now: string): Promise<ButtonAction | null>;

  // Очередь отправки
  /** Итог за держателем `holder` до `leaseUntil`; тот же `id` переписывается. */
  savePendingDelivery(delivery: PendingDelivery, holder: string, leaseUntil: string): Promise<void>;
  deletePendingDelivery(id: string): Promise<void>;
  /** Держатель жив: его итоги остаются за ним до `leaseUntil`. */
  renewPendingDeliveries(holder: string, leaseUntil: string): Promise<void>;
  /** Итоги бота с истёкшей к `now` арендой, по порядку сохранения: теперь они за `holder`. Один итог достаётся одному. */
  takeAbandonedDeliveries(bot: { messenger: MessengerName; botId: string }, holder: string, now: string, leaseUntil: string, limit: number): Promise<PendingDelivery[]>;

  // Аренда опроса
  acquireLease(name: string, holder: string, leaseUntil: string, now: string): Promise<boolean>;
  releaseLease(name: string, holder: string): Promise<void>;

  /**
   * Убирает просроченное: коды, обновления, кнопки, обращения. Обновление с живой арендой остаётся; с арендой, истёкшей
   * раньше `before`, — убирается: его уже никто не подберёт.
   */
  purgeBefore(before: string): Promise<void>;
  close?(): Promise<void>;
}

/** Хранилище, которое открыло своё соединение (SQLite, Postgres): `close()` его закрывает, повторный вызов ничего не делает. */
export interface ClosableMessengerStore extends MessengerStore {
  close(): Promise<void>;
}
