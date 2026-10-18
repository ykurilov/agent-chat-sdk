import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createProviderOutages, PROVIDER_OUTAGE_PAUSE_MS } from "../../../src/provider-errors/provider-outages";
import { finishPart, mockCatalog, mockModelId, streamOf, streamStart, textParts, thirdProviderId } from "../support/mock-model";
import { runTurn, textOf } from "../support/turn-fixtures";

/** Ответ провайдера с кодом: 402 — как у DeepSeek с пустым счётом, 401 — ключ не принят. */
function apiError(statusCode: number, body: string): APICallError {
  return new APICallError({
    message: `ответ ${statusCode}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: body,
    responseHeaders: { "retry-after-ms": "1" },
  });
}
const noMoney = () => apiError(402, '{"error":{"message":"Insufficient Balance"}}');
const badKey = () => apiError(401, '{"error":{"message":"Authentication Fails"}}');
const busy = () => apiError(503, "busy");

const failingWith = (error: () => APICallError) =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw error();
    },
  });

const answering = (text = "Ответ запасного") =>
  new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts([text]), finishPart()]) }) });

/** Ход с основным `mock` и запасными `mock-backup` (и `mock-third`, если задан); запасные включены. */
async function turn(models: { primary: MockLanguageModelV4; backup: MockLanguageModelV4; third?: MockLanguageModelV4 }, extra: Parameters<typeof runTurn>[1] = {}) {
  const logged: string[] = [];
  const catalog = mockCatalog({ mock: models.primary, "mock-backup": models.backup, ...(models.third && { [thirdProviderId]: models.third }) });
  const result = await runTurn(models.primary, { catalog, providerFallback: {}, ownerId: "anna", logError: (line) => logged.push(line), ...extra });
  return { ...result, logged };
}

const lines = (logged: string[], prefix: string) => logged.filter((line) => line.startsWith(prefix));

describe("runAgentTurn: у основного кончились деньги или не принят ключ — сразу запасной", () => {
  it("402 (кончились деньги) — без повторов у основного, ответ от запасного; строки журнала с причиной и громкая строка", async () => {
    const primary = failingWith(noMoney);
    const backup = answering();

    const { answer, chunks, logged } = await turn({ primary, backup });

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe("mock-backup");
    expect(textOf(answer.parts)).toBe("Ответ запасного");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(logged).toContain(`[запасной провайдер] чат=chat-1 модель=${mockModelId} с=mock на=mock-backup причина=insufficient_funds кэш потерян`);
    expect(logged).toContain("[ВНИМАНИЕ провайдер] mock: кончились деньги — ходы идут через запасной mock-backup");
    expect(lines(logged, "[сбой провайдера]")).toEqual([]);
  });

  it("403 OpenRouter «Key limit exceeded» — кончился бюджет ключа: запасной, причина insufficient_funds, строка о пределе ключа", async () => {
    const keyLimit = () =>
      apiError(403, '{"error":{"message":"Key limit exceeded (monthly limit). $10.00 of $10.00 used; resets 2026-11-01.","code":403,"metadata":{"limit_source":"openrouter_key_limit"}}}');
    const { answer, logged } = await turn({ primary: failingWith(keyLimit), backup: answering() });
    expect(answer.providerId).toBe("mock-backup");
    expect(logged).toContain(`[запасной провайдер] чат=chat-1 модель=${mockModelId} с=mock на=mock-backup причина=insufficient_funds кэш потерян`);
    expect(logged).toContain("[ВНИМАНИЕ провайдер] mock: исчерпан предел расходов ключа — ходы идут через запасной mock-backup");
  });

  it("401 (ключ не принят) — так же: ответ от запасного, причина invalid_key", async () => {
    const primary = failingWith(badKey);
    const backup = answering();

    const { answer, logged } = await turn({ primary, backup });

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe("mock-backup");
    expect(logged).toContain(`[запасной провайдер] чат=chat-1 модель=${mockModelId} с=mock на=mock-backup причина=invalid_key кэш потерян`);
    expect(logged).toContain("[ВНИМАНИЕ провайдер] mock: ключ не принят — ходы идут через запасной mock-backup");
  });

  it("запасных нет — прежняя ошибка insufficient_funds; громкая строка «запасного нет» и строка о сбое", async () => {
    const primary = failingWith(noMoney);
    const backup = answering();

    const { answer, chunks, logged } = await turn({ primary, backup }, { providerFallback: false });

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(answer.status).toBe("error");
    expect(answer.error?.kind).toBe("insufficient_funds");
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "insufficient_funds" }]);
    expect(logged).toContain("[ВНИМАНИЕ провайдер] mock: кончились деньги — запасного нет, ходы падают с ошибкой");
    expect(lines(logged, "[сбой провайдера]")).toHaveLength(1);
    expect(lines(logged, "[сбой провайдера]")[0]).toContain("провайдер=mock вид=insufficient_funds код=402");
  });

  it("у запасного тоже кончились деньги — ошибка insufficient_funds, по громкой строке на каждого, строка о сбое про запасного", async () => {
    const primary = failingWith(noMoney);
    const backup = failingWith(noMoney);

    const { answer, logged } = await turn({ primary, backup });

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(answer.error?.kind).toBe("insufficient_funds");
    expect(lines(logged, "[ВНИМАНИЕ провайдер]")).toEqual([
      "[ВНИМАНИЕ провайдер] mock: кончились деньги — ходы идут через запасной mock-backup",
      "[ВНИМАНИЕ провайдер] mock-backup: кончились деньги — запасного нет, ходы падают с ошибкой",
    ]);
    expect(lines(logged, "[сбой провайдера]")).toHaveLength(1);
    expect(lines(logged, "[сбой провайдера]")[0]).toContain("провайдер=mock-backup");
  });

  it("основному не принят ключ, у запасного кончились деньги — человеку исходная причина: invalid_key", async () => {
    const { answer, chunks } = await turn({ primary: failingWith(badKey), backup: failingWith(noMoney) });
    expect(answer.error?.kind).toBe("invalid_key");
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "invalid_key" }]);
  });

  it("запасной не собрался ещё до запроса (модели у провайдера нет) — человеку insufficient_funds, а не other", async () => {
    const primary = failingWith(noMoney);
    const logged: string[] = [];
    const { answer } = await runTurn(primary, { catalog: mockCatalog({ mock: primary }), providerFallback: {}, logError: (line) => logged.push(line) });
    expect(logged).toContain(`[запасной провайдер] чат=chat-1 модель=${mockModelId} с=mock на=mock-backup причина=insufficient_funds кэш потерян`);
    expect(answer.error?.kind).toBe("insufficient_funds");
  });

  it("запасной лишь перегружен — человеку overloaded: «попробуйте позже» поможет", async () => {
    const backup = failingWith(busy);
    const { answer } = await turn({ primary: failingWith(noMoney), backup });
    expect(backup.doStreamCalls).toHaveLength(4);
    expect(answer.error?.kind).toBe("overloaded");
  });

  it("первый запасной тоже без денег — ход идёт к следующему по списку", async () => {
    const third = answering("Ответ третьего");
    const { answer } = await turn({ primary: failingWith(noMoney), backup: failingWith(noMoney), third });
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe(thirdProviderId);
    expect(textOf(answer.parts)).toBe("Ответ третьего");
  });

  it("деньги кончились на втором шаге хода — запасной продолжает тот же ответ, инструмент второй раз не выполняется", async () => {
    const execute = vi.fn(async ({ query }: { query: string }) => `найдено: ${query}`);
    const tools = { lookup: tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute }) };
    const firstStep: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: JSON.stringify({ query: "погода" }) },
      finishPart("tool-calls"),
    ];
    let call = 0;
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        if (call++ === 0) return { stream: streamOf(firstStep) };
        throw noMoney();
      },
    });
    const backup = answering("Тепло");

    const { answer, logged } = await turn({ primary, backup }, { tools });

    expect(primary.doStreamCalls).toHaveLength(2);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(backup.doStreamCalls[0]!.prompt)).toContain("найдено: погода");
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe("mock-backup");
    expect(textOf(answer.parts)).toBe("Тепло");
    expect(logged).toContain(`[запасной провайдер] чат=chat-1 модель=${mockModelId} с=mock на=mock-backup причина=insufficient_funds кэш потерян`);
  });
});

describe("runAgentTurn: пауза основного после отказа (общая память службы, подменённые часы)", () => {
  function sharedOutages() {
    let time = 0;
    const logged: string[] = [];
    const providerOutages = createProviderOutages({ now: () => time, logError: (line) => logged.push(line) });
    return { providerOutages, logged, advance: (ms: number) => (time += ms) };
  }

  it("следующие ходы 5 минут идут сразу к запасному, не стуча в пустой основной; потом основной пробуется снова", async () => {
    const { providerOutages, advance } = sharedOutages();
    const primary = failingWith(noMoney);
    const backup = answering();

    await turn({ primary, backup }, { providerOutages });
    expect(primary.doStreamCalls).toHaveLength(1);

    advance(60_000);
    const second = await turn({ primary, backup }, { providerOutages });
    expect(primary.doStreamCalls).toHaveLength(1);
    expect(second.answer.status).toBe("complete");
    expect(second.answer.providerId).toBe("mock-backup");
    expect(second.logged).toContain(`[запасной провайдер] чат=chat-1 модель=${mockModelId} с=mock на=mock-backup причина=insufficient_funds основной на паузе`);

    advance(PROVIDER_OUTAGE_PAUSE_MS);
    const third = await turn({ primary, backup }, { providerOutages });
    expect(primary.doStreamCalls).toHaveLength(2);
    expect(third.answer.providerId).toBe("mock-backup");
  });

  it("громкая строка — одна на несколько ходов подряд", async () => {
    const { providerOutages, logged, advance } = sharedOutages();
    const primary = failingWith(noMoney);
    const backup = answering();
    // Ходы на 0, 5 и 10 минуте: основной пробуется каждый раз после паузы, строка — одна.
    for (let index = 0; index < 3; index++) {
      await turn({ primary, backup }, { providerOutages });
      advance(PROVIDER_OUTAGE_PAUSE_MS);
    }
    expect(primary.doStreamCalls).toHaveLength(3);
    expect(lines(logged, "[ВНИМАНИЕ провайдер]")).toHaveLength(1);
    // На 15 минуте — снова: отказ всё ещё идёт.
    await turn({ primary, backup }, { providerOutages });
    expect(lines(logged, "[ВНИМАНИЕ провайдер]")).toHaveLength(2);
  });

  it("основной на паузе, а запасных нет — пробуется основной: другого пути нет", async () => {
    const { providerOutages } = sharedOutages();
    const primary = failingWith(noMoney);
    await turn({ primary, backup: answering() }, { providerOutages, providerFallback: false });
    const { answer } = await turn({ primary, backup: answering() }, { providerOutages, providerFallback: false });
    expect(primary.doStreamCalls).toHaveLength(2);
    expect(answer.error?.kind).toBe("insufficient_funds");
  });

  it("основной на паузе, запасной тоже без денег — человеку insufficient_funds", async () => {
    const { providerOutages, advance } = sharedOutages();
    const primary = failingWith(noMoney);
    await turn({ primary, backup: answering() }, { providerOutages });
    advance(60_000);
    const backup = failingWith(noMoney);
    const { answer } = await turn({ primary, backup }, { providerOutages });
    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(answer.error?.kind).toBe("insufficient_funds");
  });

  it("запасной на паузе — при перегрузке основного ход идёт мимо него к следующему", async () => {
    const { providerOutages } = sharedOutages();
    providerOutages.report({ providerId: "mock-backup", kind: "insufficient_funds" });
    const backup = answering();
    const third = answering("Ответ третьего");
    const { answer } = await turn({ primary: failingWith(busy), backup, third }, { providerOutages });
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(answer.providerId).toBe(thirdProviderId);
  });

  it("основной «мигает» (ответил и снова отказал за 15 минут) — громкая строка одна", async () => {
    const { providerOutages, logged, advance } = sharedOutages();
    let broke = true;
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        if (broke) throw noMoney();
        return { stream: streamOf([streamStart, ...textParts(["Ответ основного"]), finishPart()]) };
      },
    });
    await turn({ primary, backup: answering() }, { providerOutages });
    advance(PROVIDER_OUTAGE_PAUSE_MS);
    broke = false;
    const { answer } = await turn({ primary, backup: answering() }, { providerOutages });
    expect(answer.providerId).toBe("mock");
    advance(60_000);
    broke = true;
    await turn({ primary, backup: answering() }, { providerOutages });
    expect(lines(logged, "[ВНИМАНИЕ провайдер]")).toHaveLength(1);
  });

  it("основной на паузе, запасной сломался по другой причине — человеку причина запасного: основной в этом ходе не отказывал", async () => {
    const { providerOutages, advance } = sharedOutages();
    const primary = failingWith(noMoney);
    await turn({ primary, backup: answering() }, { providerOutages });
    advance(60_000);
    const { answer } = await turn({ primary, backup: failingWith(() => apiError(400, '{"error":{"message":"bad request"}}')) }, { providerOutages });
    expect(primary.doStreamCalls).toHaveLength(1);
    expect(answer.error?.kind).toBe("other");
  });

  it("пауза кончилась — основного пробует один ход; ход, пришедший во время пробы, идёт к запасному", async () => {
    const { providerOutages, advance } = sharedOutages();
    let release!: () => void;
    const probeGate = new Promise<void>((resolve) => (release = resolve));
    let broke = true;
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        if (broke) throw noMoney();
        await probeGate;
        return { stream: streamOf([streamStart, ...textParts(["Ответ основного"]), finishPart()]) };
      },
    });
    const backup = answering();
    await turn({ primary, backup }, { providerOutages });
    advance(PROVIDER_OUTAGE_PAUSE_MS);
    broke = false;

    const probe = turn({ primary, backup }, { providerOutages });
    await vi.waitFor(() => expect(primary.doStreamCalls).toHaveLength(2));
    const during = await turn({ primary, backup }, { providerOutages });
    expect(during.answer.providerId).toBe("mock-backup");
    expect(primary.doStreamCalls).toHaveLength(2);

    release();
    expect((await probe).answer.providerId).toBe("mock");
    const after = await turn({ primary, backup }, { providerOutages });
    expect(after.answer.providerId).toBe("mock");
  });

  it("запасной на паузе, основной отказал — громкая строка: запасные тоже на паузе", async () => {
    const { providerOutages, logged } = sharedOutages();
    providerOutages.report({ providerId: "mock-backup", kind: "insufficient_funds" });
    const { answer } = await turn({ primary: failingWith(noMoney), backup: answering() }, { providerOutages });
    expect(answer.error?.kind).toBe("insufficient_funds");
    expect(lines(logged, "[ВНИМАНИЕ провайдер] mock:")).toEqual(["[ВНИМАНИЕ провайдер] mock: кончились деньги — запасные тоже на паузе, ходы падают с ошибкой"]);
  });
});

describe("runAgentTurn: отказы, после которых пауза не нужна", () => {
  it("403 по региону — ход у запасного, основной не на паузе, громкой строки нет", async () => {
    const providerOutages = createProviderOutages({ now: () => 0, logError: () => {} });
    const region = () => apiError(403, '{"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported"}}');
    const { answer, logged } = await turn({ primary: failingWith(region), backup: answering() }, { providerOutages });
    expect(answer.providerId).toBe("mock-backup");
    expect(providerOutages.pausedKind("mock")).toBeUndefined();
    expect(lines(logged, "[ВНИМАНИЕ провайдер]")).toEqual([]);
  });

  it("403 модерации — ошибка other, запасному содержимое не передаётся, паузы нет", async () => {
    const providerOutages = createProviderOutages({ now: () => 0, logError: () => {} });
    const flagged = () => apiError(403, '{"error":{"message":"Your chosen model requires moderation and your input was flagged for \\"violence\\""}}');
    const backup = answering();
    const { answer } = await turn({ primary: failingWith(flagged), backup }, { providerOutages });
    expect(answer.error?.kind).toBe("other");
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(providerOutages.pausedKind("mock")).toBeUndefined();
  });

  it("429 «Quota exceeded … per minute» — лимит, не пустой счёт: запасной без паузы основного", async () => {
    const providerOutages = createProviderOutages({ now: () => 0, logError: () => {} });
    const perMinute = () => apiError(429, '{"error":{"code":429,"message":"Quota exceeded for metric: requests, limit: 15 per minute. Please check your plan and billing details."}}');
    const { answer, logged } = await turn({ primary: failingWith(perMinute), backup: answering() }, { providerOutages });
    expect(answer.providerId).toBe("mock-backup");
    expect(providerOutages.pausedKind("mock")).toBeUndefined();
    expect(lines(logged, "[ВНИМАНИЕ провайдер]")).toEqual([]);
  });
});

describe("runAgentTurn: подробности сбоя в итоге ответа (error.details)", () => {
  const keyLimit = () =>
    apiError(
      403,
      '{"error":{"message":"Key limit exceeded (monthly limit). $10.00 of $10.00 used; resets 2026-11-01. Manage: https://openrouter.ai/settings/keys?token=t0p-s3cret","code":403,"metadata":{"limit_source":"openrouter_key_limit"}}}',
    );

  it("запасных нет — провайдер, модель, код, причина без параметров адреса и дата обнуления в сообщении и в последнем куске метаданных", async () => {
    const { answer, chunks } = await turn({ primary: failingWith(keyLimit), backup: answering() }, { providerFallback: false });
    const details = {
      providerId: "mock",
      modelId: mockModelId,
      statusCode: 403,
      reason: "Key limit exceeded (monthly limit). $10.00 of $10.00 used; resets 2026-11-01. Manage: https://openrouter.ai/settings/keys",
      resetsAt: "2026-11-01T00:00:00.000Z",
    };
    expect(answer.error).toEqual({ kind: "insufficient_funds", details });
    const final = chunks.filter((chunk) => chunk.type === "message-metadata").at(-1) as { messageMetadata: { error?: unknown } };
    expect(final.messageMetadata.error).toEqual({ kind: "insufficient_funds", details });
    expect(JSON.stringify(chunks)).not.toContain("t0p-s3cret");
  });

  it("основному предел ключа, запасной без денег — человеку причина основного, подробности тоже про основного", async () => {
    const { answer } = await turn({ primary: failingWith(keyLimit), backup: failingWith(noMoney) });
    expect(answer.error).toMatchObject({ kind: "insufficient_funds", details: { providerId: "mock", statusCode: 403, resetsAt: "2026-11-01T00:00:00.000Z" } });
  });

  it("запасной лишь перегружен — вид overloaded, подробности про запасного", async () => {
    const { answer } = await turn({ primary: failingWith(keyLimit), backup: failingWith(busy) });
    expect(answer.error).toMatchObject({ kind: "overloaded", details: { providerId: "mock-backup", statusCode: 503, reason: "busy" } });
  });
});
