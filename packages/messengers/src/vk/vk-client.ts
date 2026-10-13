import { createMessengerApi, type MessengerApi, type MessengerApiSettings, MessengerBlockedError, MessengerRateLimitError } from "../messenger-api";
import { downloadedFile, type UploadFile, uploadForm } from "../messenger-files";

/** Версия API VK, под которую написан адаптер. */
export const VK_API_VERSION = "5.199";

const BLOCKED_CODES = new Set([901, 902, 993]);
/** 6 — больше трёх запросов в секунду; 9 — одинаковые запросы слишком часто. */
const RATE_LIMIT_PAUSE_MS: Record<number, number> = { 6: 1000, 9: 5000 };

interface VkReply {
  response?: unknown;
  error?: { error_code: number; error_msg: string };
}

/** Вызовы методов VK и обращения по готовым адресам (Long Poll, загрузка, скачивание). */
export function createVkClient(input: { token: string; api?: MessengerApiSettings }) {
  const api: MessengerApi = createMessengerApi({ messenger: "vk", token: input.token, defaultBaseUrl: "https://api.vk.com", api: input.api });
  // Готовые адреса ведут на другие серверы VK: заголовки прокси им не нужны, а своя функция `fetch` нужна.
  const direct: MessengerApi = createMessengerApi({ messenger: "vk", token: input.token, defaultBaseUrl: "", api: input.api && "fetch" in input.api ? input.api : undefined });

  function failure(code: number, message: string) {
    const error = api.error(200, `ошибка ${code}: ${message}`);
    const pause = RATE_LIMIT_PAUSE_MS[code];
    if (pause !== undefined) return new MessengerRateLimitError(error.message, pause);
    if (BLOCKED_CODES.has(code)) return new MessengerBlockedError(error.message);
    return error;
  }

  async function readJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) throw api.error(response.status, text.slice(0, 300));
    try {
      return JSON.parse(text) as T;
    } catch {
      throw api.error(response.status, `ответ не JSON: ${text.slice(0, 200)}`);
    }
  }

  return {
    api,
    /** Метод API: параметры формой, токен в заголовке. */
    async call<T = unknown>(method: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
      const body = new URLSearchParams({ v: VK_API_VERSION });
      for (const [name, value] of Object.entries(params)) if (value !== undefined) body.set(name, String(value));
      const response = await api.fetch(`/method/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${input.token}`, "content-type": "application/x-www-form-urlencoded" },
        body,
        ...(signal && { signal }),
      });
      const reply = await readJson<VkReply>(response);
      if (reply.error) throw failure(reply.error.error_code, reply.error.error_msg);
      return reply.response as T;
    },
    /** GET по готовому адресу, ответ — JSON. */
    async getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
      return readJson<T>(await direct.fetch(url, signal ? { signal } : {}));
    },
    /** Загрузка файла на адрес от VK: файл — полем формы `field`. */
    async uploadFile<T>(url: string, field: string, file: UploadFile): Promise<T> {
      return readJson<T>(await direct.fetch(url, { method: "POST", body: uploadForm({ [field]: file }) }));
    },
    async download(url: string): Promise<{ bytes: Uint8Array; mediaType?: string }> {
      const response = await direct.fetch(url);
      if (!response.ok) throw api.error(response.status, `не удалось скачать файл (${response.status})`);
      return downloadedFile(response);
    },
  };
}

export type VkClient = ReturnType<typeof createVkClient>;
