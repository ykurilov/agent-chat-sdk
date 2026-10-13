import type { AgentChatMessage } from "../conversation/types";
import type { ModelProfile } from "../models/model-catalog";

/** Часть `file` сообщения так, как её прислал клиент: верить в ней можно только ссылке. */
export interface IncomingFilePart {
  type: "file";
  url: string;
  mediaType?: unknown;
  filename?: unknown;
}

/** Часть `file` в том виде, в каком она сохраняется в сообщении. */
export type StoredFilePart = Extract<AgentChatMessage["parts"][number], { type: "file" }>;

/**
 * Вложения к сообщению: что ядру нужно от расширения. Ядро о файлах, хранилищах и типах ничего не знает —
 * это делает пакет `@ykurilov/agent-chat-attachments`.
 */
export interface MessageAttachments {
  /**
   * Постоянная часть инструкции агенту: как относиться к содержимому файлов. Ядро дописывает её к инструкции
   * агента само (если приложение не добавило её раньше), чтобы вложения не приходилось подключать в двух местах.
   */
  instructions?: string;
  /**
   * Проверяет вложения нового сообщения (они принадлежат этому чату и этому человеку, лимиты соблюдены, срок
   * не вышел) и возвращает части для сохранения. Файлы ещё не прикреплены: сообщение может не записаться.
   * @throws AttachmentRejectedError вложения не подходят: сообщение не сохраняется.
   */
  acceptUserParts(input: { userId: string; chatId: string; parts: readonly IncomingFilePart[] }): Promise<StoredFilePart[]>;
  /** Отмечает файлы прикреплёнными; вызывается перед записью сообщения: файл, отмеченный зря, безвреден, а неотмеченный файл записанного сообщения удалила бы чистка. */
  confirmUserParts(parts: readonly StoredFilePart[]): Promise<void>;
  /**
   * Чат удаляется: убирает все его файлы, в том числе прикреплённые к сообщениям. Ошибка останавливает удаление
   * чата целиком: его можно повторить. Не задан — файлы остаются на совести приложения.
   */
  removeChatFiles?(chatId: string): Promise<void>;
  /**
   * Импорт переписки (`ChatService.importChat`): сохраняет картинку чата и возвращает часть `file`, уже прикреплённую
   * (чистка неотправленных её не тронет). Лимит неотправленных файлов не действует. Чата в хранилище ещё нет.
   * Не задан — импорт с картинками отказывает до записи.
   * @throws AttachmentRejectedError файл не картинка или не подходит по размеру.
   */
  importFile?(input: { ownerId: string; chatId: string; bytes: Uint8Array; mediaType: string; filename?: string }): Promise<StoredFilePart>;
  /** Импорт не записался: убирает файлы, сохранённые `importFile` для него. */
  discardImportedFiles?(parts: readonly StoredFilePart[]): Promise<void>;
  /**
   * Заменяет части `file` в истории тем, что увидит модель: байтами картинки, текстом файла или пометкой.
   * Вызывается на единственной точке сборки запроса. Результат зависит только от истории и модели.
   */
  prepareHistory(input: {
    chatId: string;
    history: readonly AgentChatMessage[];
    model: { profile: ModelProfile; providerId: string };
  }): Promise<AgentChatMessage[]>;
}

/** Вложения отклонены: текст безопасно показать собеседнику; `kind` — для клиента. */
export class AttachmentRejectedError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentRejectedError";
  }
}

const UNAVAILABLE_ATTACHMENT_NOTE = "[Вложение недоступно.]";

/**
 * Приложение без расширения вложений: ссылки на чужие файлы модель понять не может, поэтому части `file`
 * убираются из запроса. Сообщение, в котором больше ничего нет, получает короткую пометку.
 */
export function withoutFileParts(history: readonly AgentChatMessage[]): AgentChatMessage[] {
  return history.map((message) => {
    if (!message.parts.some((part) => part.type === "file")) return message;
    const parts = message.parts.filter((part) => part.type !== "file");
    return { ...message, parts: parts.length > 0 ? parts : [{ type: "text", text: UNAVAILABLE_ATTACHMENT_NOTE }] };
  });
}
