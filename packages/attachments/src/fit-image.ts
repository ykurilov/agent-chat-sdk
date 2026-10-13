/*
 * Порядок ужатия картинки перенесён из pi-mono (packages/coding-agent/src/utils/image-resize-core.ts), лицензия MIT.
 * Copyright (c) 2025 Mario Zechner
 */
import sharp from "sharp";
import type { Sharp } from "sharp";

/** Длинная сторона картинки для модели, пикселей: больше модели не нужно, а токены за картинку растут с пикселями. */
export const MAX_IMAGE_SIDE = 2000;
/** Предел картинки в base64: запас ниже 5 МБ, которые принимает самый строгий провайдер (Anthropic). */
export const MAX_IMAGE_BASE64_BYTES = 4.5 * 1024 * 1024;

/**
 * Больше пикселей не разбирается: файл в 20 МБ может быть однотонной картинкой 16000×16000, которая в памяти
 * занимает гигабайт. 60 млн хватает фото с телефона на 50 Мп.
 */
export const MAX_INPUT_PIXELS = 60_000_000;

const SHARP_OPTIONS = { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS } as const;
const JPEG_QUALITIES = [80, 70, 55, 40];
const SHRINK_STEP = 0.75;

export interface FittedImage {
  bytes: Uint8Array;
  mediaType: string;
  width: number;
  height: number;
  /** `false` — картинка уже была в пределах и стоит прямо: байты те же. */
  changed: boolean;
}

const base64Length = (byteLength: number) => Math.ceil(byteLength / 3) * 4;

/**
 * Картинка, которую можно отправить модели: повёрнута по EXIF, не больше 2000×2000 и ~4,5 МБ в base64.
 * Сначала уменьшает стороны и берёт меньший из PNG и JPEG, потом снижает качество JPEG, потом уменьшает дальше.
 * Не картинка, битые байты, больше `MAX_INPUT_PIXELS` или ужать не вышло — `null`. Одни и те же байты дают один и тот же результат.
 */
export async function fitImageForModel(bytes: Uint8Array, mediaType: string): Promise<FittedImage | null> {
  try {
    const meta = await sharp(bytes, SHARP_OPTIONS).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_INPUT_PIXELS) return null;
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    const upright = (meta.orientation ?? 1) === 1;
    if (upright && width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE && base64Length(bytes.length) < MAX_IMAGE_BASE64_BYTES) {
      return { bytes, mediaType, width, height, changed: false };
    }

    const scale = Math.min(1, MAX_IMAGE_SIDE / width, MAX_IMAGE_SIDE / height);
    let target = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    for (;;) {
      const found = await encodeWithinLimit(bytes, target, { photo: meta.format === "jpeg", transparent: meta.hasAlpha === true });
      if (found) return { ...found, ...target, changed: true };
      if (target.width === 1 && target.height === 1) return null;
      target = { width: Math.max(1, Math.floor(target.width * SHRINK_STEP)), height: Math.max(1, Math.floor(target.height * SHRINK_STEP)) };
    }
  } catch {
    return null;
  }
}

/**
 * Первый вариант в пределах. Фото сразу идёт в JPEG. Прочее пробует PNG: прозрачное остаётся PNG, непрозрачное берёт
 * меньший из PNG и JPEG. Дальше — JPEG от лучшего качества к худшему. Анимация не сохраняется: берётся первый кадр.
 */
async function encodeWithinLimit(
  bytes: Uint8Array,
  size: { width: number; height: number },
  source: { photo: boolean; transparent: boolean },
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  const resized = (): Sharp => sharp(bytes, SHARP_OPTIONS).rotate().resize(size.width, size.height, { fit: "fill" });
  const jpeg = async (quality: number) => new Uint8Array(await resized().flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer());
  const fits = (encoded: Uint8Array) => base64Length(encoded.length) < MAX_IMAGE_BASE64_BYTES;
  if (!source.photo) {
    const png = new Uint8Array(await resized().png().toBuffer());
    if (fits(png)) {
      if (source.transparent) return { bytes: png, mediaType: "image/png" };
      const smaller = await jpeg(JPEG_QUALITIES[0]!);
      return smaller.length < png.length ? { bytes: smaller, mediaType: "image/jpeg" } : { bytes: png, mediaType: "image/png" };
    }
  }
  for (const quality of JPEG_QUALITIES) {
    const encoded = await jpeg(quality);
    if (fits(encoded)) return { bytes: encoded, mediaType: "image/jpeg" };
  }
  return null;
}
