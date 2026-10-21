import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyProviderError } from "../../../src/provider-errors/classify-provider-error";
import { isNetworkFailure } from "../../../src/provider-errors/network-failure";

/** Ошибка системного вызова с кодом, как у Node: `connect ECONNREFUSED 127.0.0.1:9`. */
function systemError(code: string, message = ""): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Так AI SDK оборачивает сбой `fetch`: «Cannot connect to API: <текст причины>» без кода ответа. У Node при закрытом
 * порте причина — `AggregateError` с пустым текстом (адреса IPv4 и IPv6), код только в поле `code`.
 */
function cannotConnect(cause: unknown): APICallError {
  const message = cause instanceof Error ? cause.message : "";
  return new APICallError({ message: `Cannot connect to API: ${message}`, url: "http://127.0.0.1:9/v1/chat/completions", requestBodyValues: {}, cause, isRetryable: true });
}

const refusedOnBothAddresses = () =>
  Object.assign(new AggregateError([systemError("ECONNREFUSED", "connect ECONNREFUSED ::1:9"), systemError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:9")], ""), {
    code: "ECONNREFUSED",
  });

describe("сетевой сбой: провайдер недоступен — временный сбой, по коду причины, а не по тексту", () => {
  it("закрытый порт в Node: «Cannot connect to API: » с пустым текстом — overloaded (было other)", () => {
    const error = cannotConnect(refusedOnBothAddresses());
    expect(error.message).toBe("Cannot connect to API: ");
    expect(isNetworkFailure(error)).toBe(true);
    expect(classifyProviderError(error)).toBe("overloaded");
  });

  it("закрытый порт в Bun: «Unable to connect…» с кодом ConnectionRefused — overloaded", () => {
    const error = cannotConnect(systemError("ConnectionRefused", "Unable to connect. Is the computer able to access the url?"));
    expect(classifyProviderError(error)).toBe("overloaded");
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ConnectionRefused", "FailedToOpenSocket"])(
    "соединение не установлено (%s) где угодно в цепочке причин — провайдер недоступен",
    (code) => {
      const error = new Error("request to provider failed", { cause: new TypeError("fetch failed", { cause: systemError(code) }) });
      expect(isNetworkFailure(error)).toBe(true);
      expect(classifyProviderError(error)).toBe("overloaded");
    },
  );

  it.each(["ECONNRESET", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET", "ConnectionClosed"])("связь оборвалась (%s) — сетевой сбой", (code) => {
    const error = new Error("boom", { cause: systemError(code) });
    expect(isNetworkFailure(error)).toBe(true);
    expect(classifyProviderError(error)).toBe("overloaded");
  });

  it("сбой без кода ответа с пометкой SDK «можно повторить» — сетевой сбой", () => {
    const error = new APICallError({ message: "Cannot connect to API: something", url: "https://provider.test", requestBodyValues: {}, isRetryable: true });
    expect(isNetworkFailure(error)).toBe(true);
    expect(classifyProviderError(error)).toBe("overloaded");
  });

  it("последняя попытка повтора SDK (RetryError) — смотрится она", () => {
    const error = new RetryError({ message: "failed", reason: "maxRetriesExceeded", errors: [cannotConnect(refusedOnBothAddresses())] });
    expect(classifyProviderError(error)).toBe("overloaded");
  });

  it("AggregateError без своего кода — ищутся коды отдельных адресов", () => {
    const error = new TypeError("fetch failed", { cause: new AggregateError([systemError("ECONNREFUSED"), systemError("ENETUNREACH")], "") });
    expect(isNetworkFailure(error)).toBe(true);
    expect(classifyProviderError(error)).toBe("overloaded");
  });

  it("Cannot connect to API без сохранённой причины или признака isRetryable — транспортный сбой", () => {
    expect(classifyProviderError(new Error("Cannot connect to API: "))).toBe("overloaded");
  });

  it("ответ с кодом — не сетевой сбой: 400 остаётся other, 503 — overloaded по коду, недоступности нет", () => {
    const answered = (statusCode: number) =>
      new APICallError({ message: "ответ", url: "https://provider.test", requestBodyValues: {}, statusCode, isRetryable: statusCode >= 500, cause: systemError("ECONNRESET") });
    expect(isNetworkFailure(answered(400))).toBe(false);
    expect(classifyProviderError(answered(400))).toBe("other");
    expect(classifyProviderError(answered(503))).toBe("overloaded");
  });

  it("обычные ошибки без кода — не сетевые; цикл причин не вешает проверку", () => {
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
    expect(isNetworkFailure("ECONNREFUSED")).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
    const looped = new Error("loop") as Error & { cause?: unknown };
    looped.cause = looped;
    expect(isNetworkFailure(looped)).toBe(false);
  });
});
