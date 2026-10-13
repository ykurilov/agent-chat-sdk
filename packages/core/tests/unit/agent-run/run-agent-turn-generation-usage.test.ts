import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenUsage, UsageRecord } from "../../../src/conversation/types";
import type { ModelCatalog, ProviderDescription } from "../../../src/models/model-catalog";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { costOfUsage } from "../../../src/usage/usage-cost";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, mockCatalog, mockModelId, readAll, streamStart, textParts } from "../support/mock-model";
import { startTurn, storageWithQuestion } from "../support/turn-fixtures";

const price = { inputPerMillion: 1, outputPerMillion: 4, cachedInputPerMillion: 0.1 };
const backupPrice = { inputPerMillion: 10, outputPerMillion: 40, cachedInputPerMillion: 1 };
const tokens = (usage: TokenUsage) => ({ ...usage, cacheWriteTokens: usage.cacheWriteTokens ?? 0 });

async function recordingStorage() {
  const storage = await storageWithQuestion();
  const written: UsageRecord[] = [];
  const recording: ChatStorage = {
    ...storage,
    insertUsageRecord: async (record) => {
      written.push(record);
      await storage.insertUsageRecord(record);
    },
  };
  return { storage: recording, written };
}

/**
 * Каталог заглушек, у провайдера `mock` — «узнать расход генерации»: номер — из заголовка `x-generation-id`, расход —
 * из `known` (нет — «ещё не знаю»). `lookups` — номера, о которых спрашивали.
 */
function catalogWithLookup(models: Parameters<typeof mockCatalog>[0], known: Map<string, TokenUsage>) {
  const lookups: string[] = [];
  const keys: string[] = [];
  const catalog: ModelCatalog = mockCatalog(models, { pricing: price });
  catalog.models.find((model) => model.id === mockModelId)!.pricing = { mock: price, "mock-backup": backupPrice };
  catalog.providers = catalog.providers.map(
    (provider): ProviderDescription =>
      provider.id === "mock"
        ? {
            ...provider,
            generationUsage: {
              generationId: (headers) => headers?.["x-generation-id"],
              lookup: async ({ generationId, apiKey }) => {
                lookups.push(generationId);
                keys.push(apiKey);
                return known.get(generationId) ?? null;
              },
            },
          }
        : provider,
  );
  return { catalog, lookups, keys };
}

/** Модель, у каждого запроса которой свой номер генерации; поток — из `script`, `"silent"` — молчит до отмены. */
function numberedModel(script: Array<LanguageModelV4StreamPart[] | "silent">) {
  let request = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const next = script[Math.min(request, script.length - 1)]!;
      request += 1;
      const headers = { "x-generation-id": `gen-${request}` };
      if (next !== "silent") {
        return { stream: new ReadableStream({ start: (c) => (next.forEach((part) => c.enqueue(part)), c.close()) }), response: { headers } };
      }
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason), { once: true });
          },
        }),
        response: { headers },
      };
    },
  });
}

/** Модель, чьим потоком управляет тест, с номером генерации `gen-1`. */
function controlledNumberedModel() {
  let controller!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
  let opened!: () => void;
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(streamController) {
          controller = streamController;
          abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          opened();
        },
      }),
      response: { headers: { "x-generation-id": "gen-1" } },
    }),
  });
  return {
    model,
    opened: new Promise<void>((resolve) => (opened = resolve)),
    push: (...parts: LanguageModelV4StreamPart[]) => parts.forEach((part) => controller.enqueue(part)),
  };
}

/** «Стоп» после первого куска текста: оценённый шаг с номером генерации `gen-1`. */
async function stoppedTurn(known: Map<string, TokenUsage>, logError: (line: string) => void = () => {}) {
  const { storage, written } = await recordingStorage();
  const source = controlledNumberedModel();
  const { catalog, lookups, keys } = catalogWithLookup({ mock: source.model }, known);
  const stop = new AbortController();
  const reader = startTurn(storage, source.model, { catalog, ownerId: "anna", abortSignal: stop.signal, logError }).getReader();
  await source.opened;
  source.push(streamStart, { type: "text-start", id: "txt-0" }, { type: "text-delta", id: "txt-0", delta: "а".repeat(300) });
  for (let read = await reader.read(); read.value?.type !== "text-delta"; read = await reader.read());
  stop.abort();
  while (!(await reader.read()).done);
  return { written, lookups, keys };
}

describe("runAgentTurn: настоящий расход оборванной генерации (FR-058)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("«Стоп»: оценка сразу, а когда провайдер узнал расход — поправка до настоящего, без пометки «примерно»", async () => {
    const actual: TokenUsage = { inputTokens: 2_000, cachedInputTokens: 500, outputTokens: 900, reasoningTokens: 100 };
    const known = new Map<string, TokenUsage>();
    const { written, lookups, keys } = await onFakeClock(() => stoppedTurn(known));
    expect(written).toHaveLength(1);
    const estimate = written[0]!;
    expect(estimate).toMatchObject({ source: "answer", estimated: true });

    // Провайдер ещё не знает генерацию: спрашивают ещё раз позже.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lookups.length).toBeGreaterThan(0);
    expect(written).toHaveLength(1);
    known.set("gen-1", actual);
    await vi.advanceTimersByTimeAsync(600_000);

    expect(written).toHaveLength(2);
    const correction = written[1]!;
    expect(correction).toMatchObject({
      source: "answer_correction",
      ownerId: "anna",
      chatId: estimate.chatId,
      messageId: "a1",
      modelId: mockModelId,
      providerId: "mock",
      createdAt: estimate.createdAt,
      inputTokens: actual.inputTokens - estimate.inputTokens,
      cachedInputTokens: actual.cachedInputTokens - estimate.cachedInputTokens,
      outputTokens: actual.outputTokens - estimate.outputTokens,
      reasoningTokens: actual.reasoningTokens - estimate.reasoningTokens,
    });
    expect(correction.estimated).toBeFalsy();
    // Сумма двух записей — настоящий расход по ценам модели.
    expect(estimate.costUsd + correction.costUsd).toBeCloseTo(costOfUsage(tokens(actual), price), 12);
    expect(keys.every((key) => key === "не-настоящий-ключ")).toBe(true);
    // Узнали — больше не спрашивают.
    const asked = lookups.length;
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(lookups).toHaveLength(asked);
  });

  it("провайдер так и не узнал генерацию — оценка остаётся, поправки нет, вопросов ограниченное число", async () => {
    const { written, lookups } = await onFakeClock(() => stoppedTurn(new Map()));

    await vi.advanceTimersByTimeAsync(3 * 3_600_000);

    expect(written).toHaveLength(1);
    expect(written[0]!.estimated).toBe(true);
    expect(lookups.length).toBeGreaterThan(1);
    expect(lookups.length).toBeLessThanOrEqual(10);
  });

  it("журнал сервера бросает — фоновая сверка не роняет процесс необработанным отказом", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { written } = await onFakeClock(() =>
        stoppedTurn(new Map(), (line) => {
          if (line.startsWith("[расход генерации]")) throw new Error("журнал недоступен");
        }),
      );
      await vi.advanceTimersByTimeAsync(3 * 3_600_000);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(written).toHaveLength(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("ход прошёл до конца с числами провайдера — у провайдера ничего не спрашивают, запись одна", async () => {
    const { storage, written } = await recordingStorage();
    const model = numberedModel([[streamStart, ...textParts(["Готово."]), finishPart()]]);
    const { catalog, lookups } = catalogWithLookup({ mock: model }, new Map());

    await onFakeClock(() => readAll(startTurn(storage, model, { catalog, ownerId: "anna" })));
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(written).toHaveLength(1);
    expect(written[0]!.estimated).toBeFalsy();
    expect(lookups).toEqual([]);
  });

  it("основной молчал до первого куска, ответил запасной: у каждого своя запись по своей цене; основной — оценка входа", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { storage, written } = await recordingStorage();
    const primary = numberedModel(["silent"]);
    const backup = numberedModel([[streamStart, ...textParts(["Ответ запасного"]), finishPart()]]);
    const { catalog } = catalogWithLookup({ mock: primary, "mock-backup": backup }, new Map());

    await onFakeClock(() => readAll(startTurn(storage, primary, { catalog, providerFallback: {}, ownerId: "anna", logError: () => {} })));

    expect(primary.doStreamCalls.length).toBeGreaterThan(0);
    const byProvider = new Map(written.map((record) => [record.providerId, record]));
    expect([...byProvider.keys()].sort()).toEqual(["mock", "mock-backup"]);
    const main = byProvider.get("mock")!;
    expect(main).toMatchObject({ estimated: true, outputTokens: 0 });
    expect(main.inputTokens).toBeGreaterThan(0);
    expect(main.costUsd).toBeCloseTo(costOfUsage({ ...main, cacheWriteTokens: 0 }, price), 12);
    // 40 без кэша, 60 из кэша, 30 на выходе — по ценам запасного.
    expect(byProvider.get("mock-backup")!.costUsd).toBeCloseTo((40 * 10 + 60 * 1 + 30 * 40) / 1_000_000, 12);
  });
});
