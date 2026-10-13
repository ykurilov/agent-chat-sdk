import type { AttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { downloadGeneratedImage, imageExtensions } from "./download-image";
import type { DownloadedImage } from "./download-image";
import type { ProcessedImage } from "./postprocess-image";

export { DOWNLOAD_TIMEOUT_MS } from "./download-image";

export interface SaveGeneratedImageInput {
  /** Адрес готовой картинки у провайдера. */
  url: string;
  fetch: typeof globalThis.fetch;
  storage: AttachmentStorage;
  chatId: string;
  ownerId: string;
  /** Номер картинки в вызове, с 1: из него имя файла `image-<n>.<ext>`. */
  number: number;
  maxImageBytes: number;
  /** Сайт подключения провайдера из настройки (`https://host:port`): с него можно скачивать и по http, и с localhost. */
  trustedOrigin?: string;
  /** «Стоп» хода: пришедшее после него не сохраняется. */
  abortSignal?: AbortSignal;
  /** Обработка перед сохранением (формат, размер); её итог и сохраняется. */
  transform?: (bytes: Uint8Array, mediaType: string) => Promise<ProcessedImage>;
  now: () => Date;
}

/** Сохранённая картинка; размер — из файла (PNG или после обработки), иначе не известен. */
export interface SavedImageFile {
  id: string;
  mediaType: string;
  size: number;
  width?: number;
  height?: number;
}

/**
 * Скачивает готовую картинку по адресу провайдера (без заголовков подключения: это чужой склад) и сохраняет её
 * прикреплённым файлом чата и владельца (FR-038). Тип — только по содержимому: PNG, JPEG или WebP. Сбой —
 * `ImageGenerationError`; «Стоп» пробрасывается как есть, и ничего не сохраняется (FR-042).
 */
export async function saveGeneratedImage(input: SaveGeneratedImageInput): Promise<SavedImageFile> {
  const file = await downloadGeneratedImage({
    url: input.url,
    fetch: input.fetch,
    maxImageBytes: input.maxImageBytes,
    ...(input.trustedOrigin !== undefined && { trustedOrigin: input.trustedOrigin }),
    ...(input.abortSignal && { abortSignal: input.abortSignal }),
    ...(input.transform && { transform: input.transform }),
  });
  return saveImageToChat({ storage: input.storage, chatId: input.chatId, ownerId: input.ownerId, number: input.number, file, now: input.now });
}

export interface SaveImageToChatInput {
  storage: AttachmentStorage;
  chatId: string;
  ownerId: string;
  /** Номер картинки в вызове, с 1: из него имя файла `image-<n>.<ext>`. */
  number: number;
  file: DownloadedImage;
  now: () => Date;
}

/** Скачанная картинка — прикреплённым файлом чата и владельца. */
export async function saveImageToChat(input: SaveImageToChatInput): Promise<SavedImageFile> {
  const { file } = input;
  const extension = imageExtensions[file.mediaType]!;
  const id = crypto.randomUUID();
  await input.storage.save(
    {
      id,
      chatId: input.chatId,
      ownerId: input.ownerId,
      name: `image-${input.number}.${extension}`,
      mediaType: file.mediaType,
      kind: "image",
      size: file.bytes.length,
      createdAt: input.now().toISOString(),
      attached: true,
    },
    file.bytes,
  );
  return { id, mediaType: file.mediaType, size: file.bytes.length, ...(file.width !== undefined && file.height !== undefined && { width: file.width, height: file.height }) };
}
