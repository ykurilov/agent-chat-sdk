import { APICallError } from "ai";
import { errorStatusCode, underlyingError } from "./error-fields";

/** Системные коды Node/Undici и Bun: соединение не установилось или оборвалось. */
const NETWORK_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT",
  "ECONNRESET", "EPIPE", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ConnectionRefused", "FailedToOpenSocket", "ConnectionClosed",
]);

/**
 * Ошибка транспорта без HTTP-ответа. `fetch failed` хранит код в cause; несколько адресов — в AggregateError.errors.
 * HTTP-ответ главнее вложенной причины; неизвестные ошибки приложения сетевыми не считаются. Циклы причин безопасны.
 */
export function isNetworkFailure(error: unknown): boolean {
  const pending = [underlyingError(error)];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);
    if (errorStatusCode(current) !== undefined) continue;
    const fields = current as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (typeof fields.code === "string" && NETWORK_CODES.has(fields.code)) return true;
    // AI SDK помечает транспортный отказ повторяемым, в том числе когда системная причина потерялась в шлюзе.
    if (APICallError.isInstance(current) && current.isRetryable) return true;
    if (typeof fields.message === "string" && /^Cannot connect to API\b/i.test(fields.message)) return true;
    pending.push(fields.cause);
    if (Array.isArray(fields.errors)) pending.push(...fields.errors);
  }
  return false;
}
