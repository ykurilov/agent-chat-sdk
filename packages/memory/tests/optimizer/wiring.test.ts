import { createChatService, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage, TokenUsage } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createLongTermMemory, MemoryStorageNotSupportedError } from "../../src/create-long-term-memory";
import { generateReply, input, proposalOf } from "./support";

// Оптимизатор в собранной памяти: когда afterAnswer есть, что делает, как ведёт себя со службой чата.

const optimizerMethods = ["claimMemoryOptimizationRun", "finishMemoryOptimizationRun", "applyMemoryMerge", "revertMemoryMerge", "listMemoryOptimizationRuns", "listMergedMemoryNotes"] as const;

const withoutOptimizer = (): ChatStorage => {
  const storage: ChatStorage = { ...createInMemoryChatStorage() };
  for (const method of optimizerMethods) delete storage[method];
  return storage;
};

describe("память с оптимизатором: подключение", () => {
  it("по умолчанию afterAnswer есть; с optimizer: false — нет", () => {
    expect(createLongTermMemory({ storage: createInMemoryChatStorage() }).afterAnswer).toBeTypeOf("function");
    expect(createLongTermMemory({ storage: createInMemoryChatStorage(), optimizer: false }).afterAnswer).toBeUndefined();
  });

  it("хранилище без методов оптимизации и настройка не задана — память работает, afterAnswer нет", () => {
    expect(createLongTermMemory({ storage: withoutOptimizer() }).afterAnswer).toBeUndefined();
  });

  it("хранилище без методов оптимизации, а оптимизатор просят явно — ошибка со списком недостающих", () => {
    let caught: unknown;
    try {
      createLongTermMemory({ storage: withoutOptimizer(), optimizer: { intervalHours: 24 } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MemoryStorageNotSupportedError);
    expect((caught as MemoryStorageNotSupportedError).missing).toEqual([...optimizerMethods]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("срок в часах %s — ошибка настройки", (hours) => {
    expect(() => createLongTermMemory({ storage: createInMemoryChatStorage(), optimizer: { intervalHours: hours } })).toThrow(RangeError);
  });

  it("оптимизатор не меняет то, что уходит в запрос: инструкция и имена инструментов те же", () => {
    const on = createLongTermMemory({ storage: createInMemoryChatStorage() });
    const off = createLongTermMemory({ storage: createInMemoryChatStorage(), optimizer: false });
    expect(on.instructions).toBe(off.instructions);
    expect(on.toolNames).toEqual(off.toolNames);
  });
});

const duplicates = [input("Пишет код на TypeScript каждый день", ["О себе", "Работа"]), input("Пишет код на TypeScript в компании Acme", ["О себе", "Работа"])];

describe("память с оптимизатором: afterAnswer", () => {
  it("сливает дубли той моделью, что дана, пишет расход и связывает его с запуском", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage });
    const [first, second] = await storage.insertMemoryNotes!("anna", duplicates);
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        generateReply(JSON.stringify(proposalOf({ sourceIds: [first!.id, second!.id], categories: ["О себе", "Работа"], content: "Пишет код на TypeScript каждый день в компании Acme" }))),
    });
    const recorded: TokenUsage[] = [];
    await memory.afterAnswer!({
      userId: "anna",
      chatId: "c1",
      model,
      recordUsage: async (usage) => {
        recorded.push(usage);
        return "usage-42";
      },
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect((await memory.list("anna")).notes.map((note) => note.content)).toEqual(["Пишет код на TypeScript каждый день в компании Acme"]);
    expect(recorded).toHaveLength(1);
    const [run] = await storage.listMemoryOptimizationRuns!("anna");
    expect(run).toMatchObject({ status: "applied", usageRecordId: "usage-42" });
    // Второй ответ в тот же день: запуска нет, модель молчит.
    await memory.afterAnswer!({ userId: "anna", chatId: "c1", model, recordUsage: async () => "usage-43" });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("меньше двух записей — модель не зовётся", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage });
    await storage.insertMemoryNotes!("anna", [duplicates[0]!]);
    const model = new MockLanguageModelV4({ doGenerate: async () => generateReply("{}") });
    await memory.afterAnswer!({ userId: "anna", chatId: "c1", model, recordUsage: vi.fn(async () => null) });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("сбой модели записан в запуск и передан ядру для журнала (исключением)", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage });
    await storage.insertMemoryNotes!("anna", duplicates);
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("провайдер недоступен");
      },
    });
    await expect(memory.afterAnswer!({ userId: "anna", chatId: "c1", model, recordUsage: async () => null })).rejects.toThrow("провайдер недоступен");
    expect((await storage.listMemoryOptimizationRuns!("anna"))[0]).toMatchObject({ status: "failed", error: "model_error" });
  });
});

describe("память с оптимизатором: отказ проверки", () => {
  it("предложение отвергнуто кодом — запуск неудачный, исключения нет (в журнал сервера это не нужно)", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage });
    const [first, second] = await storage.insertMemoryNotes!("anna", duplicates);
    const model = new MockLanguageModelV4({
      doGenerate: async () => generateReply(JSON.stringify(proposalOf({ sourceIds: [first!.id, second!.id], categories: ["О себе"], content: "Пишет код" }))),
    });
    await expect(memory.afterAnswer!({ userId: "anna", chatId: "c1", model, recordUsage: async () => null })).resolves.toBeUndefined();
    expect((await storage.listMemoryOptimizationRuns!("anna"))[0]).toMatchObject({ status: "failed", error: "lost_detail" });
  });
});

describe("память с оптимизатором: через службу чата", () => {
  it("после законченного ответа дубли слиты, расход записан источником memory и назван в запуске", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage });
    const [first, second] = await storage.insertMemoryNotes!("anna", duplicates);
    const merged = "Пишет код на TypeScript каждый день в компании Acme";
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
            for (const part of [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Ок" },
              { type: "text-end", id: "t" },
              { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
            ]) controller.enqueue(part as never);
            controller.close();
          },
        }),
      }),
      doGenerate: async () => generateReply(JSON.stringify(proposalOf({ sourceIds: [first!.id, second!.id], categories: ["О себе", "Работа"], content: merged })), { input: 300, output: 60 }),
    });
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [{ id: "mock", displayName: "mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
      addModels: [
        { id: "mock-model", displayName: "Mock", contextWindowTokens: 100_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { mock: "mock-v1" } },
      ],
    });
    const records: Array<{ id: string; source: string }> = [];
    const insertUsageRecord = storage.insertUsageRecord.bind(storage);
    storage.insertUsageRecord = async (record) => {
      records.push(record);
      await insertUsageRecord(record);
    };
    const service = createChatService({
      storage,
      catalog,
      defaultChoice: { modelId: "mock-model", providerId: "mock" },
      agent: { instructions: "Ты помощник." },
      memory,
      env: { MOCK_API_KEY: "не-настоящий" },
    });
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] });
    for await (const _chunk of stream) void _chunk;
    await service.flush();

    expect((await memory.list("anna")).notes.map((note) => note.content)).toEqual([merged]);
    const memoryRecord = records.find((record) => record.source === "memory");
    expect(memoryRecord).toBeDefined();
    expect((await storage.listMemoryOptimizationRuns!("anna"))[0]).toMatchObject({ status: "applied", usageRecordId: memoryRecord!.id });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
