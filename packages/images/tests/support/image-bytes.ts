/** Начала настоящих форматов: по ним определяется тип картинки. Хвост — мусор, разбирать картинку целиком никто не будет. */
const withTail = (head: number[]) => new Uint8Array([...head, ...Array.from({ length: 32 }, (_, index) => index)]);

export const pngBytes = () => withTail([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const jpegBytes = () => withTail([0xff, 0xd8, 0xff, 0xe0]);
export const webpBytes = () => withTail([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0x24, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0))));
export const gifBytes = () => withTail([..."GIF89a"].map((c) => c.charCodeAt(0)));
