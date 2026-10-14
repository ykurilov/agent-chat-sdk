import { accessRefusedResponse, allowedUser } from "@ykurilov/agent-chat-core/access";
import type { ResolvedUser } from "@ykurilov/agent-chat-core/access";
import { RELAY_CLOSE } from "../relay-close";
import { createRequestOriginCheck, originRefusalHint } from "./request-origin";

export interface RateLimit {
  /** Сколько сессий диктовки один пользователь может начать за окно. */
  maxSessions: number;
  /** Длина окна, секунд. */
  perSeconds: number;
}

/** Чистка текста моделью стоит денег, а лимиты расходов её не видят: шесть в минуту на человека хватает живой речи. */
export const DEFAULT_POLISH_RATE_LIMIT: RateLimit = { maxSessions: 6, perSeconds: 60 };

/** Десять диктовок в минуту на человека: хватает живой работе и не даёт вычерпать чужой счёт Soniox. */
export const DEFAULT_RATE_LIMIT: RateLimit = { maxSessions: 10, perSeconds: 60 };

export interface AccessOptions {
  /** Чужие страницы, которым можно пользоваться голосом с куками человека. Своя страница проходит всегда. */
  allowedOrigins?: readonly string[] | undefined;
  /** Тот же вход, что у чата: нет пользователя — доступа нет; `{ refused }` — отказ словами приложения. */
  resolveUser: (request: Request) => Promise<ResolvedUser>;
  /** Главный ключ Soniox. Не задан — `env.SONIOX_API_KEY`. */
  apiKey?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  /** Ограничение частоты на пользователя; `false` — без ограничения. */
  rateLimit?: RateLimit | false | undefined;
  now?: (() => number) | undefined;
  logError: (message: string) => void;
}

/**
 * Отказ: HTTP-ответ и код закрытия, которым ретранслятор скажет браузеру причину (браузер не видит HTTP-ответ на подъём
 * WebSocket). Нет кода — соединение не поднимается вовсе (чужая страница).
 */
export type AccessRefusalDecision = { refusal: Response; closeCode?: number };

export type AccessDecision = { user: { id: string }; mainKey: string } | AccessRefusalDecision;

/** Код отказа приложения (`resolveUser` → `{ refused: { code } }`) → код закрытия; прочие коды — «нет доступа». */
const CLOSE_BY_APP_CODE: Record<string, number> = {
  limit: RELAY_CLOSE.limit,
  spending_limit_reached: RELAY_CLOSE.limit,
  too_long: RELAY_CLOSE.tooLong,
  rate_limited: RELAY_CLOSE.rateLimited,
  service_unavailable: RELAY_CLOSE.upstream,
};

function appRefusalCloseCode(code: string): number {
  return Object.hasOwn(CLOSE_BY_APP_CODE, code) ? CLOSE_BY_APP_CODE[code]! : RELAY_CLOSE.forbidden;
}

/** Отказ без кэша: ответы голоса несут ключи и решения о доступе, их нельзя запоминать. */
export function refusal(status: number, kind: "invalid" | "service_unavailable" | "rate_limited" | "forbidden_origin" | "spending_limit_reached", headers: Record<string, string> = {}): Response {
  return Response.json({ error: { kind } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Скользящее окно по пользователям; память процесса, как и остальное состояние модуля. */
export function createRateLimiter(limit: RateLimit, now: () => number) {
  const starts = new Map<string, number[]>();
  const windowMs = limit.perSeconds * 1000;

  return {
    /** `null` — можно, и начало засчитано; иначе через сколько секунд освободится место. */
    take(userId: string): number | null {
      const current = now();
      const recent = (starts.get(userId) ?? []).filter((moment) => current - moment < windowMs);
      if (recent.length >= limit.maxSessions) {
        starts.set(userId, recent);
        return Math.max(1, Math.ceil((recent[0]! + windowMs - current) / 1000));
      }
      starts.set(userId, [...recent, current]);
      // Забытые пользователи не копятся: раз в проход выкидываем тех, у кого всё окно давно прошло.
      for (const [id, moments] of starts) if (moments.every((moment) => current - moment >= windowMs)) starts.delete(id);
      return null;
    },
  };
}

/**
 * Допуск к голосу: запрос со своей страницы, пользователь есть, ключ Soniox на сервере есть, частота не превышена.
 * Порядок важен: чужая страница, неавторизованный и неисправный сервер в лимит не засчитываются.
 */
export function createAccessGuard(options: AccessOptions): (request: Request) => Promise<AccessDecision> {
  const limit = options.rateLimit === undefined ? DEFAULT_RATE_LIMIT : options.rateLimit;
  const limiter = limit ? createRateLimiter(limit, options.now ?? Date.now) : null;
  const allowsOrigin = createRequestOriginCheck({
    allowedOrigins: options.allowedOrigins,
    onRefused: (refusal) => options.logError(`Голос: ${originRefusalHint(refusal)}`),
  });

  return async (request) => {
    // Проверяется любой запрос, и подъём WebSocket (GET) тоже: браузер прикладывает к нему куки человека.
    if (!allowsOrigin(request)) return { refusal: refusal(403, "forbidden_origin") };
    let user: { id: string } | null;
    try {
      const resolved = await options.resolveUser(request);
      // Слова приложения отдаём как есть; неверный код отказа — ошибка приложения (503 и строка в журнал).
      const refused = accessRefusedResponse(resolved, { "Cache-Control": "no-store" });
      if (refused) return { refusal: refused, closeCode: await refusedCloseCode(refused) };
      user = allowedUser(resolved);
    } catch (error) {
      options.logError(`Голос: не удалось определить пользователя: ${error instanceof Error ? error.message : String(error)}`);
      return { refusal: refusal(503, "service_unavailable"), closeCode: RELAY_CLOSE.upstream };
    }
    if (!user) return { refusal: refusal(401, "invalid"), closeCode: RELAY_CLOSE.unauthorized };

    const mainKey = resolveMainKey(options);
    if (!mainKey) {
      options.logError("Голос: на сервере нет ключа Soniox (SONIOX_API_KEY), диктовка недоступна");
      return { refusal: refusal(503, "service_unavailable"), closeCode: RELAY_CLOSE.upstream };
    }

    const retryAfter = limiter?.take(user.id) ?? null;
    if (retryAfter !== null) return { refusal: refusal(429, "rate_limited", { "Retry-After": String(retryAfter) }), closeCode: RELAY_CLOSE.rateLimited };
    return { user, mainKey };
  };
}

/** Код отказа приложения берётся из уже готового ответа: так он прошёл ту же проверку, что и ответ по HTTP. */
async function refusedCloseCode(refused: Response): Promise<number> {
  const body = (await refused.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null;
  return typeof body?.error?.code === "string" ? appRefusalCloseCode(body.error.code) : RELAY_CLOSE.forbidden;
}

/** Главный ключ Soniox: из настройки или из окружения сервера. */
export function resolveMainKey({ apiKey, env }: Pick<AccessOptions, "apiKey" | "env">): string | undefined {
  return apiKey ?? (env ?? processEnv()).SONIOX_API_KEY;
}

function processEnv(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}
