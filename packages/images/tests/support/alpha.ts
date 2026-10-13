import sharp from "sharp";

/** Доли прозрачных (альфа 0) и плотных (альфа от 250: у слоёв KIE предмет — 254) пикселей картинки. */
export async function alphaShares(bytes: Uint8Array): Promise<{ transparent: number; opaque: number }> {
  const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let opaque = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] === 0) transparent++;
    else if (data[index]! >= 250) opaque++;
  }
  const pixels = data.length / 4;
  return { transparent: transparent / pixels, opaque: opaque / pixels };
}
