import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { providerErrorDetails } from "../../../src/provider-errors/provider-error-details";
import { mockCatalog } from "../support/mock-model";

const catalog = mockCatalog({});
const providerKey = "fw_настоящий-ключ-провайдера-1234";
const env = { FIREWORKS_API_KEY: providerKey };
/** «Сейчас» в тестах — 18.10.2026: дата обнуления принимается только в будущем и не дальше двух лет. */
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const context = { providerId: "openrouter", modelId: "anthropic/claude-sonnet", env, catalog, now: () => NOW };

function apiError(statusCode: number, responseBody: string, message = "ответ провайдера") {
  return new APICallError({ message, url: "https://provider.test/v1/chat/completions", requestBodyValues: {}, statusCode, responseBody });
}

const KEY_LIMIT_BODY =
  '{"error":{"message":"Key limit exceeded (monthly limit). $10.00 of $10.00 used; resets 2026-11-01. Raise the limit of this API key in your settings.","code":403,"metadata":{"limit_source":"openrouter_key_limit"}}}';

describe("providerErrorDetails", () => {
  it("OpenRouter key limit: провайдер, модель, код, причина одной строкой из error.message, дата обнуления", () => {
    expect(providerErrorDetails(apiError(403, KEY_LIMIT_BODY), context)).toEqual({
      providerId: "openrouter",
      modelId: "anthropic/claude-sonnet",
      statusCode: 403,
      reason: "Key limit exceeded (monthly limit). $10.00 of $10.00 used; resets 2026-11-01. Raise the limit of this API key in your settings.",
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
  });

  it("дата обнуления из метаданных: строка ISO или секунды Unix", () => {
    const iso = '{"error":{"message":"Key limit exceeded","metadata":{"limit_reset":"2026-11-01T00:00:00Z"}}}';
    expect(providerErrorDetails(apiError(403, iso), context).resetsAt).toBe("2026-11-01T00:00:00.000Z");
    const unix = '{"error":{"message":"Budget exceeded","metadata":{"resets_at":1793491200}}}';
    expect(providerErrorDetails(apiError(403, unix), context).resetsAt).toBe(new Date(1793491200 * 1000).toISOString());
  });

  it("число в поле сброса — «через N секунд», если оно маленькое или поле про секунды; миллисекунды Unix — дата", () => {
    const after = (metadata: string) => providerErrorDetails(apiError(429, `{"error":{"message":"Rate limit exceeded","metadata":${metadata}}}`), context).resetsAt;
    expect(after('{"reset_seconds":30}')).toBe(new Date(NOW + 30_000).toISOString());
    expect(after('{"ratelimit_reset":30}')).toBe(new Date(NOW + 30_000).toISOString());
    expect(after('{"reset_after":3600}')).toBe(new Date(NOW + 3_600_000).toISOString());
    expect(after('{"reset_ms":1500}')).toBe(new Date(NOW + 1500).toISOString());
    expect(after(`{"reset":${NOW + 60_000}}`)).toBe(new Date(NOW + 60_000).toISOString());
  });

  it("время без пояса — UTC", () => {
    const body = '{"error":{"message":"Key limit exceeded (monthly limit). resets 2026-11-01 06:30"}}';
    expect(providerErrorDetails(apiError(403, body), context).resetsAt).toBe("2026-11-01T06:30:00.000Z");
    const metadata = '{"error":{"message":"Key limit exceeded","metadata":{"limit_reset":"2026-11-01T06:30:00"}}}';
    expect(providerErrorDetails(apiError(403, metadata), context).resetsAt).toBe("2026-11-01T06:30:00.000Z");
  });

  it("прошлое и даты дальше двух лет не принимаются", () => {
    for (const date of ["2020-01-01", "0001-01-01", "2029-01-01", "2026-10-17"]) {
      expect(providerErrorDetails(apiError(403, `{"error":{"message":"Key limit exceeded. resets ${date}"}}`), context)).not.toHaveProperty("resetsAt");
    }
  });

  it("дата из текста — только из сообщения о пределе, не из повторённого текста человека", () => {
    const moderation = `{"error":{"message":"Input flagged for moderation: 'my plan resets 2026-11-01, password inside'","code":403}}`;
    expect(providerErrorDetails(apiError(403, moderation), context)).not.toHaveProperty("resetsAt");
    const quotedInLimit = `{"error":{"message":"Key limit exceeded for prompt 'resets 2026-11-01'"}}`;
    expect(providerErrorDetails(apiError(403, quotedInLimit), context)).not.toHaveProperty("resetsAt");
  });

  it("нет даты или дата неверная — resetsAt нет", () => {
    expect(providerErrorDetails(apiError(402, '{"error":{"message":"Insufficient credits"}}'), context)).not.toHaveProperty("resetsAt");
    expect(providerErrorDetails(apiError(403, '{"error":{"message":"resets 2026-13-45"}}'), context)).not.toHaveProperty("resetsAt");
  });

  it("без секретов: ключ из окружения, Bearer, ?key= и параметры адресов вычищены", () => {
    const body = `{"error":{"message":"bad key ${providerKey}, Bearer sk-or-v1-abcdef0123456789 see https://openrouter.ai/settings/keys?token=t0p-s3cret&user=7 and https://x.test/v1?key=AIzaSecret"}}`;
    const reason = providerErrorDetails(apiError(401, body), context).reason!;
    expect(reason).not.toContain(providerKey);
    expect(reason).not.toContain("sk-or-v1-abcdef0123456789");
    expect(reason).not.toContain("t0p-s3cret");
    expect(reason).not.toContain("user=7");
    expect(reason).not.toContain("AIzaSecret");
    expect(reason).toContain("https://openrouter.ai/settings/keys");
  });

  it("идентификаторы организации и проекта, e-mail в причине скрыты", () => {
    const body = '{"error":{"message":"Project proj_AbC123xyz in org-AbCdEf123456 of admin@example.com exceeded quota"}}';
    const reason = providerErrorDetails(apiError(429, body), context).reason!;
    expect(reason).not.toMatch(/proj_AbC123xyz|org-AbCdEf123456|admin@example\.com/);
    expect(reason).toContain("exceeded quota");
  });

  it("причина — одна строка не длиннее 300 знаков; тело не JSON берётся как есть", () => {
    const reason = providerErrorDetails(apiError(500, `первая\nвторая ${"я".repeat(1000)}`), context).reason!;
    expect(reason).not.toMatch(/[\r\n]/);
    expect(reason.startsWith("первая вторая")).toBe(true);
    expect(reason.length).toBeLessThanOrEqual(300);
  });

  it("кусок потока и RetryError: код и сообщение вложенной ошибки", () => {
    const chunk = { error: { code: 403, message: "Key limit exceeded (monthly limit).", metadata: { limit_source: "openrouter_key_limit" } } };
    expect(providerErrorDetails(chunk, context)).toMatchObject({ statusCode: 403, reason: "Key limit exceeded (monthly limit)." });
    const retry = new RetryError({ message: "failed", reason: "maxRetriesExceeded", errors: [apiError(429, '{"error":{"message":"slow down"}}')] });
    expect(providerErrorDetails(retry, context)).toMatchObject({ statusCode: 429, reason: "slow down" });
  });

  it("ни кода, ни текста — только провайдер и модель", () => {
    expect(providerErrorDetails(undefined, context)).toEqual({ providerId: "openrouter", modelId: "anthropic/claude-sonnet" });
  });
});
