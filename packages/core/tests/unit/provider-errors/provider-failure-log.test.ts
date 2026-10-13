import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { describeProviderFailure } from "../../../src/provider-errors/provider-failure-log";
import { mockCatalog } from "../support/mock-model";

const catalog = mockCatalog({});
const providerKey = "fw_настоящий-ключ-провайдера-1234";
const env = { FIREWORKS_API_KEY: providerKey, MOCK_API_KEY: "коротко", UNRELATED: "значение-не-ключа-провайдера" };
const context = { chatId: "chat-1", modelId: "mock-model", providerId: "mock", kind: "other" as const, env, catalog };

function apiError(fields: { statusCode?: number; responseBody?: string; message?: string; headers?: Record<string, string> }) {
  return new APICallError({
    message: fields.message ?? "ответ провайдера",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    ...(fields.statusCode !== undefined && { statusCode: fields.statusCode }),
    ...(fields.responseBody !== undefined && { responseBody: fields.responseBody }),
    ...(fields.headers && { responseHeaders: fields.headers }),
  });
}

describe("describeProviderFailure", () => {
  it("одна строка: чат, модель, провайдер, вид, код, имя и тело", () => {
    const line = describeProviderFailure(apiError({ statusCode: 400, responseBody: '{"error":"bad"}' }), context);
    expect(line).toBe(
      '[сбой провайдера] чат=chat-1 модель=mock-model провайдер=mock вид=other код=400 имя=AI_APICallError тело={"error":"bad"}',
    );
  });

  it("тело 10 000 знаков с ключом из env — обрезано до 4000, ключа нет (SC-007)", () => {
    const body = `${"x".repeat(100)} ${providerKey} ${"y".repeat(10_000)}`;
    const line = describeProviderFailure(apiError({ statusCode: 400, responseBody: body }), context);
    expect(line).not.toContain(providerKey);
    expect(line).toContain("[скрыто]");
    const shown = line.slice(line.indexOf("тело=") + "тело=".length);
    expect(shown.length).toBe(4000);
  });

  it("нет responseBody — берётся сообщение", () => {
    const line = describeProviderFailure(new Error("сеть упала"), context);
    expect(line).toContain("код=нет имя=Error тело=сеть упала");
  });

  it("код из куска потока и вложенного error.code", () => {
    expect(describeProviderFailure({ code: 502, message: "Provider returned error" }, context)).toContain(
      "код=502 имя=нет тело=Provider returned error",
    );
    expect(describeProviderFailure({ error: { code: "429", message: "slow down" } }, context)).toContain("код=429");
  });

  it("пустое тело или не текст — «тело пустое»", () => {
    expect(describeProviderFailure(apiError({ statusCode: 500, responseBody: "", message: "" }), context)).toContain("тело=тело пустое");
    expect(describeProviderFailure(42, context)).toContain("тело=тело пустое");
    expect(describeProviderFailure(undefined, context)).toContain("тело=тело пустое");
  });

  it("заголовки не пишутся", () => {
    const line = describeProviderFailure(
      apiError({ statusCode: 429, responseBody: "лимит", headers: { authorization: "Bearer секрет-в-заголовке", "x-request-id": "req-77" } }),
      context,
    );
    expect(line).not.toContain("секрет-в-заголовке");
    expect(line).not.toContain("req-77");
  });

  it("строка одна: переводы строк тела заменены пробелом", () => {
    const line = describeProviderFailure(apiError({ statusCode: 500, responseBody: "первая\nвторая\r\nтретья" }), context);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("тело=первая вторая третья");
  });

  it("RetryError описывается по последней ошибке", () => {
    const error = new RetryError({ message: "не вышло", reason: "maxRetriesExceeded", errors: [apiError({ statusCode: 503, responseBody: "занято" })] });
    expect(describeProviderFailure(error, context)).toContain("код=503 имя=AI_APICallError тело=занято");
  });

  it("обрезка не рвёт эмодзи", () => {
    const body = `${"a".repeat(3999)}😀хвост`;
    const line = describeProviderFailure(apiError({ statusCode: 500, responseBody: body }), context);
    expect(line.endsWith("a")).toBe(true);
  });
});
