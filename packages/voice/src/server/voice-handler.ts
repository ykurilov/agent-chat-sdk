import type { SonioxContext } from "../soniox-messages";
import { createAccessGuard, refusal } from "./access";
import type { AccessOptions, RateLimit } from "./access";
import { requestTemporaryKey, TemporaryKeyError } from "./temporary-key";

export interface VoiceHandlerOptions {
  /** Путь, под которым смонтирован обработчик, например `/api/voice`. */
  basePath: string;
  /** Тот же вход, что у чата: нет пользователя — ключ не выдаётся. */
  resolveUser: AccessOptions["resolveUser"];
  /** Главный ключ Soniox. Не задан — `env.SONIOX_API_KEY`. Дальше сервера он не уходит. */
  apiKey?: string;
  /** Откуда брать ключ. По умолчанию `process.env`. */
  env?: Record<string, string | undefined>;
  /** Адрес API Soniox для получения ключа. По умолчанию `https://api.soniox.com`; с российского сервера — адрес прокси. */
  apiBaseUrl?: string;
  /** Адрес WebSocket Soniox, к которому подключится браузер. */
  websocketUrl?: string;
  /** Дополнительные заголовки к API Soniox (например, `X-Proxy-Token` прокси). */
  apiHeaders?: Record<string, string>;
  /** Модель распознавания. По умолчанию `stt-rt-v5`. */
  model?: string;
  /** Подсказка языка. По умолчанию `["ru"]`. */
  languageHints?: string[];
  /** Подсказка Soniox: тема разговора и термины. */
  context?: SonioxContext;
  /** Сколько секунд временный ключ ждёт начала диктовки. По умолчанию 60. */
  tokenLifetimeSeconds?: number;
  /** Самая долгая диктовка, секунд. По умолчанию 300. */
  maxSessionSeconds?: number;
  /**
   * Сколько сессий диктовки один пользователь может начать за окно. По умолчанию 10 в минуту; `false` — без ограничения.
   * Счётчик живёт в памяти процесса. Общие лимиты (на всё приложение, на адрес) ставятся на самом приложении.
   */
  rateLimit?: RateLimit | false;
  /**
   * Чужие страницы, которым можно пользоваться голосом с куками человека, например `["https://school.getcourse.ru"]`.
   * Своя страница проходит всегда; запрос с чужой — ответ 403 `forbidden_origin`. Запрос не из браузера проходит.
   */
  allowedOrigins?: string[];
  /** Часы для тестов. */
  now?: () => number;
  /** Журнал сервера. По умолчанию `console.error`. */
  logError?: (message: string) => void;
  /** Подмена `fetch` для тестов. */
  fetch?: typeof fetch;
}

export interface VoiceHandler {
  basePath: string;
  fetch(request: Request): Promise<Response>;
}

const DEFAULT_API_BASE_URL = "https://api.soniox.com";
const DEFAULT_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const DEFAULT_MODEL = "stt-rt-v5";
const TEMPORARY_KEY_TIMEOUT_MS = 10_000;

/** HTTP-обработчик голоса на стандартных `Request`/`Response` (contracts/voice.md): выдаёт браузеру временный ключ Soniox. */
export function createVoiceHandler(options: VoiceHandlerOptions): VoiceHandler {
  const basePath = options.basePath.replace(/\/+$/, "");
  const logError = options.logError ?? ((message: string) => console.error(message));
  const sessionPath = `${basePath}/session`;

  const guard = createAccessGuard({
    resolveUser: options.resolveUser,
    allowedOrigins: options.allowedOrigins,
    apiKey: options.apiKey,
    env: options.env,
    rateLimit: options.rateLimit,
    now: options.now,
    logError,
  });
  const notFound = () => Response.json({ error: { kind: "not_found" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const maxSessionSeconds = options.maxSessionSeconds ?? 300;

  return {
    basePath,
    async fetch(request) {
      if (new URL(request.url).pathname !== sessionPath || request.method.toUpperCase() !== "POST") return notFound();
      const access = await guard(request);
      if ("refusal" in access) return access.refusal;
      const { user, mainKey } = access;

      try {
        const key = await requestTemporaryKey({
          apiBaseUrl: options.apiBaseUrl ?? DEFAULT_API_BASE_URL,
          apiHeaders: options.apiHeaders ?? {},
          mainKey,
          lifetimeSeconds: options.tokenLifetimeSeconds ?? 60,
          maxSessionSeconds,
          userId: user.id,
          fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
          timeoutMs: TEMPORARY_KEY_TIMEOUT_MS,
        });
        return Response.json(
          {
            apiKey: key.apiKey,
            expiresAt: key.expiresAt,
            websocketUrl: options.websocketUrl ?? DEFAULT_WEBSOCKET_URL,
            model: options.model ?? DEFAULT_MODEL,
            languageHints: options.languageHints ?? ["ru"],
            maxSessionSeconds,
            ...(options.context && { context: options.context }),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        const reason = error instanceof TemporaryKeyError ? error.message : String(error);
        logError(`Голос: не выдан временный ключ Soniox: ${reason.replaceAll(mainKey, "***")}`);
        return refusal(502, "service_unavailable");
      }
    },
  };
}

