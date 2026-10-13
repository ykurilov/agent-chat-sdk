import { createMessengerApi, type MessengerApi, type MessengerApiSettings, MessengerBlockedError, MessengerMarkupError, MessengerRateLimitError } from "../messenger-api";
import { downloadedFile, type UploadFile, uploadForm } from "../messenger-files";

/** Пауза, если 429 пришёл без `retry_after`. */
const DEFAULT_RETRY_AFTER_MS = 1000;

interface TelegramReply {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/** Вызовы Bot API: JSON, загрузка файлов формой, скачивание. Ошибки приводятся к ошибкам общего слоя. */
export function createTelegramClient(input: { token: string; api?: MessengerApiSettings }) {
  const api: MessengerApi = createMessengerApi({ messenger: "telegram", token: input.token, defaultBaseUrl: "https://api.telegram.org", api: input.api });

  async function unwrap<T>(response: Response): Promise<T> {
    const text = await response.text();
    let reply: TelegramReply | undefined;
    try {
      reply = JSON.parse(text) as TelegramReply;
    } catch {
      reply = undefined;
    }
    if (reply?.ok) return reply.result as T;
    throw failure(response.status, reply?.description ?? text.slice(0, 300), reply?.parameters?.retry_after);
  }

  function failure(status: number, description: string, retryAfter?: number) {
    const error = api.error(status, description);
    if (status === 429) return new MessengerRateLimitError(error.message, retryAfter ? retryAfter * 1000 : DEFAULT_RETRY_AFTER_MS);
    if (status === 403) return new MessengerBlockedError(error.message);
    if (status === 400 && /can't parse entities|can't find end of the entity/i.test(description)) return new MessengerMarkupError(error.message);
    return error;
  }

  return {
    api,
    /** Метод Bot API с телом JSON. */
    async call<T = unknown>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
      const response = await api.fetch(`/bot${input.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(signal && { signal }),
      });
      return unwrap<T>(response);
    },
    /** Метод с файлом: поля формы, файл — одним из них. */
    async upload<T = unknown>(method: string, fields: Record<string, string | UploadFile | undefined>): Promise<T> {
      return unwrap<T>(await api.fetch(`/bot${input.token}/${method}`, { method: "POST", body: uploadForm(fields) }));
    },
    /** Содержимое файла по `file_path` из `getFile`. */
    async download(path: string): Promise<{ bytes: Uint8Array; mediaType?: string }> {
      const response = await api.fetch(`/file/bot${input.token}/${path}`);
      if (!response.ok) throw failure(response.status, `не удалось скачать файл (${response.status})`);
      return downloadedFile(response);
    },
  };
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;
