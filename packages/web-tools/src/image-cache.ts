import type { DownloadedImage } from "./screenshot-download";

export interface ImageCacheOptions {
  maxEntries: number;
  maxBytes: number;
  ttlMs: number;
  now?: () => number;
}

export interface ImageCache {
  get(key: string): DownloadedImage | undefined;
  set(key: string, image: DownloadedImage): void;
}

interface Entry {
  image: DownloadedImage;
  expiresAt: number;
}

/** Кэш картинок в памяти: ограничен числом, общим объёмом и временем жизни; первой уходит давно не нужная запись. */
export function createImageCache({ maxEntries, maxBytes, ttlMs, now = Date.now }: ImageCacheOptions): ImageCache {
  // Map хранит порядок вставки: первая запись — самая давняя.
  const entries = new Map<string, Entry>();
  let totalBytes = 0;

  function remove(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    totalBytes -= entry.image.bytes.byteLength;
    entries.delete(key);
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        remove(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.image;
    },
    set(key, image) {
      remove(key);
      if (image.bytes.byteLength > maxBytes) return;
      entries.set(key, { image, expiresAt: now() + ttlMs });
      totalBytes += image.bytes.byteLength;
      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries && totalBytes <= maxBytes) break;
        remove(oldest);
      }
    },
  };
}
