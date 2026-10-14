import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { generateResult, mockCatalog, mockEnv, mockModelId } from "./support/mock-model";

const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 };

function build(answer = "Оценка: 7", limits?: Partial<SpendingLimits>) {
  const model = new MockLanguageModelV4({ doGenerate: async () => generateResult(answer, { input: 100, output: 30 }) });
  const storage = createInMemoryChatStorage();
  const afterSpending = vi.fn(async () => {});
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }, { pricing }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    logError: () => {},
    limits: { assertWithinLimit: async () => {}, status: async () => ({}) as never, afterSpending, ...limits } as SpendingLimits,
  });
  return { service, storage, model, afterSpending };
}

const ask = { ownerId: "anna", chatId: "c1", model: { modelId: mockModelId, providerId: "mock" }, source: "judge" as const };

describe("service.askModel", () => {
  it("один вызов без инструментов: текст, расход в журнале с source, лимиты узнают о расходе", async () => {
    const { service, storage, model, afterSpending } = build();
    const result = await service.askModel({ ...ask, system: "Ты судья.", prompt: "Оцени ответ" });

    expect(result.text).toBe("Оценка: 7");
    expect(result.object).toBeUndefined();
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(30);
    expect(result.usage.costUsd).toBeGreaterThan(0);
    const call = model.doGenerateCalls[0]!;
    expect(JSON.stringify(call.prompt)).toContain("Ты судья.");
    expect(JSON.stringify(call.prompt)).toContain("Оцени ответ");
    expect(call.tools ?? []).toEqual([]);

    const [sum] = await storage.sumUsage({ chatId: "c1", source: "judge" });
    expect(sum).toMatchObject({ modelId: mockModelId, providerId: "mock", inputTokens: 100, outputTokens: 30 });
    expect(sum!.costUsd).toBeCloseTo(result.usage.costUsd, 10);
    expect(afterSpending).toHaveBeenCalledWith({ userId: "anna", chatId: "c1" });
  });

  it("со схемой: ответ JSON разобран в object", async () => {
    const { service, model } = build('{"score":7,"reason":"по делу"}');
    const result = await service.askModel({ ...ask, prompt: "Оцени", schema: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score"] } });
    expect(result.object).toEqual({ score: 7, reason: "по делу" });
    expect(model.doGenerateCalls[0]!.responseFormat).toMatchObject({ type: "json" });
    // Без system — без пустой инструкции: часть провайдеров её не принимает.
    expect(model.doGenerateCalls[0]!.prompt.map((message) => message.role)).toEqual(["user"]);
  });

  it("лимит исчерпан — модель не вызывается, ошибка лимита", async () => {
    const { service, model } = build("x", {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
    });
    await expect(service.askModel({ ...ask, prompt: "Оцени" })).rejects.toBeInstanceOf(SpendingLimitReachedError);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("service.recordUsage", () => {
  it("расход внешнего вызова — в журнал с ценой сервиса и в лимиты", async () => {
    const { service, storage, afterSpending } = build();
    await service.recordUsage({ ownerId: "anna", chatId: "c1", source: "judge", cost: 0.012, inputTokens: 500, outputTokens: 40, modelId: "judge-x" });
    expect(await storage.sumUsage({ chatId: "c1", source: "judge" })).toEqual([
      expect.objectContaining({ modelId: "judge-x", providerId: "external", inputTokens: 500, outputTokens: 40, costUsd: 0.012 }),
    ]);
    expect(afterSpending).toHaveBeenCalledWith({ userId: "anna", chatId: "c1" });
  });

  it("свой провайдер и сообщение; нулевой расход не пишется", async () => {
    const { service, storage } = build();
    await service.recordUsage({ ownerId: "anna", chatId: "c1", source: "judge", cost: 0.5, inputTokens: 1, outputTokens: 1, modelId: "m", providerId: "judge-api", messageId: "a1" });
    await service.recordUsage({ ownerId: "anna", chatId: "c1", source: "judge", cost: 0, inputTokens: 0, outputTokens: 0, modelId: "m" });
    expect(await storage.sumUsage({ chatId: "c1", messageId: "a1" })).toEqual([expect.objectContaining({ providerId: "judge-api", costUsd: 0.5 })]);
    expect(await storage.sumUsage({ chatId: "c1" })).toHaveLength(1);
  });
});
