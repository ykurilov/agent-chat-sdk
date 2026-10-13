import { assertPublicWebAddress, assertResolvesPublic } from "./page-address";
import type { HostResolver } from "./page-address";

export const screenshotDownloadTimeoutMs = 20_000;
export const screenshotMaxBytes = 5 * 1024 * 1024;

export interface DownloadedImage {
  bytes: Uint8Array;
  mediaType: string;
}

export const screenshotMaxRedirects = 3;

export interface ScreenshotDownloadOptions {
  /** Разрешает имя в адреса для проверки: наш сервер сам ходит по этому адресу. */
  resolveHost: HostResolver;
}

/**
 * Скачивает снимок по адресу из записи истории. Возвращает `undefined`, если снимка больше нет:
 * ссылка устарела, это не картинка, она слишком велика или ведёт не туда. Переходы выполняются вручную,
 * не больше трёх, и каждый проходит ту же проверку, что и первый адрес: только http(s), не локальный адрес,
 * имя не указывает во внутреннюю сеть.
 */
export async function downloadScreenshot(
  address: string,
  fetchImplementation: typeof globalThis.fetch,
  { resolveHost }: ScreenshotDownloadOptions,
): Promise<DownloadedImage | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), screenshotDownloadTimeoutMs);
  try {
    let current = address;
    for (let redirects = 0; ; redirects++) {
      // Встроенная картинка (data:) сети не касается; для первого адреса она допустима, для перехода нет.
      if (redirects === 0 && new URL(current).protocol === "data:") return await readImage(await fetchImplementation(current, { signal: controller.signal }));
      await assertResolvesPublic(assertPublicWebAddress(current), resolveHost);
      const response = await fetchImplementation(current, { signal: controller.signal, redirect: "manual" });
      if (response.status < 300 || response.status >= 400) return await readImage(response);
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects >= screenshotMaxRedirects) return undefined;
      current = new URL(location, current).href;
    }
  } catch {
    // Любой сбой означает одно: снимка больше нет; модели уйдёт текст.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function readImage(response: Response): Promise<DownloadedImage | undefined> {
  if (!response.ok) return undefined;
  const mediaType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mediaType.startsWith("image/")) return undefined;
  if (Number(response.headers.get("content-length") ?? 0) > screenshotMaxBytes) return undefined;
  const bytes = await readLimited(response, screenshotMaxBytes);
  return bytes && { bytes, mediaType };
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
