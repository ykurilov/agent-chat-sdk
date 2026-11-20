/** Ответ сервера на загрузку: удалась ли она и что сервер прислал (JSON или ничего). */
export interface UploadReply {
  ok: boolean;
  payload: unknown;
}

export interface UploadFileInput {
  url: string;
  file: File;
  signal: AbortSignal;
  /**
   * Транспорт приложения: файл уходит через него, прогресса нет. Нет — через XMLHttpRequest с прогрессом. Свой `fetch`
   * приложения или подменённый глобальный `fetch` передаёт сюда контроллер поля.
   */
  transport?: typeof globalThis.fetch;
  /** Доля отправленного, от 0 до 1. Зовётся, только если прогресс известен. */
  onProgress: (fraction: number) => void;
}

/**
 * Отправляет файл на сервер полем `file` формы. У `fetch` нет прогресса отправки, поэтому без транспорта приложения
 * файл уходит через XMLHttpRequest. Отмена — через `signal`; обрыв и отмена — исключение, как у `fetch`.
 */
export async function uploadFile({ url, file, signal, transport, onProgress }: UploadFileInput): Promise<UploadReply> {
  const body = new FormData();
  body.append("file", file);
  if (transport || typeof XMLHttpRequest === "undefined") {
    const response = await (transport ?? globalThis.fetch)(url, { method: "POST", body, signal });
    return { ok: response.ok, payload: await response.json().catch(() => undefined) };
  }
  return sendWithProgress(url, body, signal, onProgress);
}

/**
 * `fetch` — родной `fetch` браузера, никем не подменённый. Подменённый приложением (токен, перехватчик, мок в тестах) —
 * обычная функция с видимым исходным кодом или связанная копия («bound fetch»): загрузка должна идти через него, как раньше.
 */
export function isBrowserOwnFetch(fetch: typeof globalThis.fetch | undefined): boolean {
  if (typeof fetch !== "function" || fetch.name !== "fetch") return false;
  try {
    return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fetch));
  } catch {
    return false;
  }
}

function sendWithProgress(url: string, body: FormData, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<UploadReply> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const settle = (finish: () => void) => {
      signal.removeEventListener("abort", abort);
      finish();
    };
    signal.addEventListener("abort", abort, { once: true });
    request.open("POST", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => settle(() => resolve({ ok: request.status >= 200 && request.status < 300, payload: parseJson(request.responseText) }));
    request.onerror = () => settle(() => reject(new TypeError("Network request failed")));
    request.ontimeout = request.onerror;
    request.onabort = () => settle(() => reject(new DOMException("Aborted", "AbortError")));
    onProgress(0);
    request.send(body);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
