import { accessRefusedResponse, allowedUser } from "@ykurilov/agent-chat-core/access";
import type { ResolvedUser } from "@ykurilov/agent-chat-core/access";
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

export type AccessDecision = { user: { id: string }; mainKey: string } | { refusal: Response };

/** Отказ без кэша: ответы голоса несут ключи и решения о доступе, их нельзя запоминать. */
export function refusal(status: number, kind: "invalid" | "service_unavailable" | "rate_limited" | "forbidden_origin", headers: Record<string, string> = {}): Response {
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
      if (refused) return { refusal: refused };
      user = allowedUser(resolved);
    } catch (error) {
      options.logError(`Голос: не удалось определить пользователя: ${error instanceof Error ? error.message : String(error)}`);
      return { refusal: refusal(503, "service_unavailable") };
    }
    if (!user) return { refusal: refusal(401, "invalid") };

    const mainKey = resolveMainKey(options);
    if (!mainKey) {
      options.logError("Голос: на сервере нет ключа Soniox (SONIOX_API_KEY), диктовка недоступна");
      return { refusal: refusal(503, "service_unavailable") };
    }

    const retryAfter = limiter?.take(user.id) ?? null;
    if (retryAfter !== null) return { refusal: refusal(429, "rate_limited", { "Retry-After": String(retryAfter) }) };
    return { user, mainKey };
  };
}

/** Главный ключ Soniox: из настройки или из окружения сервера. */
export function resolveMainKey({ apiKey, env }: Pick<AccessOptions, "apiKey" | "env">): string | undefined {
  return apiKey ?? (env ?? processEnv()).SONIOX_API_KEY;
}

function processEnv(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}
