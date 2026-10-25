import type { ImageFailureKind } from "./image-failure";
import { detectFileKind } from "@ykurilov/agent-chat-attachments";
import { dnsHostResolver, sharedPinnedFetch, WebToolError } from "@ykurilov/agent-chat-web-tools/network";
import type { HostResolver } from "@ykurilov/agent-chat-web-tools/network";
import { isAllowedImageAddress } from "./download-address";
import { ImageGenerationError } from "./image-generation-error";
import { pngSize } from "./postprocess-image";
import type { ProcessedImage } from "./postprocess-image";

/** Скачивание одной картинки — не дольше этого: задача у провайдера уже готова, файл лежит на его складе. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Переадресаций склада не больше этого: каждая проверяется, как первый адрес. */
const MAX_REDIRECTS = 3;

/** Типы картинок, которые принимаются, и их расширения. */
export const imageExtensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export interface DownloadGeneratedImageInput {
  /** Адрес готовой картинки у провайдера. */
  url: string;
  /**
   * Свой `fetch` приложения (прокси) — граница доверия приложения: по нему идут все адреса, а закрепить соединение за
   * проверенным адресом (от подмены DNS) должен он сам. Нет — склад провайдера качает общий закреплённый `fetch`:
   * имя проверяется в момент соединения, во внутреннюю сеть не пускает. Сайт `trustedOrigin` — обычным `fetch`.
   */
  fetch?: typeof globalThis.fetch;
  /** Как закреплённый `fetch` разрешает имена. По умолчанию системный DNS; заменяется в тестах. */
  resolveHost?: HostResolver;
  maxImageBytes: number;
  /** Сайт подключения провайдера из настройки (`https://host:port`): с него можно скачивать и по http, и с localhost. */
  trustedOrigin?: string;
  /** «Стоп»: пришедшее после него не отдаётся. */
  abortSignal?: AbortSignal;
  /** Обработка после скачивания (формат, размер); её итог и отдаётся. */
  transform?: (bytes: Uint8Array, mediaType: string) => Promise<ProcessedImage>;
}

/** Скачанная картинка; размер — из файла (PNG или после обработки), иначе не известен. */
export interface DownloadedImage {
  bytes: Uint8Array;
  mediaType: string;
  width?: number;
  height?: number;
}

const failure = (reason: string, kind: ImageFailureKind = "unknown") => new ImageGenerationError(reason, { refusedBeforeWork: false, kind });
const megabytes = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} МБ`;

/** Тело ответа, но не больше `maxBytes`: на пределе чтение обрывается, файл не копится в памяти дальше. */
async function readWithin(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function checkedAddress(url: string, base: URL | undefined, trustedOrigin: string | undefined): URL {
  let address: URL;
  try {
    address = new URL(url, base);
  } catch {
    throw failure("Картинка не скачалась: неверный адрес", "configuration");
  }
  if (!isAllowedImageAddress(address, trustedOrigin)) throw failure("Картинка не скачалась: неверный адрес", "configuration");
  return address;
}

/**
 * Чем качать адрес. Сайт подключения из настройки — доверенный, пока адрес на нём: свой прокси или поддельный провайдер
 * на localhost. Переадресация на другой сайт этого доверия не наследует и снова идёт закреплённым `fetch`.
 */
function fetchFor(input: DownloadGeneratedImageInput, address: URL): typeof globalThis.fetch {
  if (input.fetch) return input.fetch;
  if (input.trustedOrigin !== undefined && address.origin === input.trustedOrigin) return globalThis.fetch;
  return sharedPinnedFetch(input.resolveHost ?? dnsHostResolver);
}

/** Ответ склада по адресу; переадресации идут вручную, каждый следующий адрес проверяется (download-address). */
async function fetchImage(input: DownloadGeneratedImageInput, first: URL, signal: AbortSignal): Promise<Response> {
  let address = first;
  for (let hop = 0; ; hop++) {
    const response = await fetchFor(input, address)(address.href, { signal, redirect: "manual" });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location === null) return response;
    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw failure("Картинка не скачалась: слишком много переадресаций");
    address = checkedAddress(location, address, input.trustedOrigin);
  }
}

/**
 * Скачивает готовую картинку по адресу провайдера (без заголовков подключения: это чужой склад) и обрабатывает её.
 * Тип — только по содержимому: PNG, JPEG или WebP. Сбой — `ImageGenerationError`; «Стоп» пробрасывается как есть.
 */
export async function downloadGeneratedImage(input: DownloadGeneratedImageInput): Promise<DownloadedImage> {
  const address = checkedAddress(input.url, undefined, input.trustedOrigin);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("timeout", "TimeoutError")), DOWNLOAD_TIMEOUT_MS);
  // Срок скачивания не держит процесс: его держит сам запрос.
  (timer as { unref?: () => void }).unref?.();
  const signal = input.abortSignal ? AbortSignal.any([input.abortSignal, timeout.signal]) : timeout.signal;
  let bytes: Uint8Array | null;
  try {
    const response = await fetchImage(input, address, signal);
    if (!response.ok) throw failure(`Картинка не скачалась: ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500 ? "transient" : "configuration");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > input.maxImageBytes) throw failure(`Картинка больше ${megabytes(input.maxImageBytes)}`);
    bytes = await readWithin(response, input.maxImageBytes);
  } catch (error) {
    if (input.abortSignal?.aborted) throw input.abortSignal.reason ?? error;
    if (error instanceof ImageGenerationError) throw error;
    // Имя склада указало во внутреннюю сеть или не разрешилось — проверка при соединении.
    if (error instanceof WebToolError && error.kind === "bad_address") throw failure("Картинка не скачалась: неверный адрес", "configuration");
    throw failure(timeout.signal.aborted ? "Картинка не скачалась: не успела" : "Картинка не скачалась", "transient");
  } finally {
    clearTimeout(timer);
  }
  if (input.abortSignal?.aborted) throw input.abortSignal.reason;
  if (!bytes) throw failure(`Картинка больше ${megabytes(input.maxImageBytes)}`);

  const detected = detectFileKind(bytes, "");
  if (!detected || !imageExtensions[detected.mediaType]) throw failure("Провайдер вернул не картинку");
  let file: DownloadedImage = { bytes, mediaType: detected.mediaType, ...pngSize(bytes) };
  if (input.transform) {
    try {
      file = await input.transform(bytes, detected.mediaType);
    } catch {
      throw failure("Картинка не обработалась");
    }
  }
  if (input.abortSignal?.aborted) throw input.abortSignal.reason;
  return file;
}
