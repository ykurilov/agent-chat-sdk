import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fitImageForModel, MAX_IMAGE_BASE64_BYTES, MAX_IMAGE_SIDE, MAX_INPUT_PIXELS } from "../src/fit-image";
import { makePng, utf8 } from "./support/sample-files";

const base64Length = (bytes: Uint8Array) => Math.ceil(bytes.length / 3) * 4;

/** Фото как с телефона: плавная заливка, JPEG; `orientation` — метка поворота EXIF. */
async function photo(width: number, height: number, orientation?: number): Promise<Uint8Array> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg({ quality: 90 });
  return new Uint8Array(await (orientation ? image.withMetadata({ orientation }) : image).toBuffer());
}

/** Шум не сжимается: PNG выходит огромным даже при небольших сторонах. */
async function noisePng(side: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(side * side * 3);
  let seed = 7;
  for (let index = 0; index < raw.length; index++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[index] = seed >> 16;
  }
  return new Uint8Array(await sharp(raw, { raw: { width: side, height: side, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer());
}

describe("картинка для модели", () => {
  it("маленькая картинка в пределах — байты как были", async () => {
    const png = makePng(4, [10, 20, 30]);
    const fitted = await fitImageForModel(png, "image/png");
    expect(fitted).not.toBeNull();
    expect(fitted!.changed).toBe(false);
    expect(fitted!.bytes).toBe(png);
    expect(fitted!.mediaType).toBe("image/png");
  });

  it("большое фото уменьшается до 2000 по длинной стороне, пропорции сохраняются", async () => {
    const fitted = await fitImageForModel(await photo(4000, 3000), "image/jpeg");
    expect(fitted!.changed).toBe(true);
    const meta = await sharp(fitted!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([MAX_IMAGE_SIDE, 1500]);
    expect([fitted!.width, fitted!.height]).toEqual([MAX_IMAGE_SIDE, 1500]);
    expect(fitted!.mediaType).toBe(`image/${meta.format === "jpeg" ? "jpeg" : meta.format}`);
  });

  it("фото повёрнуто по EXIF: модель видит его стоя, метки поворота больше нет", async () => {
    const fitted = await fitImageForModel(await photo(300, 200, 6), "image/jpeg");
    expect(fitted!.changed).toBe(true);
    const meta = await sharp(fitted!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([200, 300]);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("тяжёлая картинка в пределах сторон ужимается ниже ~4,5 МБ в base64", async () => {
    const heavy = await noisePng(1900);
    expect(base64Length(heavy)).toBeGreaterThan(MAX_IMAGE_BASE64_BYTES);
    const fitted = await fitImageForModel(heavy, "image/png");
    expect(fitted!.changed).toBe(true);
    expect(base64Length(fitted!.bytes)).toBeLessThan(MAX_IMAGE_BASE64_BYTES);
  });

  it("одно и то же фото даёт одни и те же байты (запрос стабилен для кэша)", async () => {
    const source = await photo(3000, 2000);
    const [first, second] = await Promise.all([fitImageForModel(source, "image/jpeg"), fitImageForModel(source, "image/jpeg")]);
    expect(Buffer.from(first!.bytes).equals(Buffer.from(second!.bytes))).toBe(true);
  });

  it("огромная однотонная PNG (маленький файл, десятки миллионов пикселей) — null: в памяти она заняла бы гигабайт", async () => {
    const huge = new Uint8Array(await sharp({ create: { width: 9000, height: 8000, channels: 3, background: "#fff" } }).png().toBuffer());
    expect(huge.length).toBeLessThan(20 * 1024 * 1024);
    expect(9000 * 8000).toBeGreaterThan(MAX_INPUT_PIXELS);
    expect(await fitImageForModel(huge, "image/png")).toBeNull();
  });

  it("не картинка или битые байты — null", async () => {
    expect(await fitImageForModel(utf8("не картинка"), "image/png")).toBeNull();
    expect(await fitImageForModel(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), "image/jpeg")).toBeNull();
  });
});
