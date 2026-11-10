import type { SonioxContext } from "../soniox-messages";
import { createAccessGuard, refusal } from "./access";
import type { AccessOptions, RateLimit } from "./access";
import { acceptedLanguageHints } from "./language-hints";
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
  /** Подсказка языка по умолчанию (`["ru"]`). Браузер может прислать свою на каждую запись: тело `{ languageHints }`. */
  languageHints?: string[];
  /** Какие языки браузер может назвать сам, например `["ru", "en"]`. Не задано — любой код языка из двух-трёх букв. */
  allowedLanguageHints?: string[];
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
      // Тело читается до временного ключа и с потолком: огромный запрос не тратит ключ Soniox и память сервера.
      const body = await sessionBody(request);
      if (body === TOO_LARGE) return refusal(413, "invalid");

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
            languageHints: requestedLanguageHints(body, options.allowedLanguageHints) ?? options.languageHints ?? ["ru"],
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


const MAX_SESSION_BODY_BYTES = 16 * 1024;
const TOO_LARGE = Symbol("too-large");

/** Тело `/session` текстом; больше 16 КиБ — `TOO_LARGE`, остаток потока не читается. */
async function sessionBody(request: Request): Promise<string | typeof TOO_LARGE> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SESSION_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return TOO_LARGE;
      }
      chunks.push(value);
    }
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Язык записи из тела запроса `{ languageHints }`, если браузер его прислал и он годный. Тело не JSON — подсказки нет. */
function requestedLanguageHints(text: string, allowed: readonly string[] | undefined): string[] | null {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null ? acceptedLanguageHints((body as Record<string, unknown>).languageHints, allowed) : null;
  } catch {
    return null;
  }
}
