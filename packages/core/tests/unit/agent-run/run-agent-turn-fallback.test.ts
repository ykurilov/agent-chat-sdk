import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import type { UsageRecord } from "../../../src/conversation/types";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, mockCatalog, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

const price = { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: 0.1 };

/** Ошибка провайдера с паузой повтора в 1 мс: тихие повторы идут по-настоящему, но тест их не ждёт. */
function apiError(statusCode: number, body = "busy"): APICallError {
  return new APICallError({
    message: `ответ ${statusCode}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: body,
    responseHeaders: { "retry-after-ms": "1" },
  });
}

const failing = (statusCode: number) =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw apiError(statusCode);
    },
  });

const answering = (text = "Ответ запасного") =>
  new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts([text]), finishPart()]) }) });

/** Ход с основным `mock` и запасным `mock-backup`; запасные включены явно. */
async function turnWithBackup(primary: MockLanguageModelV4, backup: MockLanguageModelV4, extra: Parameters<typeof runTurn>[1] = {}) {
  const logged: string[] = [];
  const result = await runTurn(primary, {
    catalog: mockCatalog({ mock: primary, "mock-backup": backup }, { pricing: price }),
    providerFallback: {},
    ownerId: "anna",
    logError: (line) => logged.push(line),
    ...extra,
  });
  return { ...result, logged };
}

describe("runAgentTurn: запасной провайдер той же модели (US3 сц. 4–5)", () => {
  it("выбранный перегружен после тихих повторов, ответа ещё не было — ответ от запасного, записан с его провайдером (сц. 4)", async () => {
    const primary = failing(503);
    const backup = answering();

    const { answer, chunks, logged } = await turnWithBackup(primary, backup);

    expect(primary.doStreamCalls).toHaveLength(4);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe("mock-backup");
    expect(textOf(answer.parts)).toBe("Ответ запасного");
    // Клиент получил один start; ошибки первого провайдера в потоке нет.
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(chunks.at(-2)).toEqual({
      type: "message-metadata",
      messageMetadata: expect.objectContaining({ status: "complete", providerId: "mock-backup" }),
    });
    expect(logged).toContain(`[запасной провайдер] чат=chat-1 модель=${mockModelId} с=mock на=mock-backup причина=overloaded кэш потерян`);
    expect(logged.some((line) => line.startsWith("[сбой провайдера]"))).toBe(false);
  });

  it("пока выбранный провайдер молчит, клиент уже получил start: тихие повторы выглядят обычным ожиданием", async () => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        await gate;
        return { stream: streamOf([streamStart, ...textParts(["Ответ"]), finishPart()]) };
      },
    });
    const storage = await storageWithQuestion();
    const reader = startTurn(storage, primary, { catalog: mockCatalog({ mock: primary, "mock-backup": answering() }), providerFallback: {} }).getReader();

    expect((await reader.read()).value).toEqual({ type: "start", messageId: "a1", messageMetadata: { modelId: mockModelId, providerId: "mock" } });
    answer();
    const rest: string[] = [];
    for (let read = await reader.read(); !read.done; read = await reader.read()) rest.push(read.value.type);
    expect(rest).not.toContain("start");
  });

  it("расход записан с провайдером, который ответил, и по его цене", async () => {
    const primary = failing(503);
    const backup = answering();
    const storage = await storageWithQuestion();
    const written: UsageRecord[] = [];
    const recording = {
      ...storage,
      insertUsageRecord: async (record: UsageRecord) => {
        written.push(record);
        await storage.insertUsageRecord(record);
      },
    };
    const backupPrice = { inputPerMillion: 10, outputPerMillion: 20, cachedInputPerMillion: 1 };
    const catalog = mockCatalog({ mock: primary, "mock-backup": backup }, { pricing: price });
    const profile = catalog.models.find((model) => model.id === mockModelId)!;
    profile.pricing = { mock: price, "mock-backup": backupPrice };

    await readAll(startTurn(recording, primary, { catalog, providerFallback: {}, ownerId: "anna", logError: () => {} }));

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ providerId: "mock-backup", modelId: mockModelId });
    // 40 без кэша, 60 из кэша, 30 на выходе — по ценам запасного.
    expect(written[0]!.costUsd).toBeCloseTo((40 * 10 + 60 * 1 + 30 * 20) / 1_000_000, 10);
  });

  it("SC-004: 20 из 20 — ответ от запасного, провайдер в сообщении и в журнале расходов", async () => {
    for (let run = 0; run < 20; run++) {
      const primary = failing(503);
      const backup = answering();
      const { answer, storage } = await turnWithBackup(primary, backup);
      expect(answer.status).toBe("complete");
      expect(answer.providerId).toBe("mock-backup");
      const spent = await storage.sumUsage({ ownerId: "anna" });
      expect(spent).toEqual([expect.objectContaining({ modelId: mockModelId, providerId: "mock-backup", outputTokens: 30 })]);
    }
  });

  it("лимит запросов (429) тоже переходит", async () => {
    const backup = answering();
    const { answer } = await turnWithBackup(failing(429), backup);
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe("mock-backup");
  });

  it("провайдер упал после первого куска — запасной не пробуется, продолжение у того же провайдера; не вышло — error (сц. 5)", async () => {
    const parts: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Начало" },
      { type: "error", error: apiError(503) },
    ];
    const primary = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(parts) }) });
    const backup = answering();

    // Паузы автопродолжений — на подменённых часах.
    const { answer, logged } = await onFakeClock(() => turnWithBackup(primary, backup));

    expect(backup.doStreamCalls).toHaveLength(0);
    // Обрыв и два автопродолжения у того же провайдера (US7).
    expect(primary.doStreamCalls).toHaveLength(3);
    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind: "overloaded" });
    expect(answer.providerId).toBe("mock");
    expect(textOf(answer.parts)).toBe("НачалоНачалоНачало");
    expect(logged.some((line) => line.startsWith("[запасной провайдер]"))).toBe(false);
  });

  it.each([
    [402, "insufficient_funds"],
    [401, "invalid_key"],
    [400, "other"],
  ] as const)("код %i (%s) — запасной не пробуется (FR-032)", async (status, kind) => {
    const backup = answering();
    const { answer } = await turnWithBackup(failing(status), backup);
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(answer.error).toEqual({ kind });
  });

  it("запасные выключены (false) — ошибка, запасной не пробуется", async () => {
    const backup = answering();
    const { answer } = await turnWithBackup(failing(503), backup, { providerFallback: false });
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(answer.error).toEqual({ kind: "overloaded" });
  });

  it("у запасного тоже перегрузка — один переход, ошибка вида overloaded, сообщение с выбранным провайдером", async () => {
    const primary = failing(503);
    const backup = failing(503);

    const { answer, chunks, logged } = await turnWithBackup(primary, backup);

    expect(primary.doStreamCalls).toHaveLength(4);
    expect(backup.doStreamCalls).toHaveLength(4);
    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind: "overloaded" });
    expect(answer.providerId).toBe("mock");
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "overloaded" }]);
    // Строка о сбое — одна, про того, кто упал последним.
    const failures = logged.filter((line) => line.startsWith("[сбой провайдера]"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("провайдер=mock-backup");
  });

  it("«Стоп» во время повторов — stopped, без перехода", async () => {
    const controller = new AbortController();
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        controller.abort();
        throw apiError(503);
      },
    });
    const backup = answering();

    const { answer, logged } = await turnWithBackup(primary, backup, { abortSignal: controller.signal });

    expect(answer.status).toBe("stopped");
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(logged.some((line) => line.startsWith("[запасной провайдер]") || line.startsWith("[сбой провайдера]"))).toBe(false);
  });

  it("«Стоп» после перехода, до первого куска запасного — stopped, ответ записан на запасного", async () => {
    const controller = new AbortController();
    const backup = new MockLanguageModelV4({
      doStream: async () => {
        controller.abort();
        throw apiError(503);
      },
    });

    const { answer } = await turnWithBackup(failing(503), backup, { abortSignal: controller.signal });

    expect(backup.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("stopped");
    expect(answer.providerId).toBe("mock-backup");
  });

  it("«Стоп» в момент перехода — запрос к запасному не строится", async () => {
    const controller = new AbortController();
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => ({}));
    const backup = answering();

    const { answer } = await turnWithBackup(failing(503), backup, {
      tools,
      abortSignal: controller.signal,
      logError: (line) => {
        if (line.startsWith("[запасной провайдер]")) controller.abort();
      },
    });

    expect(answer.status).toBe("stopped");
    expect(tools.mock.calls.map(([model]) => model.providerId)).toEqual(["mock"]);
    expect(backup.doStreamCalls).toHaveLength(0);
  });

  it("при переходе запрос и инструменты строятся заново под запасного провайдера", async () => {
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => ({}));
    const { answer } = await turnWithBackup(failing(503), answering(), { tools });
    expect(answer.status).toBe("complete");
    expect(tools.mock.calls.map(([model]) => model.providerId)).toEqual(["mock", "mock-backup"]);
  });

  it("номер хода (turnId) у инструментов один на обе попытки: это id ответа агента", async () => {
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => ({}));
    const { answer } = await turnWithBackup(failing(503), answering(), { tools });
    expect(tools.mock.calls.map(([model]) => model.turnId)).toEqual([answer.id, answer.id]);
  });
});
