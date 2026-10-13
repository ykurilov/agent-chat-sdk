import { scrubSecrets } from "@ykurilov/agent-chat-core";

/** Короче этого значение заголовка не спрятать в журналах: оно совпало бы с обычными словами. */
const MIN_SECRET_LENGTH = 8;

/** Как ходить к API мессенджера: свой адрес и заголовки (обратный прокси) или своя функция `fetch`. */
export type MessengerApiSettings = { baseUrl?: string; headers?: Record<string, string> } | { fetch: typeof fetch };

export interface MessengerApi {
  /** Адрес API без косой черты в конце. */
  readonly baseUrl: string;
  /** Запрос к `baseUrl + path` с заголовками прокси. Сбой сети — `MessengerApiError` без секретов. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Текст без токена и значений заголовков. */
  hideSecrets(text: string): string;
  /** Ошибка ответа API: код и текст без секретов. */
  error(status: number, description: string): MessengerApiError;
}

/** Ошибка API мессенджера; текст уже без секретов. `status` 0 — до ответа не дошло. */
export class MessengerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MessengerApiError";
  }
}

/** «Слишком часто»: мессенджер просит подождать `retryAfterMs`. */
export class MessengerRateLimitError extends MessengerApiError {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message, 429);
    this.name = "MessengerRateLimitError";
  }
}

/** Человек заблокировал бота или запретил писать: повтор не поможет. */
export class MessengerBlockedError extends MessengerApiError {
  constructor(message: string) {
    super(message, 403);
    this.name = "MessengerBlockedError";
  }
}

/** Мессенджер не разобрал разметку: тот же текст уйдёт простым. */
export class MessengerMarkupError extends MessengerApiError {
  constructor(message: string) {
    super(message, 400);
    this.name = "MessengerMarkupError";
  }
}

/** Доступ к API одного бота. Заголовок с коротким значением — ошибка сразу: такой секрет журналы не спрячут. */
export function createMessengerApi(input: { messenger: string; token: string; defaultBaseUrl: string; api?: MessengerApiSettings }): MessengerApi {
  const settings = input.api ?? {};
  const ownFetch = "fetch" in settings ? settings.fetch : undefined;
  const headers = "fetch" in settings ? {} : (settings.headers ?? {});
  for (const [name, value] of Object.entries(headers)) {
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(`${input.messenger}: значение заголовка «${name}» короче ${MIN_SECRET_LENGTH} знаков — такой токен не спрятать в журналах; нужен длиннее`);
    }
  }
  const baseUrl = (("fetch" in settings ? undefined : settings.baseUrl) ?? input.defaultBaseUrl).replace(/\/+$/, "");
  const secrets = [input.token, ...Object.values(headers)].filter((value) => value.length >= MIN_SECRET_LENGTH);
  const hideSecrets = (text: string) => scrubSecrets(text, secrets);

  return {
    baseUrl,
    hideSecrets,
    error: (status, description) => new MessengerApiError(`${input.messenger}: ${hideSecrets(description)}`, status),
    async fetch(path, init = {}) {
      const merged = new Headers(init.headers);
      for (const [name, value] of Object.entries(headers)) merged.set(name, value);
      try {
        return await (ownFetch ?? globalThis.fetch)(`${baseUrl}${path}`, { ...init, headers: merged });
      } catch (error) {
        if (init.signal?.aborted) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new MessengerApiError(`${input.messenger}: сбой запроса к API: ${hideSecrets(reason)}`, 0);
      }
    },
  };
}

/** Мессенджер не принял кнопки (ошибка запроса): шлём то же без кнопок. */
export function buttonsRejected(error: unknown): boolean {
  return (
    error instanceof MessengerApiError &&
    !(error instanceof MessengerBlockedError) &&
    !(error instanceof MessengerRateLimitError) &&
    !(error instanceof MessengerMarkupError) &&
    error.status >= 400 &&
    error.status < 500
  );
}
