import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import type { IncomingFilePart, MessageAttachments, StoredFilePart } from "@ykurilov/agent-chat-core";
import { isAttachmentId } from "./attachment-storage";
import type { AttachmentStorage, StoredAttachment } from "./attachment-storage";
import { detectableMediaTypes } from "./detect-file-kind";
import { estimateTokens } from "./extract-text";
import { resolveImagesForBlindModels } from "./images-for-blind-models";
import type { ImagesForBlindModels } from "./images-for-blind-models";
import { attachmentsInstructions } from "./instructions";
import { resolveAttachmentLimits } from "./limits";
import type { AttachmentLimits } from "./limits";
import { createImagePlans, prepareHistory } from "./prepare-history";
import { createAttachmentRoutes } from "./attachment-routes";
import type { AttachmentRoutes } from "./attachment-routes";

const PREFIX = "attachment:";
const ABANDONED_AFTER_MS = 24 * 60 * 60_000;
const CLEANUP_EVERY_MS = 15 * 60_000;

export interface CreateAttachmentsOptions {
  /** Номер [Фото №N] рядом с новой картинкой человека. Старые файлы без метки не нумеруются. */
  imageNumbers?: boolean;
  storage: AttachmentStorage;
  limits?: Partial<AttachmentLimits>;
  /** Часы; в тестах подменяются. */
  now?: () => Date;
  /**
   * Только эти типы файлов (тип определяется по содержимому), например `["image/png", "image/jpeg", "image/webp"]`.
   * Остальные — отказ `unsupported_type` до разбора и записи; клиент узнаёт список из настроек и отказывает сразу.
   * Нет — все типы, которые SDK умеет: картинки, PDF, текст.
   */
  acceptedMediaTypes?: readonly string[];
  /**
   * Модель без зрения (у выбранного провайдера) получает вместо картинки постоянную плашку с номером вложения и
   * смотрит картинку инструментом приложения (`readChatImage`). Нет — прежняя пометка «картинка не показана».
   */
  imagesForBlindModels?: ImagesForBlindModels;
}

/** Картинка чата для инструмента приложения. */
export interface ChatImage {
  id: string;
  name: string;
  mediaType: string;
  /** Кто загрузил картинку. */
  authorId: string;
  bytes: Uint8Array;
}

/**
 * Вложения для `createChatHandler({ attachments })`: приём в сообщение, сборка запроса и HTTP-адреса. `storage` —
 * хранилище файлов для других пакетов: картинки агента (`@ykurilov/agent-chat-images`) пишутся в него и отдаются
 * тем же адресом вложений.
 */
export type Attachments = MessageAttachments &
  AttachmentRoutes & {
    readonly storage: AttachmentStorage;
    /**
     * Картинка этого чата по номеру вложения — для инструмента, который смотрит картинку за модель без зрения;
     * `chatId` — из `AgentToolsModel.chatId`. Картинка другого чата, не картинка, неверный или неизвестный номер — `undefined`.
     */
    readChatImage(input: { chatId: string; attachmentId: string }): Promise<ChatImage | undefined>;
  };

export function createAttachments(options: CreateAttachmentsOptions): Attachments {
  const { storage } = options;
  const limits = resolveAttachmentLimits(options.limits);
  const now = options.now ?? (() => new Date());
  const imagePlans = createImagePlans(limits.imageCacheBytes);
  const acceptedMediaTypes = options.acceptedMediaTypes && checkedMediaTypes(options.acceptedMediaTypes);
  const blindImages = options.imagesForBlindModels && resolveImagesForBlindModels(options.imagesForBlindModels);
  let lastCleanupAt = 0;

  /** Брошенные загрузки (выбрали файл и ушли) убираются при очередной загрузке, не чаще раза в 15 минут. */
  function cleanUpAbandoned(): void {
    const current = now().getTime();
    if (current - lastCleanupAt < CLEANUP_EVERY_MS) return;
    lastCleanupAt = current;
    void storage.removeUnattachedOlderThan(new Date(current - ABANDONED_AFTER_MS)).catch(() => {});
  }

  const { routes, internals } = createAttachmentRoutes({
    storage,
    limits,
    now,
    onUpload: cleanUpAbandoned,
    ...(acceptedMediaTypes && { acceptedMediaTypes }),
    ...(blindImages && { imagesForBlindModels: true }),
  });

  async function acceptUserParts(input: { userId: string; chatId: string; parts: readonly IncomingFilePart[] }): Promise<StoredFilePart[]> {
    const notFound = () => new AttachmentRejectedError("attachment_not_found", "Файл не найден: загрузите его ещё раз");
    const ids = [...new Set(input.parts.map((part) => (part.url.startsWith(PREFIX) ? part.url.slice(PREFIX.length) : "")))];
    if (ids.length > limits.maxFiles) {
      throw new AttachmentRejectedError("too_many", `Можно прикрепить не больше ${limits.maxFiles} файлов`);
    }
    const records: StoredAttachment[] = [];
    for (const id of ids) {
      const record = isAttachmentId(id) ? await storage.get(id) : undefined;
      if (!record || record.chatId !== input.chatId || record.ownerId !== input.userId) throw notFound();
      if (!record.attached && Date.parse(record.createdAt) < now().getTime() - ABANDONED_AFTER_MS) {
        // Неотправленный файл старше суток уже подлежит чистке: убираем его сами и просим загрузить заново.
        await storage.remove(record.id);
        throw new AttachmentRejectedError("attachment_expired", "Файл хранился слишком долго и удалён: загрузите его снова");
      }
      if (acceptedMediaTypes && !acceptedMediaTypes.includes(record.sourceMediaType ?? record.mediaType)) {
        // Файл загружен до того, как приложение сузило типы. Решает исходный тип: ужатие могло сделать из PNG JPEG.
        throw new AttachmentRejectedError("unsupported_type", `Такой файл прикрепить нельзя: подойдут только ${acceptedMediaTypes.map(typeName).join(", ")}.`);
      }
      records.push(record);
    }
    const textTokens = records.reduce((sum, record) => sum + estimateTokens(record.extractedText ?? ""), 0);
    if (textTokens > limits.maxMessageTextTokens) {
      throw new AttachmentRejectedError("too_much_text", "В файлах слишком много текста: уберите часть файлов");
    }
    return records.map((record) => ({ type: "file", url: `${PREFIX}${record.id}`, mediaType: record.mediaType, filename: record.name }));
  }

  async function confirmUserParts(parts: readonly StoredFilePart[]): Promise<void> {
    const ids = new Set(parts.flatMap((part) => (part.url.startsWith(PREFIX) ? [part.url.slice(PREFIX.length)] : [])));
    await Promise.all([...ids].map((id) => storage.markAttached(id)));
  }

  return {
    storage,
    ...(options.imageNumbers && { imageNumbers: true }),
    instructions: blindImages ? `${attachmentsInstructions} ${blindImages.instructions}` : attachmentsInstructions,
    // Текст файла блоком `<attachment …>`, подделанный в ответе, ядро вырезает.
    serviceBlocks: [{ tag: "attachment" }],
    acceptUserParts,
    confirmUserParts,
    prepareHistory: (input) => prepareHistory({ storage, imagePlans, ...input, ...(options.imageNumbers && { imageNumbers: true }), ...(blindImages && { imagesForBlindModels: blindImages }) }),
    async readChatImage({ chatId, attachmentId }) {
      const record = isAttachmentId(attachmentId) ? await storage.get(attachmentId) : undefined;
      if (!record || record.chatId !== chatId || record.kind !== "image") return undefined;
      const bytes = await storage.readBytes(record.id);
      return bytes && { id: record.id, name: record.name, mediaType: record.mediaType, authorId: record.ownerId, bytes };
    },
    async removeChatFiles(chatId) {
      await storage.removeAllOfChat(chatId);
    },
    async importFile({ ownerId, chatId, bytes, mediaType, filename }) {
      const result = await internals.ingestImportedImage({ userId: ownerId, chatId, bytes, name: filename ?? defaultImageName(mediaType) });
      if (!result.ok) throw new AttachmentRejectedError(result.reason, `Картинка импорта не принята: ${result.reason}.`);
      return { type: "file", url: `${PREFIX}${result.attachment.id}`, mediaType: result.attachment.mediaType, filename: result.attachment.name };
    },
    async discardImportedFiles(parts) {
      await Promise.all(parts.flatMap((part) => (part.url.startsWith(PREFIX) ? [storage.remove(part.url.slice(PREFIX.length))] : [])));
    },
    ...routes,
  };
}

function checkedMediaTypes(types: readonly string[]): readonly string[] {
  if (types.length === 0) throw new TypeError("acceptedMediaTypes: нужен хотя бы один тип");
  const unknown = types.filter((type) => !detectableMediaTypes.includes(type));
  if (unknown.length > 0) {
    throw new TypeError(`acceptedMediaTypes: SDK не распознаёт ${unknown.join(", ")}; можно ${detectableMediaTypes.join(", ")}`);
  }
  return [...new Set(types)];
}

const TYPE_NAMES: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "application/pdf": "PDF",
};

/** Тип для человека: «PNG», «PDF», «text/csv». */
function typeName(mediaType: string): string {
  return TYPE_NAMES[mediaType] ?? mediaType;
}

/** Имя картинки импорта без имени: «image.png», «image.jpeg». */
function defaultImageName(mediaType: string): string {
  const extension = /^image\/([a-z0-9]+)/i.exec(mediaType)?.[1]?.toLowerCase();
  return extension ? `image.${extension}` : "image";
}
