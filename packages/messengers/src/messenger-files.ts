import { readAtMost } from "./bounded-body";

/** Файл для загрузки в мессенджер. */
export interface UploadFile {
  bytes: Uint8Array;
  name: string;
  mediaType?: string;
}

/** Форма загрузки (multipart): строки — полями, файлы — частями с именем и типом. Пустые поля пропускаются. */
export function uploadForm(fields: Record<string, string | UploadFile | undefined>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === "string") form.set(name, value);
    else form.set(name, new Blob([value.bytes as BlobPart], value.mediaType ? { type: value.mediaType } : {}), value.name);
  }
  return form;
}

/** Больше этого файл из мессенджера не скачивается (Telegram отдаёт боту до 20 МБ). */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** Файл больше предела: скачивание оборвано, в память он целиком не попал. */
export class DownloadTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`файл больше ${maxBytes} байт`);
    this.name = "DownloadTooLargeError";
  }
}

/**
 * Скачанный файл: содержимое и тип из заголовка, без параметров вроде `charset`. Больше `maxBytes` — чтение
 * обрывается на пределе, `DownloadTooLargeError`: размеру из события мессенджера не верим.
 */
export async function downloadedFile(response: Response, maxBytes = MAX_DOWNLOAD_BYTES): Promise<{ bytes: Uint8Array; mediaType?: string }> {
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const bytes = await readAtMost(response, maxBytes, () => new DownloadTooLargeError(maxBytes));
  return { bytes, ...(mediaType && { mediaType }) };
}

const MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  zip: "application/zip",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Тип файла по расширению (`pdf`, `.PDF`); неизвестное — `undefined`. */
export function mediaTypeOfExtension(ext: string | undefined): string | undefined {
  return ext ? MEDIA_TYPES[ext.toLowerCase().replace(/^\./, "")] : undefined;
}

/** Тип файла по имени (`отчёт.pdf`); без расширения — `undefined`. */
export function mediaTypeOfFileName(name: string | undefined): string | undefined {
  return name?.includes(".") ? mediaTypeOfExtension(name.split(".").pop()) : undefined;
}
