import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { AnswerStatus, StoredMessage, UsageRecord } from "../../src/conversation/types";
import type { ModelPrice } from "../../src/models/model-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "./support/mock-model";

function answer(id: string, chatId: string, status: AnswerStatus, text: string): StoredMessage {
  return newStoredMessage({
    id,
    chatId,
    role: "assistant",
    parts: [{ type: "text", text, state: status === "streaming" ? "streaming" : "done" }],
    status,
    modelId: mockModelId,
    providerId: "mock",
    reasoningDurationsMs: { "0": 1200 },
    // Ответ прошлого запуска: знаков жизни давно нет (FR-060).
    createdAt: "2026-03-01T10:00:00.000Z",
  });
}

async function setup(pricing?: Partial<Record<"mock" | "mock-backup", ModelPrice>>) {
  const memory = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const storage = {
    ...memory,
    insertUsageRecord: async (record: UsageRecord) => {
      written.push(record);
      await memory.insertUsageRecord(record);
    },
  };
  for (const chatId of ["c1", "c2"]) {
    await storage.createChat({ id: chatId, ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  }
  const catalog = mockCatalog({ mock: mockModel(() => streamOf(reasoningAndTextParts(["Ответ"]))) });
  if (pricing) catalog.models.find((model) => model.id === mockModelId)!.pricing = pricing;
  const service = createChatService({
    storage,
    catalog,
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
  });
  return { storage, service, written };
}

describe("служба чата: восстановление после перезапуска", () => {
  it("recoverInterruptedAnswers переводит все streaming в interrupted и возвращает их число", async () => {
    const { storage, service } = await setup();
    await storage.insertMessage(answer("a1", "c1", "streaming", "Начало первого"));
    await storage.insertMessage(answer("a2", "c2", "streaming", "Начало второго"));

    expect(await service.recoverInterruptedAnswers()).toBe(2);
    expect(await storage.listStreamingMessageIds()).toEqual([]);
    const [first] = await storage.listMessages("c1");
    const [second] = await storage.listMessages("c2");
    expect(first?.status).toBe("interrupted");
    expect(second?.status).toBe("interrupted");
  });

  it("написанные части, длительности рассуждений и модель не трогает", async () => {
    const { storage, service } = await setup();
    const before = answer("a1", "c1", "streaming", "Написанная часть");
    await storage.insertMessage(before);

    await service.recoverInterruptedAnswers();
    const [after] = await storage.listMessages("c1");
    expect(after).toEqual({ ...before, status: "interrupted" });
  });

  it("для уже законченных ответов ничего не делает", async () => {
    const { storage, service } = await setup();
    const finished = [
      answer("a1", "c1", "complete", "Готово"),
      answer("a2", "c1", "stopped", "Остановлен"),
      answer("a3", "c1", "error", "Ошибка"),
      answer("a4", "c1", "interrupted", "Уже прерван"),
    ];
    for (const message of finished) await storage.insertMessage(message);

    expect(await service.recoverInterruptedAnswers()).toBe(0);
    expect(await storage.listMessages("c1")).toEqual(finished);
  });

  it("расход, записанный в идущий ответ, уходит в журнал расхода с пометкой «примерно» (FR-052)", async () => {
    const { storage, service, written } = await setup();
    const usage = { inputTokens: 500, cachedInputTokens: 200, outputTokens: 50, reasoningTokens: 10, estimated: true as const };
    await storage.insertMessage({ ...answer("a1", "c1", "streaming", "Начало"), providerId: "mock-backup", usage, createdAt: "2026-03-01T10:00:00.000Z" });

    await service.recoverInterruptedAnswers();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      ownerId: "anna",
      chatId: "c1",
      messageId: "a1",
      source: "answer",
      modelId: mockModelId,
      providerId: "mock-backup",
      inputTokens: 500,
      cachedInputTokens: 200,
      outputTokens: 50,
      reasoningTokens: 10,
      estimated: true,
      createdAt: "2026-03-01T10:00:00.000Z",
    });
    expect((await storage.getMessage("a1"))?.status).toBe("interrupted");
  });

  it("шаги хода в идущем ответе: каждому провайдеру своя запись, ступень цены — по входу каждого шага", async () => {
    const tiered = { inputPerMillion: 1, outputPerMillion: 2, tiers: [{ inputTokensAbove: 200_000, inputPerMillion: 3, outputPerMillion: 6 }] };
    const { storage, service, written } = await setup({ mock: tiered, "mock-backup": { inputPerMillion: 10, outputPerMillion: 20 } });
    const step = (providerId: string, inputTokens: number) => ({ providerId, inputTokens, cachedInputTokens: 0, outputTokens: 100, reasoningTokens: 0 });
    const pendingSteps = [step("mock", 150_000), step("mock", 150_000), step("mock-backup", 1_000)];
    const usage = { inputTokens: 301_000, cachedInputTokens: 0, outputTokens: 300, reasoningTokens: 0, pendingSteps };
    await storage.insertMessage({ ...answer("a1", "c1", "streaming", "Начало"), providerId: "mock-backup", usage });

    await service.recoverInterruptedAnswers();

    expect(written.map((record) => [record.providerId, record.inputTokens, record.outputTokens])).toEqual([
      ["mock", 300_000, 200],
      ["mock-backup", 1_000, 100],
    ]);
    // Каждый шаг основного ниже ступени: 2 × (150 000 × 1 + 100 × 2), а не 300 000 × 3 по сумме.
    expect(written[0]!.costUsd).toBeCloseTo((2 * (150_000 * 1 + 100 * 2)) / 1_000_000, 12);
    expect(written[1]!.costUsd).toBeCloseTo((1_000 * 10 + 100 * 20) / 1_000_000, 12);
  });

  it("ответ без расхода в журнал ничего не пишет", async () => {
    const { storage, service, written } = await setup();
    await storage.insertMessage(answer("a1", "c1", "streaming", "Начало"));
    await service.recoverInterruptedAnswers();
    expect(written).toEqual([]);
  });

  /** Расход ответа «a1» до паузы на подтверждение: уже в журнале, как его пишет ход при паузе. */
  async function journaledBeforePause(storage: Awaited<ReturnType<typeof setup>>["storage"]) {
    const before = { inputTokens: 500, cachedInputTokens: 200, outputTokens: 50, reasoningTokens: 10 };
    await storage.insertUsageRecord({
      id: "before-pause",
      ownerId: "anna",
      chatId: "c1",
      messageId: "a1",
      source: "answer",
      modelId: mockModelId,
      providerId: "mock",
      ...before,
      cacheWriteTokens: 0,
      costUsd: 0,
      createdAt: "2026-03-01T10:00:00.000Z",
    });
    return before;
  }

  it("сбой сразу после «Разрешить», до первой записи хода: расход до паузы второй раз не пишется", async () => {
    const { storage, service, written } = await setup();
    const before = await journaledBeforePause(storage);
    // Так ответ лежит после «Разрешить»: статус уже streaming, в сообщении — расход до паузы.
    await storage.insertMessage({ ...answer("a1", "c1", "streaming", "Начало"), usage: before });

    await service.recoverInterruptedAnswers();

    expect(written.map((record) => record.id)).toEqual(["before-pause"]);
    expect((await storage.getMessage("a1"))?.usage).toMatchObject(before);
  });

  it("сбой посреди продолжения: в журнал — только расход после паузы, в сообщении — весь расход (FR-052)", async () => {
    const { storage, service, written } = await setup();
    await journaledBeforePause(storage);
    const whole = { inputTokens: 500 + 900, cachedInputTokens: 200 + 400, outputTokens: 50 + 30, reasoningTokens: 10 + 5, estimated: true as const };
    await storage.insertMessage({ ...answer("a1", "c1", "streaming", "Начало"), usage: whole });

    await service.recoverInterruptedAnswers();

    expect(written).toHaveLength(2);
    expect(written[1]).toMatchObject({ messageId: "a1", inputTokens: 900, cachedInputTokens: 400, outputTokens: 30, reasoningTokens: 5, estimated: true });
    expect((await storage.getMessage("a1"))?.usage).toEqual(whole);
  });
});


it("брошенный ответ восстанавливается без забытого startup-вызова, здоровое ожидание подтверждения сохраняется", async () => {
  vi.useFakeTimers();
  const { storage, service } = await setup();
  try {
    await storage.insertMessage(answer("orphan", "c1", "streaming", "Успело сохраниться"));
    await storage.insertMessage(answer("approval", "c2", "awaiting_approval", "Ждёт человека"));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await storage.getMessage("orphan"))?.status).toBe("interrupted");
    expect((await storage.getMessage("approval"))?.status).toBe("awaiting_approval");
    await service.flush();
    const scans = vi.spyOn(storage, "listSilentAnswerIds");
    await vi.advanceTimersByTimeAsync(20000);
    expect(scans).not.toHaveBeenCalled();
  } finally { await service.flush(); vi.useRealTimers(); }
});
