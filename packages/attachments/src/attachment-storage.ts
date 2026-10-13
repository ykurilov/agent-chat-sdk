export type AttachmentKind = "image" | "pdf" | "text";

/** Запись о загруженном файле. Байты хранятся рядом и читаются отдельно. */
export interface StoredAttachment {
  /** Серверный UUID: единственное, из чего складывается адрес файла в хранилище. */
  id: string;
  chatId: string;
  ownerId: string;
  /** Имя для показа. В путь и заголовки попадает только после очистки. */
  name: string;
  /** Определён по содержимому. */
  mediaType: string;
  /**
   * Тип файла, каким его прислали, до ужатия картинки: ужатие может сделать из PNG JPEG. По нему `acceptedMediaTypes`
   * решает, можно ли прикрепить файл. Своё хранилище должно сохранять это поле; в записях старше 0.38.0 его нет.
   */
  sourceMediaType?: string;
  kind: AttachmentKind;
  size: number;
  createdAt: string;
  /** Файл вошёл в отправленное сообщение. */
  attached: boolean;
  /** Текст PDF или текстового файла; извлекается один раз при загрузке и больше не пересчитывается. */
  extractedText?: string;
  textTruncated?: boolean;
}

/**
 * Хранилище файлов вложений. Заменяемое: приложение может написать своё (например, в S3) и проверить его
 * общим набором `describeAttachmentStorageContract` из `@ykurilov/agent-chat-attachments/storage-contract`.
 * `id` — всегда UUID; всё, что на UUID не похоже, хранилище не читает и не пишет (`save` бросает ошибку,
 * остальные методы молча ничего не находят).
 */
export interface AttachmentStorage {
  save(record: StoredAttachment, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<StoredAttachment | undefined>;
  readBytes(id: string): Promise<Uint8Array | undefined>;
  markAttached(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Убирает все файлы чата, в том числе прикреплённые (чат удалён); возвращает, сколько убрано. */
  removeAllOfChat(chatId: string): Promise<number>;
  /** Сколько неотправленных файлов и байт у человека во всех его чатах (для лимитов на загрузки). */
  unattachedTotals(ownerId: string): Promise<{ files: number; bytes: number }>;
  /** Убирает непривязанные файлы, загруженные раньше `before`; возвращает, сколько убрано. */
  removeUnattachedOlderThan(before: Date): Promise<number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAttachmentId(value: string): boolean {
  return UUID.test(value);
}

export function assertAttachmentId(value: string): void {
  if (!isAttachmentId(value)) throw new TypeError("Идентификатор вложения должен быть UUID");
}
