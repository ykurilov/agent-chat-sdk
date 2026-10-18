import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyProviderError, isKeyLimit } from "../../../src/provider-errors/classify-provider-error";
import { FirstChunkTimeoutError, StreamStallError } from "../../../src/provider-errors/transient-retry-middleware";
import { deepseekProvider } from "../../../src/models/providers/deepseek";
import { MissingProviderKeyError } from "../../../src/models/model-catalog";

function apiError(statusCode: number | undefined, responseBody?: string): APICallError {
  return new APICallError({
    message: "ответ провайдера",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    ...(statusCode !== undefined && { statusCode }),
    ...(responseBody !== undefined && { responseBody }),
  });
}

describe("classifyProviderError", () => {
  it.each([
    [429, "rate_limited"],
    [503, "overloaded"],
    [529, "overloaded"],
    [401, "invalid_key"],
    [403, "other"],
    [402, "insufficient_funds"],
    [400, "other"],
    [500, "overloaded"],
    [502, "overloaded"],
    [504, "overloaded"],
    [413, "context_overflow"],
  ] as const)("статус %i → %s", (status, kind) => {
    expect(classifyProviderError(apiError(status))).toBe(kind);
  });

  it("«overloaded» в теле ответа → overloaded", () => {
    const body = JSON.stringify({ error: { type: "overloaded_error", message: "Overloaded" } });
    expect(classifyProviderError(apiError(500, body))).toBe("overloaded");
  });

  it("«Insufficient Balance» в теле у DeepSeek → insufficient_funds по подсказке провайдера", () => {
    const body = JSON.stringify({ error: { message: "Insufficient Balance", type: "unknown_error" } });
    expect(classifyProviderError(apiError(400, body), deepseekProvider)).toBe("insufficient_funds");
  });

  it("402 с «Insufficient Balance» → insufficient_funds и без подсказок", () => {
    expect(classifyProviderError(apiError(402, '{"error":{"message":"Insufficient Balance"}}'))).toBe(
      "insufficient_funds",
    );
  });

  it("RetryError классифицируется по последней ошибке", () => {
    const error = new RetryError({
      message: "не вышло",
      reason: "maxRetriesExceeded",
      errors: [apiError(500), apiError(429)],
    });
    expect(classifyProviderError(error)).toBe("rate_limited");
  });

  it("подсказки провайдера срабатывают раньше общих правил", () => {
    const provider = { errorHints: [{ match: /monthly quota/i, kind: "insufficient_funds" as const }] };
    expect(classifyProviderError(apiError(429, "Monthly quota exceeded"), provider)).toBe("insufficient_funds");
    expect(classifyProviderError(apiError(429, "Too many requests"), provider)).toBe("rate_limited");
  });

  it("ошибка из потока без класса APICallError разбирается по полям", () => {
    expect(classifyProviderError({ statusCode: 503, message: "busy" })).toBe("overloaded");
    expect(classifyProviderError({ error: { message: "Server overloaded, please retry" } })).toBe("overloaded");
  });

  it("провайдер не ответил за срок — overloaded", () => {
    expect(classifyProviderError(new FirstChunkTimeoutError(60_000))).toBe("overloaded");
    expect(classifyProviderError(new DOMException("timeout", "TimeoutError"))).toBe("overloaded");
  });

  it("нет ключа провайдера в окружении — invalid_key", () => {
    expect(classifyProviderError(new MissingProviderKeyError("deepseek", "DEEPSEEK_API_KEY"))).toBe("invalid_key");
  });

  it("код берётся из statusCode, status, code и error.code — числом или строкой-числом", () => {
    expect(classifyProviderError({ statusCode: 502, message: "x" })).toBe("overloaded");
    expect(classifyProviderError({ status: 429, message: "x" })).toBe("rate_limited");
    expect(classifyProviderError({ code: 502, message: "Bad gateway" })).toBe("overloaded");
    expect(classifyProviderError({ code: "401", message: "x" })).toBe("invalid_key");
    expect(classifyProviderError({ error: { code: 429, message: "x" } })).toBe("rate_limited");
    expect(classifyProviderError({ code: "ECONNRESET", message: "socket hang up" })).toBe("overloaded");
  });

  it("«Provider returned error» без кода — overloaded", () => {
    expect(classifyProviderError({ message: "Provider returned error" })).toBe("overloaded");
    expect(classifyProviderError(new Error("Provider returned error"))).toBe("overloaded");
    expect(classifyProviderError(new TypeError("fetch failed"))).toBe("overloaded");
  });

  it("признаки переполнения → context_overflow", () => {
    expect(classifyProviderError(apiError(400, '{"error":{"message":"This model\'s maximum context length is 131072 tokens"}}'))).toBe(
      "context_overflow",
    );
    expect(classifyProviderError({ message: "prompt is too long: 210000 tokens > 200000 maximum" })).toBe("context_overflow");
  });

  it("«Too many tokens, please wait» — лимит запросов, не переполнение", () => {
    expect(classifyProviderError(new Error("Too many tokens, please wait before trying again"))).toBe("rate_limited");
  });

  it("квота при 429 — insufficient_funds: «не повторять» проверяется первым", () => {
    expect(classifyProviderError(apiError(429, '{"error":{"code":"insufficient_quota"}}'))).toBe("insufficient_funds");
  });

  describe("403: ключ или деньги — только по явным признакам, иначе other (модерация, регион, доступ к модели)", () => {
    it.each([
      '{"error":{"message":"Invalid API key provided"}}',
      '{"error":{"message":"API key not valid. Please pass a valid API key."}}',
      '{"error":{"message":"Authentication failed"}}',
      '{"error":{"message":"This key is disabled"}}',
    ])("%s → invalid_key", (body) => {
      expect(classifyProviderError(apiError(403, body))).toBe("invalid_key");
    });

    it("«Key limit exceeded» (OpenRouter: предел расходов ключа) → insufficient_funds", () => {
      expect(classifyProviderError(apiError(403, '{"error":{"message":"Key limit exceeded (total limit)"}}'))).toBe("insufficient_funds");
    });

    it.each([
      ['{"error":{"message":"Your chosen model requires moderation and your input was flagged for \"violence\""}}', "модерация OpenRouter"],
      ['{"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported"}}', "регион"],
      ['{"error":{"message":"You do not have access to the model gpt-6"}}', "доступ к модели"],
    ])("%s (%s) → other", (body) => {
      expect(classifyProviderError(apiError(403, body))).toBe("other");
    });
  });

  describe("исчерпан предел расходов ключа — insufficient_funds при любом коде, даже со словами о ключе", () => {
    // Тело из прода конструктор приложений: OpenRouter, месячный предел ключа.
    const openRouterKeyLimit =
      '{"error":{"message":"Key limit exceeded (monthly limit). $10.00 of $10.00 used; resets 2026-11-01. Raise the limit of this API key in your settings.","code":403,"metadata":{"limit_source":"openrouter_key_limit"}}}';

    it("OpenRouter 403 «Key limit exceeded (monthly limit)» со словами «API key» → insufficient_funds", () => {
      const error = apiError(403, openRouterKeyLimit);
      expect(classifyProviderError(error)).toBe("insufficient_funds");
      expect(isKeyLimit(error)).toBe(true);
    });

    it("только metadata.limit_source = openrouter_key_limit, без текста → insufficient_funds", () => {
      expect(classifyProviderError(apiError(403, '{"error":{"message":"Forbidden","code":403,"metadata":{"limit_source":"openrouter_key_limit"}}}'))).toBe("insufficient_funds");
    });

    it("кусок потока с тем же отказом (объект, не APICallError) → insufficient_funds", () => {
      const chunk = { error: { code: 403, message: "Key limit exceeded (monthly limit).", metadata: { limit_source: "openrouter_key_limit" } } };
      expect(classifyProviderError(chunk)).toBe("insufficient_funds");
      expect(isKeyLimit(chunk)).toBe(true);
    });

    it.each([
      [401, '{"error":{"message":"Authentication Error - ExceededBudget: User=anna over budget. Spend=10.2, Budget=10.0"}}', "шлюз с бюджетом ключа, 401"],
      [400, '{"error":{"message":"Budget has been exceeded! Current cost: 10.2, Max budget: 10.0"}}', "шлюз с бюджетом ключа, 400"],
      [403, '{"error":{"message":"This API key has reached its spending limit"}}', "предел расходов ключа"],
    ])("%i %s (%s) → insufficient_funds", (status, body) => {
      expect(classifyProviderError(apiError(status, body))).toBe("insufficient_funds");
    });

    it("обычный 403 без признаков — по-прежнему other; непринятый ключ — invalid_key, а не предел", () => {
      expect(classifyProviderError(apiError(403, '{"error":{"message":"Forbidden"}}'))).toBe("other");
      const badKey = apiError(403, '{"error":{"message":"Invalid API key provided"}}');
      expect(classifyProviderError(badKey)).toBe("invalid_key");
      expect(isKeyLimit(badKey)).toBe(false);
    });
  });

  it("429 «Quota exceeded … per minute» (Gemini) — rate_limited: код 429 главнее общих слов о квоте", () => {
    const body = '{"error":{"code":429,"message":"Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_requests, limit: 15 per minute. Please check your plan and billing details."}}';
    expect(classifyProviderError(apiError(429, body))).toBe("rate_limited");
  });

  it("«overloaded» в тексте ответа 400 — other: текст смотрится только без кода или при коде ≥ 500", () => {
    expect(classifyProviderError(apiError(400, "model overloaded"))).toBe("other");
  });

  it("срок тишины посреди ответа — overloaded", () => {
    expect(classifyProviderError(new StreamStallError(120_000))).toBe("overloaded");
  });

  it("всё остальное → other", () => {
    expect(classifyProviderError(new Error("что-то сломалось"))).toBe("other");
    expect(classifyProviderError("строка")).toBe("other");
    expect(classifyProviderError(undefined)).toBe("other");
  });
});
