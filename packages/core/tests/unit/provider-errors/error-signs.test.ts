import { describe, expect, it } from "vitest";
import { isContextOverflow, isNotRetryable, looksTransient } from "../../../src/provider-errors/error-signs";

describe("isContextOverflow", () => {
  it("узнаёт переполнение по тексту разных провайдеров", () => {
    for (const text of [
      "This endpoint's maximum context length is 131072 tokens. However, you requested about 200000 tokens",
      "maximum context length is 131072 tokens",
      "prompt is too long: 213462 tokens > 200000 maximum",
      "Your input exceeds the context window of this model",
      "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
      "Please reduce the length of the messages or completion",
    ]) {
      expect(isContextOverflow(text), text).toBe(true);
    }
  });

  it("код 413 — переполнение, даже без текста", () => {
    expect(isContextOverflow("", 413)).toBe(true);
    expect(isContextOverflow("Request Entity Too Large", 413)).toBe(true);
  });

  it("признаки лимита запросов — не переполнение, даже при «too many tokens»", () => {
    expect(isContextOverflow("Too many tokens, please wait before trying again. rate limit")).toBe(false);
    expect(isContextOverflow("ThrottlingException: Too many tokens, please wait")).toBe(false);
    expect(isContextOverflow("Too many requests")).toBe(false);
  });

  it("обычная ошибка — не переполнение", () => {
    expect(isContextOverflow("Internal server error", 500)).toBe(false);
    expect(isContextOverflow("")).toBe(false);
  });
});

describe("isNotRetryable", () => {
  it("квота, бюджет и оплата — не повторять", () => {
    for (const text of ["insufficient_quota", "You exceeded your current quota exceeded", "out of budget", "Billing hard limit reached", "Monthly usage limit reached"]) {
      expect(isNotRetryable(text), text).toBe(true);
    }
  });

  it("временный сбой — повторять можно", () => {
    expect(isNotRetryable("Provider returned error")).toBe(false);
    expect(isNotRetryable("overloaded")).toBe(false);
  });
});

describe("looksTransient", () => {
  it("временные сбои по тексту", () => {
    for (const text of ["Provider returned error", "Overloaded", "fetch failed", "socket hang up", "Service Unavailable", "read ECONNRESET timeout", "rate limit exceeded", "stream ended before message_stop"]) {
      expect(looksTransient(text), text).toBe(true);
    }
  });

  it("голые числа 500 и 502 в тексте — не признак", () => {
    expect(looksTransient("Bad request: 500 items")).toBe(false);
    expect(looksTransient("Invalid value 502 for field")).toBe(false);
  });

  it("обычная ошибка проверки — не временная", () => {
    expect(looksTransient("Invalid API key format")).toBe(false);
  });
});
