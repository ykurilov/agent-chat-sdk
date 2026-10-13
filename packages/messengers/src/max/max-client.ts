import { createMessengerApi, type MessengerApi, type MessengerApiSettings, MessengerBlockedError, MessengerMarkupError, MessengerRateLimitError } from "../messenger-api";
import { downloadedFile, type UploadFile, uploadForm } from "../messenger-files";

/** Пауза, если 429 пришёл без `Retry-After`. */
const DEFAULT_RETRY_AFTER_MS = 1000;

interface MaxErrorBody {
  code?: string;
  message?: string;
}

/** Вызовы API MAX: JSON, токен в заголовке `Authorization`; загрузка и скачивание — по готовым адресам. */
export function createMaxClient(input: { token: string; api?: MessengerApiSettings }) {
  const api: MessengerApi = createMessengerApi({ messenger: "max", token: input.token, defaultBaseUrl: "https://platform-api.max.ru", api: input.api });
  // Адреса загрузки и файлов ведут на другие серверы MAX: заголовки прокси и токен им не нужны, своя функция `fetch` нужна.
  const direct: MessengerApi = createMessengerApi({ messenger: "max", token: input.token, defaultBaseUrl: "", api: input.api && "fetch" in input.api ? input.api : undefined });

  function failure(response: Response, text: string) {
    let body: MaxErrorBody = {};
    try {
      body = JSON.parse(text) as MaxErrorBody;
    } catch {
      body = { message: text.slice(0, 300) };
    }
    const description = [body.code, body.message].filter(Boolean).join(": ") || `ответ ${response.status}`;
    const error = api.error(response.status, description);
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      return new MessengerRateLimitError(error.message, seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS);
    }
    if (response.status === 403 && /chat\.denied/i.test(description)) return new MessengerBlockedError(error.message);
    if (response.status === 400 && /html|format|markup/i.test(body.message ?? "")) return new MessengerMarkupError(error.message);
    return error;
  }

  return {
    api,
    /** Метод API: `query` — в адрес, `body` — JSON. */
    async call<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: { query?: Record<string, string | number | undefined>; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(options.query ?? {})) if (value !== undefined) query.set(name, String(value));
      const response = await api.fetch(`${path}${query.size > 0 ? `?${query}` : ""}`, {
        method,
        headers: { authorization: input.token, ...(options.body !== undefined && { "content-type": "application/json" }) },
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        ...(options.signal && { signal: options.signal }),
      });
      const text = await response.text();
      if (!response.ok) throw failure(response, text);
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw api.error(response.status, `ответ не JSON: ${text.slice(0, 200)}`);
      }
    },
    /** Файл — полем формы `data` на адрес загрузки. */
    async uploadFile<T>(url: string, file: UploadFile): Promise<T> {
      const response = await direct.fetch(url, { method: "POST", body: uploadForm({ data: file }) });
      const text = await response.text();
      if (!response.ok) throw failure(response, text);
      try {
        return JSON.parse(text) as T;
      } catch {
        return {} as T;
      }
    },
    async download(url: string): Promise<{ bytes: Uint8Array; mediaType?: string }> {
      const response = await direct.fetch(url);
      if (!response.ok) throw api.error(response.status, `не удалось скачать файл (${response.status})`);
      return downloadedFile(response);
    },
  };
}

export type MaxClient = ReturnType<typeof createMaxClient>;
