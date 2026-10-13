import type { MessengerUserMessage } from "./chat-port";
import type { InboundFile, InboundUpdate, MessengerAdapter } from "./messenger-adapter";
import { DownloadTooLargeError, MAX_DOWNLOAD_BYTES } from "./messenger-files";
import { defaultTextsOf, type MessengerTexts, type MessengerTextsOf } from "./messenger-texts";
import type { AttachmentIngest, AudioTranscriber } from "./types";

/** Больше этого мессенджеры боту не отдают (Telegram — 20 МБ); голосовое больше — «слишком длинное». */
export const MAX_INBOUND_FILE_BYTES = MAX_DOWNLOAD_BYTES;
/** Голосовое длиннее — «слишком длинное», распознавание не запускается. */
export const MAX_VOICE_MS = 10 * 60_000;
const OPUS_GRANULE_RATE = 48_000;
const OGG_MAX_PAGE_BYTES = 65_307;

type UserParts = MessengerUserMessage["parts"];

/** Сообщение человека → части для агента или ответ человеку, почему не вышло. */
export type PreparedInput = { parts: UserParts; voice: boolean } | { reply: string };

/** Файлы и голос на входе (T037): вложения через `AttachmentIngest`, голос через `AudioTranscriber`. */
export function createInboundMedia(options: { attachments?: AttachmentIngest; transcribe?: AudioTranscriber; textsOf?: MessengerTextsOf; logError?(error: unknown): void }) {
  const textsOf = options.textsOf ?? defaultTextsOf;
  const logError = (error: unknown) => options.logError?.(error);
  const limitMb = Math.round(MAX_INBOUND_FILE_BYTES / (1024 * 1024));

  async function toUserParts(input: { adapter: MessengerAdapter; update: InboundUpdate; ownerId: string; chatId: string }): Promise<PreparedInput> {
    const { update } = input;
    if (update.kind === "voice") return voiceParts(input);
    const texts = textsOf(update.account);
    const parts: UserParts = update.text?.trim() ? [{ type: "text", text: update.text }] : [];
    const files = update.files ?? [];
    if (files.length === 0) return { parts, voice: false };
    const ingest = options.attachments;
    if (!ingest) return { reply: texts.filesOff };
    for (const file of files) {
      if ((file.size ?? 0) > MAX_INBOUND_FILE_BYTES) return { reply: texts.fileTooBig(limitMb) };
      const downloaded = await download(input.adapter, file);
      if (downloaded === "too_large") return { reply: texts.fileTooBig(limitMb) };
      if (!downloaded) return { reply: texts.failed };
      if (downloaded.bytes.length > MAX_INBOUND_FILE_BYTES) return { reply: texts.fileTooBig(limitMb) };
      const result = await ingest({ ownerId: input.ownerId, chatId: input.chatId, name: downloaded.name, mediaType: downloaded.mediaType, bytes: downloaded.bytes }).catch(
        (error: unknown) => {
          logError(error);
          return null;
        },
      );
      if (!result) return { reply: texts.failed };
      if (!result.ok) return { reply: texts.fileRefused(result.reason) };
      parts.push({ type: "file", url: `attachment:${result.attachment.id}`, mediaType: result.attachment.mediaType, filename: result.attachment.name });
    }
    return { parts, voice: false };
  }

  async function voiceParts(input: { adapter: MessengerAdapter; update: InboundUpdate; ownerId: string; chatId: string }): Promise<PreparedInput> {
    const { update } = input;
    const texts = textsOf(update.account);
    // Мессенджер сам распознал (MAX): своё распознавание не нужно.
    if (update.transcription?.trim()) return voiceText(update.transcription.trim(), texts);
    const transcribe = options.transcribe;
    if (!transcribe) return { reply: texts.voiceOff };
    const file = update.files?.[0];
    if (!file) return { reply: texts.voiceFailed };
    if ((file.size ?? 0) > MAX_INBOUND_FILE_BYTES || (file.durationMs ?? 0) > MAX_VOICE_MS) return { reply: texts.voiceTooLong };
    const downloaded = await download(input.adapter, file);
    if (downloaded === "too_large") return { reply: texts.voiceTooLong };
    if (!downloaded) return { reply: texts.voiceFailed };
    if (downloaded.bytes.length > MAX_INBOUND_FILE_BYTES || (oggDurationMs(downloaded.bytes) ?? 0) > MAX_VOICE_MS) return { reply: texts.voiceTooLong };
    try {
      const result = await transcribe({ ownerId: input.ownerId, chatId: input.chatId, audio: downloaded.bytes, mediaType: downloaded.mediaType });
      if ("skipped" in result) return { reply: result.skipped === "limit" ? texts.voiceLimit : texts.voiceFailed };
      return result.text.trim() ? voiceText(result.text.trim(), texts) : { reply: texts.voiceFailed };
    } catch (error) {
      logError(error);
      return { reply: texts.voiceFailed };
    }
  }

  /** Файл, `too_large` — мессенджер отдаёт больше предела (скачивание оборвано), `null` — не вышло. */
  async function download(adapter: MessengerAdapter, file: InboundFile) {
    try {
      return await adapter.downloadFile(file);
    } catch (error) {
      if (error instanceof DownloadTooLargeError) return "too_large" as const;
      logError(error);
      return null;
    }
  }

  return { toUserParts };
}

export type InboundMedia = ReturnType<typeof createInboundMedia>;

/** Пометка «[голосовое]» перед распознанным текстом; пустая пометка — текст без неё. */
const voiceText = (text: string, texts: MessengerTexts): PreparedInput => ({
  parts: [{ type: "text", text: texts.voiceMark ? `[${texts.voiceMark}] ${text}` : text }],
  voice: true,
});

/**
 * Длина Ogg/Opus по позиции последней страницы (у Opus она всегда в отсчётах 48 кГц). Голосовые Telegram и VK — Ogg;
 * не Ogg — `undefined`, тогда остаётся только предел размера.
 */
export function oggDurationMs(bytes: Uint8Array): number | undefined {
  const isPageAt = (offset: number) => bytes[offset] === 0x4f && bytes[offset + 1] === 0x67 && bytes[offset + 2] === 0x67 && bytes[offset + 3] === 0x53;
  if (!isPageAt(0)) return undefined;
  // Страница Ogg не длиннее 64 КБ: последняя начинается в хвосте файла.
  const stopAt = Math.max(0, bytes.length - OGG_MAX_PAGE_BYTES);
  for (let offset = bytes.length - 14; offset >= stopAt; offset--) {
    if (isPageAt(offset)) {
      const granule = new DataView(bytes.buffer, bytes.byteOffset + offset + 6, 8).getBigInt64(0, true);
      return granule > 0n ? Number((granule * 1000n) / BigInt(OPUS_GRANULE_RATE)) : undefined;
    }
  }
  return undefined;
}
