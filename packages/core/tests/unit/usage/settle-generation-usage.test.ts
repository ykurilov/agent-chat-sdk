import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenUsage, UsageRecord } from "../../../src/conversation/types";
import type { GenerationUsage, ModelCatalog } from "../../../src/models/model-catalog";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { GENERATION_LOOKUP_TIMEOUT_MS, settleGenerationUsage } from "../../../src/usage/settle-generation-usage";
import { mockCatalog, mockEnv, mockModelId } from "../support/mock-model";

const price = { inputPerMillion: 1, outputPerMillion: 4, cachedInputPerMillion: 0.1 };
const estimate: TokenUsage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 200, reasoningTokens: 0 };
const actual: TokenUsage = { inputTokens: 1_100, cachedInputTokens: 300, outputTokens: 150, reasoningTokens: 20 };
const zeros: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

/** Сверка одного оборванного шага с генерацией `gen-1`; `lookup` — ответы провайдера по очереди. */
function settlement(lookup: GenerationUsage["lookup"]) {
  const written: UsageRecord[] = [];
  const logged: string[] = [];
  const storage = createInMemoryChatStorage();
  const recording: ChatStorage = { ...storage, insertUsageRecord: async (record) => void written.push(record) };
  const catalog: ModelCatalog = mockCatalog({ mock: new MockLanguageModelV4() }, { pricing: price });
  catalog.providers = catalog.providers.map((provider) =>
    provider.id === "mock" ? { ...provider, generationUsage: { generationId: () => undefined, lookup } } : provider,
  );
  const done = settleGenerationUsage({
    storage: recording,
    catalog,
    env: mockEnv,
    ownerId: "anna",
    chatId: "chat-1",
    messageId: "a1",
    modelId: mockModelId,
    startedAt: "2026-10-02T10:00:00.000Z",
    steps: [{ providerId: "mock", estimate, generationIds: ["gen-1"] }],
    logError: (line) => void logged.push(line),
  });
  return { done, written, logged };
}

describe("settleGenerationUsage: что считать «узнал» (FR-058)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("нули при ненулевой оценке — «ещё не знаю»: спрашивает дальше и берёт настоящие числа", async () => {
    const answers = [zeros, actual];
    const { done, written } = settlement(async () => answers.shift() ?? null);

    await vi.runAllTimersAsync();
    await done;

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ source: "answer_correction", inputTokens: 100, outputTokens: -50, cachedInputTokens: 300 });
  });

  it("провайдер отдаёт только нули — оценка остаётся, поправки нет, в журнале строка", async () => {
    const { done, written, logged } = settlement(async () => zeros);

    await vi.runAllTimersAsync();
    await done;

    expect(written).toEqual([]);
    expect(logged.join("\n")).toContain("остаётся оценка");
  });

  it("вопрос, на который провайдер не отвечает, бросается через 15 с; следующий вопрос получает ответ", async () => {
    const signals: AbortSignal[] = [];
    let asked = 0;
    const { done, written, logged } = settlement(({ signal }) => {
      signals.push(signal!);
      asked += 1;
      // Первый вопрос висит и отмену не слушает.
      return asked === 1 ? new Promise<TokenUsage | null>(() => {}) : Promise.resolve(actual);
    });

    await vi.runAllTimersAsync();
    await done;

    expect(GENERATION_LOOKUP_TIMEOUT_MS).toBe(15_000);
    expect(signals[0]!.aborted).toBe(true);
    expect(written).toHaveLength(1);
    expect(logged).toEqual([]);
  });
});
