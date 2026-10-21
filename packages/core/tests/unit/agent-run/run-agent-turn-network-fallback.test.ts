import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { checkProviderFallback } from "../../../src/agent-run/next-attempt";
import { createProviderOutages } from "../../../src/provider-errors/provider-outages";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, mockCatalog, mockModelId, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn, textOf } from "../support/turn-fixtures";

const networkError = () => new APICallError({
  message: "Cannot connect to API: ", url: "https://primary.test", requestBodyValues: {}, isRetryable: true,
  cause: new TypeError("fetch failed", { cause: Object.assign(new Error(""), { code: "ECONNREFUSED" }) }),
});
const serverError = () => new APICallError({
  message: "busy", url: "https://primary.test", requestBodyValues: {}, statusCode: 503,
});
const rawNetworkError = () => new TypeError("fetch failed", { cause: Object.assign(new Error(""), { code: "ECONNREFUSED" }) });

describe("быстрый переход при сетевом сбое и 5xx", () => {
  async function scenario(error: unknown, options: Parameters<typeof runTurn>[1] = {}) {
    const primary = new MockLanguageModelV4({ doStream: async () => { throw error; } });
    let backupAt = -1;
    const backup = new MockLanguageModelV4({ doStream: async () => {
      backupAt = Date.now();
      return { stream: streamOf([streamStart, ...textParts(["Запасной ответил"]), finishPart()]) };
    } });
    const catalog = mockCatalog({ mock: primary, "mock-backup": backup });
    catalog.providers.find((provider) => provider.id === "mock-backup")!.apiKeyEnv = "BACKUP_API_KEY";
    const outages = createProviderOutages({ now: Date.now, logError: () => {} });
    const startedAt = Date.now();
    const result = await runTurn(primary, { catalog, env: { MOCK_API_KEY: "key", BACKUP_API_KEY: "key" }, providerFallback: {}, providerOutages: outages, logError: () => {}, ...options });
    return { ...result, primary, backup, backupMs: backupAt - startedAt, elapsedMs: Date.now() - startedAt, outages };
  }

  it.each([networkError, rawNetworkError, serverError])("по умолчанию — один короткий повтор, запасной раньше 5 с (%#)", async (makeError) => {
    const result = await onFakeClock(() => scenario(makeError()));
    expect(result.primary.doStreamCalls).toHaveLength(2);
    expect(result.backup.doStreamCalls).toHaveLength(1);
    expect(result.backupMs).toBeGreaterThanOrEqual(250);
    expect(result.backupMs).toBeLessThan(5_000);
    expect(result.answer.status).toBe("complete");
    expect(textOf(result.answer.parts)).toBe("Запасной ответил");
    expect(result.outages.pausedKind("mock")).toBeUndefined();
  });

  it.each([[], [100, 200]].map((retryDelaysMs) => ({ retryDelaysMs })))("retryDelaysMs=$retryDelaysMs задаёт паузы и число повторов, включая немедленный переход", async ({ retryDelaysMs }) => {
    const result = await onFakeClock(() => scenario(networkError(), { providerFallback: { retryDelaysMs } }));
    expect(result.primary.doStreamCalls).toHaveLength(retryDelaysMs.length + 1);
    expect(result.backupMs).toBeGreaterThanOrEqual(retryDelaysMs.reduce((sum, delay) => sum + delay, 0));
    expect(result.backupMs).toBeLessThanOrEqual(retryDelaysMs.reduce((sum, delay) => sum + delay, 0) * 1.25);
    expect(result.answer.providerId).toBe("mock-backup");
  });

  it("длинный Retry-After не задерживает запасного: ограничен бюджетом быстрых повторов", async () => {
    const error = new APICallError({ message: "busy", url: "https://primary.test", requestBodyValues: {}, statusCode: 503, responseHeaders: { "retry-after": "120" } });
    const result = await onFakeClock(() => scenario(error));
    expect(result.primary.doStreamCalls).toHaveLength(2);
    expect(result.backupMs).toBeLessThan(5_000);
  });

  it.each([false, { byModel: { [mockModelId]: false }, retryDelaysMs: [] }] as const)("без доступного запасного — прежние три повтора (%j)", async (providerFallback) => {
    const result = await onFakeClock(() => scenario(networkError(), { providerFallback }));
    expect(result.primary.doStreamCalls).toHaveLength(4);
    expect(result.backup.doStreamCalls).toHaveLength(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(10_000);
    expect(result.answer.error?.kind).toBe("overloaded");
  });

  it("запасной без ключа — прежние повторы", async () => {
    const result = await onFakeClock(() => scenario(serverError(), { env: { MOCK_API_KEY: "key" } }));
    expect(result.primary.doStreamCalls).toHaveLength(4);
    expect(result.backup.doStreamCalls).toHaveLength(0);
  });

  it("запасной на паузе — прежние повторы, даже с retryDelaysMs: []", async () => {
    const providerOutages = createProviderOutages({ now: Date.now, logError: () => {} });
    providerOutages.report({ providerId: "mock-backup", kind: "invalid_key" });
    const result = await onFakeClock(() => scenario(serverError(), { providerOutages, providerFallback: { retryDelaysMs: [] } }));
    expect(result.primary.doStreamCalls).toHaveLength(4);
    expect(result.backup.doStreamCalls).toHaveLength(0);
  });

  it.each([networkError, serverError])("после начала ответа — без перехода (%#)", async (makeError) => {
    const primary = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([
      streamStart, ...textParts(["Начало"]), { type: "error", error: makeError() },
    ]) }) });
    const backup = new MockLanguageModelV4();
    const result = await onFakeClock(() => runTurn(primary, {
      catalog: mockCatalog({ mock: primary, "mock-backup": backup }), providerFallback: { retryDelaysMs: [] }, logError: () => {},
    }));
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(primary.doStreamCalls).toHaveLength(3);
    expect(result.answer.error?.kind).toBe("overloaded");
  });

  it.each([null, -1, "fast", [NaN], [Infinity], [-1], ["100"]].map((retryDelaysMs) => ({ retryDelaysMs })))("неверная настройка $retryDelaysMs отклоняется при создании службы", ({ retryDelaysMs }) => {
    const catalog = mockCatalog({ mock: new MockLanguageModelV4() });
    expect(() => checkProviderFallback({ retryDelaysMs } as never, catalog)).toThrow(/providerFallback.retryDelaysMs/);
  });
});
