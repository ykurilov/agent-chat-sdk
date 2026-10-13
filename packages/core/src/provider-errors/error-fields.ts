import { APICallError, RetryError } from "ai";

/** Сама ошибка провайдера: у `RetryError` SDK — последняя попытка. */
export function underlyingError(error: unknown): unknown {
  return RetryError.isInstance(error) ? error.lastError : error;
}

/**
 * Код ответа: HTTP-статус `APICallError` или код из куска потока. Ищется в `statusCode`, `status`, `code`, `error.code` —
 * числом или строкой-числом. Коды вроде `ECONNRESET` кодом ответа не считаются.
 */
export function errorStatusCode(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (typeof error !== "object" || error === null) return undefined;
  const fields = error as { statusCode?: unknown; status?: unknown; code?: unknown; error?: unknown };
  const nested = typeof fields.error === "object" && fields.error !== null ? (fields.error as { code?: unknown }).code : undefined;
  for (const value of [fields.statusCode, fields.status, fields.code, nested]) {
    const code = asStatusCode(value);
    if (code !== undefined) return code;
  }
  return undefined;
}

function asStatusCode(value: unknown): number | undefined {
  const code = typeof value === "number" ? value : typeof value === "string" && /^\s*\d{3}\s*$/.test(value) ? Number(value) : undefined;
  return code !== undefined && Number.isInteger(code) && code >= 100 && code <= 599 ? code : undefined;
}

/** Текст, по которому ищутся признаки: тело ответа и сообщение, текст ошибки или сам объект ошибки из потока. */
export function errorText(error: unknown): string {
  if (APICallError.isInstance(error)) return [error.responseBody, error.message].filter(Boolean).join("\n");
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "";
  } catch {
    return "";
  }
}

/** Заголовки ответа провайдера: только для решения о повторе, в журнал они не пишутся. */
export function errorHeaders(error: unknown): Record<string, string> | undefined {
  return APICallError.isInstance(error) ? error.responseHeaders : undefined;
}

/** Имя ошибки (`AI_APICallError`, `TypeError`); у объекта из потока его обычно нет. */
export function errorName(error: unknown): string | undefined {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/** Сколько просит подождать провайдер: `retry-after-ms`, иначе `retry-after` секундами или датой. Нет или неверно — нет. */
export function requestedRetryMs(error: unknown, nowMs: number): number | undefined {
  const headers = errorHeaders(error);
  if (!headers) return undefined;
  let requestedMs: number | undefined;
  const inMs = Number.parseFloat(headers["retry-after-ms"] ?? "");
  if (!Number.isNaN(inMs)) requestedMs = inMs;
  const retryAfter = headers["retry-after"];
  if (requestedMs === undefined && retryAfter) {
    const inSeconds = Number.parseFloat(retryAfter);
    requestedMs = Number.isNaN(inSeconds) ? Date.parse(retryAfter) - nowMs : inSeconds * 1_000;
  }
  if (requestedMs === undefined || Number.isNaN(requestedMs) || requestedMs < 0) return undefined;
  return requestedMs;
}
