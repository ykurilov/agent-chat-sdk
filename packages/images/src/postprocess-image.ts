import type { ImageFileFormat } from "./image-catalog";

/** Постобработка готовой картинки перед сохранением: формат файла и предел большей стороны. */
export interface ImageOutputOptions {
  /** Формат файла; не указан — формат провайдера. Прозрачность держат `png` и `webp`. */
  format?: ImageFileFormat;
  /** Большая сторона не длиннее этого, пикселей; меньшая картинка не увеличивается. */
  maxSide?: number;
}

export interface ProcessedImage {
  bytes: Uint8Array;
  mediaType: string;
  width: number;
  height: number;
}

export const imageFileFormats: readonly ImageFileFormat[] = ["png", "jpeg", "webp"];

const mediaTypes: Record<ImageFileFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const formatOf: Record<string, ImageFileFormat> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };

/** Ошибка настройки `output` — текст с именем поля. */
export function checkImageOutput(output: ImageOutputOptions | undefined, where: string): void {
  if (!output) return;
  if (output.format !== undefined && !imageFileFormats.includes(output.format)) {
    throw new Error(`Картинки: ${where}output.format — одно из ${imageFileFormats.join(", ")}`);
  }
  if (output.maxSide !== undefined && !(Number.isInteger(output.maxSide) && output.maxSide > 0)) {
    throw new Error(`Картинки: ${where}output.maxSide — целое число больше нуля`);
  }
}

/**
 * Формат и размер через sharp. sharp грузится только здесь и только при первой обработке: приложение без `output` его
 * не загружает. Прозрачность сохраняется: PNG и WebP пишутся с альфой.
 */
export async function postprocessImage(bytes: Uint8Array, mediaType: string, output: ImageOutputOptions): Promise<ProcessedImage> {
  const { default: sharp } = await import("sharp");
  const format = output.format ?? formatOf[mediaType] ?? "png";
  let image = sharp(bytes);
  if (output.maxSide !== undefined) image = image.resize({ width: output.maxSide, height: output.maxSide, fit: "inside", withoutEnlargement: true });
  const { data, info } = await image.toFormat(format).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), mediaType: mediaTypes[format], width: info.width, height: info.height };
}

/** Размер PNG из заголовка (IHDR), без разбора картинки; не PNG или заголовок битый — `undefined`. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isHeader = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) === "IHDR";
  if (view.getUint32(0) !== 0x89504e47 || !isHeader) return undefined;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}
