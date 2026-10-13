import { normalizeChatClosure } from "../access/chat-closure";
import type { ChatClosure } from "../access/chat-closure";
import { appStatePart, createAppStateWriter, isReservedAppStateKey } from "../app-state/app-state";
import type { AppStateRecord } from "../app-state/app-state";
import { CLOSED_STATE_KEY } from "../app-state/state-messages";
import { AttachmentRejectedError } from "../attachments/message-attachments";
import type { MessageAttachments, StoredFilePart } from "../attachments/message-attachments";
import { deriveChatTitle, normalizeChatTitle } from "../conversation/chat-title";
import { newStoredMessage } from "../conversation/types";
import type { AgentChatMessage, Chat, StoredMessage } from "../conversation/types";
import { EXTERNAL_CONTENT_STATE_KEY } from "../external-content/external-content";
import type { ModelChoice } from "../models/model-choice";
import { CHAT_DATA_MAX_BYTES, assertChatData, assertNoNulChar, assertNoProtoKey } from "../storage/chat-data";
import { ChatAlreadyExistsError, DuplicateChatSubjectError } from "../storage/chat-storage";
import type { ChatStorage, NewChatInput } from "../storage/chat-storage";

export const SUBJECT_KEY_MAX_LENGTH = 200;
export const SUBJECT_DATA_MAX_BYTES = CHAT_DATA_MAX_BYTES;
export const GREETING_MAX_LENGTH = 10_000;
export const IMPORT_MAX_MESSAGES = 5000;
/** Больше картинок в одном импорте нельзя: каждая сохраняется отдельным файлом до записи чата. */
export const IMPORT_MAX_IMAGES = 500;
/** Общий размер картинок одного импорта, байт (200 МБ): все байты держатся в памяти до записи. */
export const IMPORT_MAX_IMAGE_BYTES = 200 * 1024 * 1024;

/**
 * Приветствие нового чата, ровно одно из двух:
 * - `text` — дословное первое сообщение агента: пишется сразу, без модели, хода и расхода;
 * - `instruction` — указание агенту: SDK один раз будит его служебным сообщением `conversation_started`,
 *   и агент пишет первым сам (обычный ход с моделью и расходом).
 */
export type ChatGreeting =
  | {
      /** Текст приветствия, 1–10 000 знаков. */
      text: string;
      instruction?: never;
    }
  | {
      /** Указание агенту, с чего начать разговор, 1–10 000 знаков. */
      instruction: string;
      text?: never;
    };

export interface OpenSubjectChatInput {
  ownerId: string;
  /** Ключ объекта приложения (урок, заказ, документ), 1–200 знаков: у владельца один чат на ключ. */
  key: string;
  /**
   * Данные объекта для серверной стороны (инструменты, хуки), JSON-объект до 16 КБ. Пишутся только при создании чата:
   * у найденного чата прежние данные не меняются. В браузер не уходят.
   */
  data?: Record<string, unknown>;
  /** Название нового чата; нет — из первого сообщения человека, как у обычного чата. */
  title?: string;
  /** Приветствие нового чата; у найденного чата не добавляется. */
  greeting?: ChatGreeting;
}

export interface OpenSubjectChatResult {
  /** Чат как он записан, с данными объекта: только для сервера. */
  chat: Chat;
  /** Чат создан этим вызовом. */
  created: boolean;
}

/** Картинка импортируемого сообщения: байты сохраняет расширение вложений (`MessageAttachments.importFile`). */
export interface ImportedImagePart {
  type: "image";
  bytes: Uint8Array;
  mediaType: string;
  filename?: string;
}

export interface ImportedMessageInput {
  /** Нет — создаётся. */
  id?: string;
  role: "user" | "assistant";
  /** Дата ISO 8601 с часовым поясом (`Z` или `+03:00`); даты сообщений не убывают. */
  createdAt: string;
  parts: ReadonlyArray<{ type: "text"; text: string } | ImportedImagePart>;
}

export interface ImportChatInput {
  ownerId: string;
  chat: {
    /** UUID; нет — создаётся. Чат с таким id уже есть — `ChatAlreadyExistsError`. */
    id?: string;
    /** Нет — из первого сообщения человека. */
    title?: string;
    subjectKey?: string;
    /** Данные чата, JSON-объект до 16 КБ (`Chat.data`). Прежнее имя — `subjectData`: то же значение, `data` главнее. */
    data?: Record<string, unknown>;
    subjectData?: Record<string, unknown>;
    /** Нет — выбор для нового чата (последний выбор человека или по умолчанию). */
    model?: ModelChoice;
    /** Дата ISO 8601 с часовым поясом, не позже первого сообщения; нет — дата первого сообщения. */
    createdAt?: string;
    /**
     * Состояние чата, как его отдаёт `getChatState().values`: JSON-объект, верхние ключи без `$`, до 256 КБ (каждый верхний
     * ключ — до 16 КБ). Пишется служебным сообщением перед перенесённой историей: `getChatState` и `model.state` видят
     * его сразу, все ветки от неё («Переделать», правка любого сообщения) — тоже. Экран получает состояние частью первого
     * сообщения истории, модель служебного сообщения не видит.
     */
    state?: Record<string, unknown>;
    /** Чат закрыт (`closeChat`): код и текст по тем же правилам. Ходы и ответы человека не идут, правка открывает ветку. */
    closed?: ChatClosure;
    /**
     * В переписке есть чужой текст (веб, письма, файлы): живые демонстрации в чате не запустятся. Пишется служебной
     * пометкой, модели и экрану она не видна. Картинки в ответах агента считаются чужими и без этого поля.
     */
    externalContent?: true;
  };
  /** 1–5000 сообщений по порядку, одна линейная ветка. */
  messages: readonly ImportedMessageInput[];
}

/** Что модулю нужно от службы чата. */
export interface SubjectChatsDeps {
  storage: ChatStorage;
  attachments?: MessageAttachments;
  choiceForNewChat(ownerId: string): Promise<ModelChoice>;
  /** Проверенный выбор или `null`, если провайдер скрыт из меню (`hiddenFromMenu`): чат тогда без своего выбора. */
  validateModelChoice(choice: ModelChoice): ModelChoice | null;
  logError(message: string): void;
  /** Будит агента нового чата указанием из приветствия (`deliverNotices`). */
  wakeAgent(ownerId: string, chatId: string, instruction: string): Promise<unknown>;
}

/**
 * Чаты объектов приложения, приветствие и импорт переписки. Ничего из этого не запускает ход: нет модели, расхода,
 * лимитов и памяти.
 */
export function createSubjectChats(deps: SubjectChatsDeps) {
  const { storage } = deps;

  /** Запасной путь для хранилища без `importChat`: приветствие пишется после чата; не вышло — чат удаляется. */
  async function addGreeting(chat: Chat, greeting: { text: string }): Promise<void> {
    try {
      await storage.insertMessage(greetingMessage(chat.id, greeting, chat.createdAt));
    } catch (error) {
      await storage.deleteChat(chat.id).catch((cleanup: unknown) => deps.logError(`Не удалось убрать чат ${chat.id} без приветствия: ${String(cleanup)}`));
      throw error;
    }
  }

  /**
   * Чат вместе с приветствием одной записью `importChat`: никто не увидит чат без приветствия, сбой между записями
   * невозможен. Повтор ключа объекта — `DuplicateChatSubjectError`, как у `createChat`.
   */
  async function createChatWithGreeting(
    input: NewChatInput,
    greeting: { text: string },
    importChatInStorage: NonNullable<ChatStorage["importChat"]>,
  ): Promise<Chat> {
    const { createdAt: given, origin: _origin, ...fields } = input;
    const createdAt = given ?? new Date().toISOString();
    await importChatInStorage({ ...fields, createdAt, updatedAt: createdAt }, [greetingMessage(input.id, greeting, createdAt)]);
    const chat = await storage.getChat(input.id);
    if (!chat) throw new Error(`Чат ${input.id} записан, но не читается.`);
    return chat;
  }

  /** Указание из приветствия — один раз; сбой побудки не мешает отдать чат. */
  async function wakeAgent(chat: Chat, instruction: string): Promise<void> {
    try {
      await deps.wakeAgent(chat.ownerId, chat.id, instruction);
    } catch (error) {
      deps.logError(`Не удалось разбудить агента нового чата ${chat.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Новый чат: при `greeting.text` первым сообщением сразу идёт приветствие, при `greeting.instruction` — агент пишет первым. */
  async function createChat(input: NewChatInput, greeting: ChatGreeting | undefined): Promise<Chat> {
    if (!greeting) return storage.createChat(input);
    assertGreeting(greeting);
    if (greeting.text === undefined) {
      const chat = await storage.createChat(input);
      await wakeAgent(chat, greeting.instruction);
      return chat;
    }
    // `importChat` не хранит канал чата (`origin`): такой чат — запасным путём.
    const importChatInStorage = storage.importChat?.bind(storage);
    if (importChatInStorage && input.origin === undefined) return createChatWithGreeting(input, greeting, importChatInStorage);
    const chat = await storage.createChat(input);
    await addGreeting(chat, greeting);
    return chat;
  }

  async function openSubjectChat(input: OpenSubjectChatInput): Promise<OpenSubjectChatResult> {
    assertSubjectKey(input.key);
    if (input.data !== undefined) assertSubjectData(input.data);
    if (input.greeting) assertGreeting(input.greeting);
    const title = input.title === undefined ? undefined : normalizeChatTitle(input.title);
    const find = storage.findChatBySubject?.bind(storage);
    if (!find) throw new Error("Чаты объектов требуют хранилища с findChatBySubject: хранилище приложения его не умеет.");
    const existing = await find(input.ownerId, input.key);
    if (existing) return { chat: existing, created: false };
    try {
      const chat = await createChat(
        {
          id: crypto.randomUUID(),
          ownerId: input.ownerId,
          ...(await deps.choiceForNewChat(input.ownerId)),
          subjectKey: input.key,
          ...(input.data !== undefined && { subjectData: input.data }),
          ...(title !== undefined && { title }),
        },
        input.greeting,
      );
      return { chat, created: true };
    } catch (error) {
      // Гонка: соседний вызов создал чат между поиском и вставкой — отдаём его.
      if (!(error instanceof DuplicateChatSubjectError)) throw error;
      const winner = await find(input.ownerId, input.key);
      if (!winner) throw error;
      return { chat: winner, created: false };
    }
  }

  async function importChat(input: ImportChatInput): Promise<{ chatId: string }> {
    const { ownerId, chat: source, messages: incoming } = input;
    assertImport(input);
    const stateRecords = importedStateRecords(source.state, deps.logError);
    const closure = source.closed === undefined ? undefined : normalizeChatClosure(source.closed);
    const importChatInStorage = storage.importChat?.bind(storage);
    if (!importChatInStorage) throw new Error("Импорт чата требует хранилища с importChat: хранилище приложения его не умеет.");
    const importFile = deps.attachments?.importFile?.bind(deps.attachments);
    const hasImages = incoming.some((message) => message.parts.some((part) => part.type === "image"));
    if (hasImages && !importFile) throw new Error("Картинки в импорте требуют вложений (attachments с importFile): приложение их не подключило.");

    const chatId = source.id ?? crypto.randomUUID();
    if (await storage.getChat(chatId)) throw new ChatAlreadyExistsError(chatId);
    // Занятый ключ видно до загрузки файлов; гонку за ключ ловит сама запись.
    if (source.subjectKey !== undefined && (await storage.findChatBySubject?.(ownerId, source.subjectKey))) {
      throw new DuplicateChatSubjectError(ownerId, source.subjectKey);
    }
    // Скрытый выбор в чате — то же, что выбор по умолчанию: чат заводится без выбора модели.
    const model = (source.model && deps.validateModelChoice(source.model)) || (await deps.choiceForNewChat(ownerId));
    const firstUserText = incoming.find((message) => message.role === "user")?.parts.find((part) => part.type === "text")?.text;
    const title = source.title !== undefined ? normalizeChatTitle(source.title) : firstUserText ? deriveChatTitle(firstUserText) : null;

    const uploaded: StoredFilePart[] = [];
    const discardUploaded = async () => {
      if (uploaded.length === 0) return;
      await deps.attachments?.discardImportedFiles?.(uploaded).catch((error: unknown) => deps.logError(`Импорт чата ${chatId}: не удалось убрать файлы: ${String(error)}`));
    };
    const createdAt = isoDate(source.createdAt ?? incoming[0]!.createdAt);
    try {
      // Начальное состояние — служебным сообщением в корне, перед перенесённой историей: его видят все ветки, в том числе
      // от правки самого первого сообщения. Экран и модель служебных сообщений не получают (`isStateMessage`).
      const messages: StoredMessage[] =
        stateRecords.length > 0 ? [newStoredMessage({ id: crypto.randomUUID(), chatId, parentId: null, role: "user", parts: stateRecords.map(appStatePart), createdAt })] : [];
      for (const message of incoming) {
        const parts: AgentChatMessage["parts"] = [];
        for (const part of message.parts) {
          if (part.type === "text") {
            parts.push({ type: "text", text: part.text });
            continue;
          }
          const file = await importFile!({ ownerId, chatId, bytes: part.bytes, mediaType: part.mediaType, ...(part.filename !== undefined && { filename: part.filename }) }).catch(
            (error: unknown) => {
              // Тип, который приложение не принимает (`acceptedMediaTypes`), — пометка текстом, а не отказ всему импорту.
              if (error instanceof AttachmentRejectedError && error.kind === "unsupported_type") return undefined;
              throw error;
            },
          );
          if (!file) {
            parts.push({ type: "text", text: part.filename ? `[картинка: ${part.filename}]` : "[картинка]" });
            continue;
          }
          uploaded.push(file);
          parts.push(file);
        }
        messages.push(
          newStoredMessage({
            id: message.id ?? crypto.randomUUID(),
            chatId,
            parentId: messages.at(-1)?.id ?? null,
            role: message.role,
            parts,
            createdAt: isoDate(message.createdAt),
          }),
        );
      }
      // Закрытие — частью последнего сообщения: правка открывает новую ветку, как после `closeChat`.
      const last = messages.at(-1)!;
      if (closure) last.parts = [...last.parts, appStatePart({ set: { [CLOSED_STATE_KEY]: closure } })];
      // Чужой текст — служебной пометкой: её видит признак `externalContent`, но не экран и не модель. Откуда картинки
      // ответа агента, служба не знает: они тоже считаются чужими.
      const assistantImages = incoming.some((message) => message.role === "assistant" && message.parts.some((part) => part.type === "image"));
      if (source.externalContent === true || assistantImages) last.parts = [...last.parts, appStatePart({ set: { [EXTERNAL_CONTENT_STATE_KEY]: true } })];
      await importChatInStorage(
        {
          id: chatId,
          ownerId,
          ...model,
          createdAt,
          updatedAt: last.createdAt,
          ...(title && { title }),
          ...(source.subjectKey !== undefined && { subjectKey: source.subjectKey }),
          ...((source.data ?? source.subjectData) !== undefined && { data: (source.data ?? source.subjectData)! }),
        },
        messages,
      );
    } catch (error) {
      await discardUploaded();
      throw error;
    }
    // Копия закрытия для списка и `chatCapabilities`; не записалась — ветка всё равно закрыта, копию догонит чтение чата.
    if (closure && storage.setChatClosed) {
      await storage
        .setChatClosed(chatId, closure)
        .catch((error: unknown) => deps.logError(`Импорт чата ${chatId}: копия закрытия не записалась: ${String(error)}`));
    }
    return { chatId };
  }

  return { createChat, openSubjectChat, importChat };
}

/**
 * Записи состояния импортируемого чата: по записи на верхний ключ (проверки и пределы — как у `model.state`).
 * Неверные данные — исключение до записи.
 */
function importedStateRecords(state: ImportChatInput["chat"]["state"], logError: (message: string) => void): AppStateRecord[] {
  if (state === undefined) return [];
  if (typeof state !== "object" || state === null || Array.isArray(state)) throw new TypeError("chat.state импорта — JSON-объект.");
  const reserved = Object.keys(state).find(isReservedAppStateKey);
  if (reserved !== undefined) throw new TypeError(`chat.state импорта: ключ «${reserved}» на «$» — служебный ключ SDK; закрытие задаётся полем chat.closed.`);
  const records: AppStateRecord[] = [];
  const writer = createAppStateWriter({ base: {}, write: (record) => records.push(record), logError, chatId: "import" });
  for (const [key, value] of Object.entries(state)) writer.set(key, value);
  return records;
}

/** Приветствие — законченный ответ агента без модели и расхода. */
function greetingMessage(chatId: string, greeting: { text: string }, createdAt: string): StoredMessage {
  return newStoredMessage({ id: crypto.randomUUID(), chatId, role: "assistant", parts: [{ type: "text", text: greeting.text }], createdAt });
}

/** Чат для браузера: данные чата и объекта остаются на сервере. */
export function withoutSubjectData(chat: Chat): Chat {
  if (!("subjectData" in chat) && !("data" in chat)) return chat;
  const { subjectData: _hiddenSubject, data: _hidden, ...rest } = chat;
  return rest;
}

function assertSubjectKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > SUBJECT_KEY_MAX_LENGTH) {
    throw new TypeError(`Ключ объекта — строка от 1 до ${SUBJECT_KEY_MAX_LENGTH} знаков.`);
  }
}

function assertSubjectData(data: unknown): void {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new TypeError("Данные объекта — JSON-объект.");
  assertNoProtoKey(data as Record<string, unknown>, "Данные объекта");
  assertNoNulChar(data, "Данные объекта");
  let json: string | undefined;
  try {
    json = JSON.stringify(data);
  } catch {
    throw new TypeError("Данные объекта не переводятся в JSON.");
  }
  if (new TextEncoder().encode(json).length > SUBJECT_DATA_MAX_BYTES) throw new TypeError(`Данные объекта больше ${SUBJECT_DATA_MAX_BYTES / 1024} КБ.`);
}

function assertGreeting(greeting: ChatGreeting): asserts greeting is { text: string } | { instruction: string } {
  const value = greeting?.text ?? greeting?.instruction;
  if ((greeting?.text === undefined) === (greeting?.instruction === undefined)) {
    throw new TypeError("В приветствии ровно одно из двух: text или instruction.");
  }
  if (typeof value !== "string" || value.length === 0 || value.length > GREETING_MAX_LENGTH) {
    throw new TypeError(`Текст или указание приветствия — строка от 1 до ${GREETING_MAX_LENGTH} знаков.`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 с часовым поясом: `2025-01-01T10:00:00Z`, `2025-01-01T10:00:00.5+03:00`. */
const ISO_DATE_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_WITH_ZONE.test(value) && !Number.isNaN(Date.parse(value));
}

function isoDate(value: string): string {
  return new Date(value).toISOString();
}

/** Проверка импорта целиком до любой записи. */
function assertImport({ chat, messages }: ImportChatInput): void {
  if (chat.id !== undefined && (typeof chat.id !== "string" || !UUID.test(chat.id))) throw new TypeError("id импортируемого чата — UUID.");
  if (chat.subjectKey !== undefined) assertSubjectKey(chat.subjectKey);
  if (chat.subjectData !== undefined) assertSubjectData(chat.subjectData);
  if (chat.data !== undefined) assertChatData(chat.data);
  if (chat.createdAt !== undefined && !isValidDate(chat.createdAt)) throw new TypeError("Дата импортируемого чата — строка ISO 8601 с часовым поясом.");
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > IMPORT_MAX_MESSAGES) {
    throw new TypeError(`В импорте от 1 до ${IMPORT_MAX_MESSAGES} сообщений.`);
  }
  const ids = new Set<string>();
  let previous = -Infinity;
  let images = 0;
  let imageBytes = 0;
  messages.forEach((message, index) => {
    const where = `Сообщение импорта №${index + 1}`;
    if (message.role !== "user" && message.role !== "assistant") throw new TypeError(`${where}: роль — user или assistant.`);
    if (message.id !== undefined) {
      if (typeof message.id !== "string" || message.id.length === 0 || ids.has(message.id)) throw new TypeError(`${where}: id — непустая строка без повторов.`);
      ids.add(message.id);
    }
    if (!isValidDate(message.createdAt)) throw new TypeError(`${where}: дата — строка ISO 8601 с часовым поясом.`);
    const time = Date.parse(message.createdAt);
    if (time < previous) throw new TypeError(`${where}: даты сообщений не убывают.`);
    previous = time;
    if (!Array.isArray(message.parts) || message.parts.length === 0) throw new TypeError(`${where}: нет частей.`);
    for (const part of message.parts) {
      if (part.type === "text") {
        if (typeof part.text !== "string" || part.text.length === 0) throw new TypeError(`${where}: пустой текст.`);
      } else if (part.type === "image") {
        if (!(part.bytes instanceof Uint8Array) || part.bytes.length === 0 || typeof part.mediaType !== "string" || !part.mediaType.startsWith("image/")) {
          throw new TypeError(`${where}: картинка — непустые байты и тип image/*.`);
        }
        if (part.filename !== undefined && typeof part.filename !== "string") throw new TypeError(`${where}: имя картинки — строка.`);
        images += 1;
        imageBytes += part.bytes.length;
        if (images > IMPORT_MAX_IMAGES) throw new TypeError(`В импорте не больше ${IMPORT_MAX_IMAGES} картинок.`);
        if (imageBytes > IMPORT_MAX_IMAGE_BYTES) throw new TypeError(`Картинки импорта вместе — не больше ${IMPORT_MAX_IMAGE_BYTES / 1024 / 1024} МБ.`);
      } else {
        throw new TypeError(`${where}: часть — text или image.`);
      }
    }
  });
  if (chat.createdAt !== undefined && Date.parse(chat.createdAt) > Date.parse(messages[0]!.createdAt)) {
    throw new TypeError("Дата импортируемого чата не позже первого сообщения.");
  }
}
