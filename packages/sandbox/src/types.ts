import type { AnswerEdit, ChatListItem, ModelCallEvent, ModelCallPurpose, SpendingLimits, ToolCallEvent } from "@ykurilov/agent-chat-core";
import type { ChatHandlerOptions } from "@ykurilov/agent-chat-server";

/** Куда журнал пишет свои сбои: тот же вид, что `ChatHandlerOptions.logError`. */
export type LogError = (message: string) => void;

/** Настройки обработчика песочницы: боевые настройки чата плюс доступ, журнал и срок жизни. */
export interface SandboxHandlerOptions {
  /** Тот же объект, что у `createChatHandler`. */
  chat: ChatHandlerOptions;
  /** По умолчанию `"/api/sandbox"`. */
  basePath?: string;
  /** Не админ получает 404 на любом адресе песочницы. */
  isAdmin(user: { id: string }, request: Request): boolean | Promise<boolean>;
  journal: SandboxJournal;
  /** Сколько дней хранить журнал; по умолчанию 30. */
  retentionDays?: number;
  /** Свои пределы трат песочницы; нет — без пределов. */
  limits?: SpendingLimits;
  /**
   * Инструменты, которым нужен песочный владелец вместо настоящего id админа: их файлы и траты принадлежат
   * песочному чату. По умолчанию `SANDBOX_CHAT_OWNED_TOOLS` (`generate_images`).
   */
  chatOwnedTools?: readonly string[];
  /**
   * Раздел «Чаты людей»: админ видит чаты человека только на чтение и проверяет ответы агента в копии в своей
   * песочнице. `{ find }` — человека ищет приложение, `true` — человека вводят по id. Нет — раздела нет: адреса
   * `/people…` отвечают 404. Экрану то же самое передаётся в `AgentSandbox` `people`.
   */
  people?: SandboxPeople | true;
}

/** Человек приложения в поиске раздела «Чаты людей». */
export interface Person {
  /** Тот же id, что отдаёт `resolveUser` приложения. */
  id: string;
  name?: string;
  /** Подсказка, чтобы отличить однофамильцев: почта, телефон, роль. */
  hint?: string;
}

/** Люди приложения для раздела «Чаты людей». */
export interface SandboxPeople {
  /** Найти людей по строке админа (имя, почта, id). Ответ показывается как есть, по порядку. */
  find(query: string): Promise<Person[]>;
}

/** Кусок журнала: тело запроса или ответа, сохранённое один раз по хешу. */
export interface JournalBlob {
  hash: string;
  content: unknown;
  /** Размер до сжатия. */
  bytes: number;
  /** Кусок длиннее предела: `content` обрезан. */
  truncated: boolean;
}

/** Обращение к модели в списке журнала: без тел, только сведения. */
export interface ModelCallSummary {
  kind: "model";
  id: string;
  chatId: string;
  ownerId: string;
  messageId: string | null;
  purpose: ModelCallPurpose;
  attempt: number;
  modelId: string;
  providerId: string;
  usage: ModelCallEvent["usage"];
  costUsd: number | null;
  startedAt: Date;
  firstChunkMs: number | null;
  durationMs: number;
  status: ModelCallEvent["status"];
  error: string | null;
  /** Инструкция этого обращения отличается от инструкции предыдущего обращения того же чата. */
  instructionsChanged: boolean;
}

/** Обращение к модели целиком: сведения и хеши кусков запроса и ответа. */
export interface ModelCallRecord extends ModelCallSummary {
  instructionsHash: string;
  /** По хешу на каждое сообщение prompt: повторяющаяся история хранится один раз. */
  messageHashes: string[];
  toolsHash: string;
  settingsHash: string;
  responseHash: string;
}

/** Вызов инструмента в журнале. */
export interface ToolCallRecord {
  kind: "tool";
  id: string;
  chatId: string;
  ownerId: string;
  messageId: string;
  /** Обращение к модели, которое попросило вызов; нет — не нашлось. */
  modelCallId: string | null;
  toolCallId: string;
  toolName: string;
  inputHash: string;
  outputHash: string | null;
  error: string | null;
  startedAt: Date;
  durationMs: number;
}

/** Строка списка журнала: обращение к модели или вызов инструмента. */
export type JournalEntry = ModelCallSummary | ToolCallRecord;

/** Одна запись журнала с телами кусков: что отдаёт `getCall`. */
export type JournalCallDetails =
  | {
      kind: "model";
      call: ModelCallRecord;
      instructions: JournalBlob;
      messages: JournalBlob[];
      tools: JournalBlob;
      settings: JournalBlob;
      response: JournalBlob;
    }
  | { kind: "tool"; call: ToolCallRecord; input: JournalBlob; output: JournalBlob | null };

/** Правленая инструкция песочного чата. */
export interface SandboxChatSettings {
  chatId: string;
  /** `null` — чат идёт с боевой инструкцией приложения. */
  instructions: string | null;
  updatedBy: string;
  updatedAt: Date;
}

/** Что исправил человек в ответе агента: отметки «изменено» на экране. */
export interface AnswerEditMark {
  textEdited: boolean;
  /** `toolCallId` вызовов с заменённым результатом. */
  editedToolCallIds: string[];
}

/** Правка ответа в журнале: новый ответ-сосед и откуда он взялся. */
export interface AnswerEditRecord extends AnswerEditMark {
  /** Новый ответ. */
  messageId: string;
  /** Исправленный ответ. */
  sourceMessageId: string;
  chatId: string;
  editedBy: string;
  editedAt: Date;
}

/** Журнал песочницы. Запись — через очередь: `enqueue…` возвращаются сразу, `flush` дожидается записи. */
export interface SandboxJournal {
  enqueueModelCall(event: ModelCallEvent): void;
  enqueueToolCall(event: ToolCallEvent): void;
  /**
   * Ещё значения, которые не должны попасть в журнал. Обработчик песочницы передаёт сюда ключи из `chat.env`.
   * Необязательный: свой журнал без него работает, но ключи из `chat.env` в нём прятать нужно самому.
   */
  addSecrets?(values: readonly string[]): void;
  /** Дождаться записи всего, что уже в очереди. */
  flush(): Promise<void>;
  /** Записи чата по времени; с `messageId` — только этого хода. */
  listForChat(chatId: string, options?: { messageId?: string }): Promise<JournalEntry[]>;
  /** `ownerId` записи — для проверки, что админ смотрит свой песочный чат. */
  getCall(callId: string): Promise<JournalCallDetails | null>;
  /** Кусок отдаётся, только если на него ссылается запись этого владельца. */
  getBlob(hash: string, ownerId: string): Promise<JournalBlob | null>;
  getSettings(chatId: string): Promise<SandboxChatSettings | null>;
  /** `instructions: null` — вернуть боевую инструкцию. */
  setSettings(settings: SandboxChatSettings): Promise<void>;
  markAnswerEdited(record: AnswerEditRecord): Promise<void>;
  listEditedAnswers(chatId: string): Promise<AnswerEditRecord[]>;
  /** Удалить весь журнал, настройки и правки чата. События этого чата, пришедшие позже (ход ещё шёл), не пишутся. */
  deleteChat(chatId: string): Promise<void>;
  /** Удалить записи старше даты и куски, на которые больше никто не ссылается; отдаёт число удалённых записей. */
  deleteOlderThan(before: Date): Promise<number>;
  close(): Promise<void>;
}

/** Вид значения в ответе адреса: даты приходят строками ISO. */
export type Serialized<T> = T extends Date
  ? string
  : T extends Array<infer Item>
    ? Array<Serialized<Item>>
    : T extends object
      ? { [Key in keyof T]: Serialized<T[Key]> }
      : T;

/** `GET /chats/:id/journal?messageId=`. */
export interface JournalListResponse {
  entries: Array<Serialized<JournalEntry>>;
}

/** `GET /journal/calls/:callId`. */
export type JournalCallResponse = Serialized<JournalCallDetails>;

/** `GET /journal/blobs/:hash`. */
export type JournalBlobResponse = Serialized<JournalBlob>;

/** `GET` и `PUT /chats/:id/settings`. */
export interface SandboxSettingsResponse {
  /** Правленая инструкция; `null` — чат идёт с боевой. */
  instructions: string | null;
  /** Боевая инструкция приложения — для сравнения. */
  appInstructions: string;
  updatedAt: string | null;
}

/** Тело `PUT /chats/:id/settings`. */
export interface SandboxSettingsRequest {
  instructions: string | null;
}

/** Тело `POST /chats/:id/messages/:messageId/answer-edit`. */
export type AnswerEditRequest = AnswerEdit;

/** Ответ `POST /chats/:id/messages/:messageId/answer-edit`: id нового ответа и его отметки. */
export interface AnswerEditResponse {
  messageId: string;
  mark: AnswerEditMark;
}

/** Дополнение к ответу `GET` истории песочного чата: отметки правок по id ответа. */
export interface SandboxHistoryExtras {
  answerEdits: Record<string, AnswerEditMark>;
}

/** `GET /people?query=`: найденные люди; `search: false` — поиска у приложения нет, человека вводят по id. */
export interface PeopleSearchResponse {
  search: boolean;
  people: Person[];
}

/** `GET /people/:personId/chats`: все чаты человека, с чатами объектов (`subjectKey`), без данных объектов. */
export interface PersonChatsResponse {
  chats: ChatListItem[];
}

/** `POST /people/:personId/:chatId/staff-copy`: id копии — обычного песочного чата админа. */
export interface StaffCopyResponse {
  id: string;
}
