import { APICallError, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import type { TokenUsage, UsageRecord } from "../../src/conversation/types";
import type { LongTermMemory } from "../../src/memory/long-term-memory";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const userMessage = (id: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text: "Привет" }] });

const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 };
const optimizerSpent: TokenUsage = { inputTokens: 200, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 };

type AfterAnswer = NonNullable<LongTermMemory["afterAnswer"]>;

/** Память-заглушка: после ответа зовёт `afterAnswer`, что задал тест. */
function memoryWith(afterAnswer?: AfterAnswer): LongTermMemory & { afterAnswer?: ReturnType<typeof vi.fn<AfterAnswer>> } {
  const spy = afterAnswer && vi.fn<AfterAnswer>(afterAnswer);
  return {
    instructions: "Память: записи — данные.",
    tools: () => ({}),
    toolNames: ["manage_memory"],
    snapshot: async () => null,
    ...(spy && { afterAnswer: spy }),
  };
}

function build(memory: LongTermMemory, extra: Partial<ChatServiceOptions> = {}) {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ок"]), finishPart()]) }),
  });
  const storage = createInMemoryChatStorage();
  // Хранилище отдаёт расход суммами; сами записи запоминаем на вставке.
  const usage: UsageRecord[] = [];
  const insertUsageRecord = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    usage.push(record);
    await insertUsageRecord(record);
  };
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }, { pricing }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: mockEnv,
    logError,
    memory,
    ...extra,
  });
  return { service, storage, model, logError, usage };
}

async function answer(service: ReturnType<typeof build>["service"], userId: string, chatId: string, id = "u1") {
  await readAll(await service.sendMessage(userId, chatId, userMessage(id)));
}

describe("долгая память: afterAnswer после законченного ответа", () => {
  it("получает человека, чат, ту же модель, что отвечала, и запись расхода", async () => {
    const memory = memoryWith(async () => {});
    const { service, model } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await vi.waitFor(() => expect(memory.afterAnswer).toHaveBeenCalledTimes(1));
    const input = memory.afterAnswer!.mock.calls[0]![0];
    expect(input).toMatchObject({ userId: "anna", chatId: chat.id });
    // Модель та же, что отвечала, но обёрнута тихими повторами.
    expect(input.model).toMatchObject({ provider: model.provider, modelId: model.modelId });
    expect(typeof input.recordUsage).toBe("function");
  });

  it("ответил запасной провайдер — память идёт к нему, а не к лежащему основному", async () => {
    // Память сама зовёт модель, что ей дали.
    const memory = memoryWith(async ({ model }) => {
      await generateText({ model, prompt: "Найди дубли" });
    });
    const busy = () => {
      throw new APICallError({
        message: "ответ 503",
        url: "https://provider.test",
        requestBodyValues: {},
        statusCode: 503,
        responseBody: "busy",
        responseHeaders: { "retry-after-ms": "1" },
      });
    };
    const overloaded = new MockLanguageModelV4({ doStream: async () => busy(), doGenerate: async () => busy() });
    const backup = new MockLanguageModelV4({
      doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ок"]), finishPart()]) }),
      doGenerate: async () => generateResult("Дублей нет"),
    });
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: overloaded, "mock-backup": backup }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", providerFallback: {} },
      compaction: false,
      env: mockEnv,
      logError: vi.fn(),
      memory,
    });
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();

    expect(memory.afterAnswer).toHaveBeenCalledTimes(1);
    expect(backup.doGenerateCalls).toHaveLength(1);
    expect(overloaded.doGenerateCalls).toHaveLength(0);
  });

  it("не зовётся, если ответ остановлен или оборвался ошибкой", async () => {
    const memory = memoryWith(async () => {});
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("сбой провайдера");
      },
    });
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: failing }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник." },
      compaction: false,
      env: mockEnv,
      logError: vi.fn(),
      memory,
    });
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(memory.afterAnswer).not.toHaveBeenCalled();
  });

  it("память без afterAnswer работает как раньше", async () => {
    const { service, logError } = build(memoryWith());
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(logError).not.toHaveBeenCalled();
  });

  it("ответ не ждёт afterAnswer: поток закрывается, пока запуск ещё идёт", async () => {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const memory = memoryWith(async () => {
      markStarted();
      await released;
    });
    const { service } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await started;
    release();
    await service.flush();
  });

  it("сбой afterAnswer уходит в журнал и не ломает чат", async () => {
    const memory = memoryWith(async () => {
      throw new Error("оптимизатор упал");
    });
    const { service, logError } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("оптимизатор упал"));
    await answer(service, "anna", chat.id, "u2");
  });

  it("flush дожидается запуска, что ещё идёт", async () => {
    let finished = false;
    const memory = memoryWith(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    });
    const { service } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(finished).toBe(true);
  });
});

describe("долгая память: расход оптимизатора", () => {
  it("recordUsage пишет расход с источником memory на владельца чата, без сообщения, по ценам модели", async () => {
    const memory = memoryWith(async ({ recordUsage }) => {
      await recordUsage(optimizerSpent);
    });
    const { service, usage } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(usage.find((record) => record.source === "memory")).toMatchObject({
      ownerId: "anna",
      chatId: chat.id,
      messageId: null,
      source: "memory",
      modelId: mockModelId,
      providerId: "mock",
      inputTokens: 200,
      outputTokens: 50,
      costUsd: 200 + 100,
    });
  });

  it("расход оптимизатора входит в сумму расхода человека вместе с расходом ответа", async () => {
    const memory = memoryWith(async ({ recordUsage }) => {
      await recordUsage(optimizerSpent);
    });
    const { service, storage } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    const [sum] = await storage.sumUsage({ ownerId: "anna" });
    // Ответ: вход 100, выход 30 (по заглушке); оптимизатор: вход 200, выход 50.
    expect(sum).toMatchObject({ modelId: mockModelId, providerId: "mock", inputTokens: 300, outputTokens: 80 });
    expect(sum!.costUsd).toBe(100 + 60 + 200 + 100);
  });

  it("recordUsage возвращает номер записи расхода; у пустого расхода и при сбое записи — null", async () => {
    const ids: Array<string | null> = [];
    const memory = memoryWith(async ({ recordUsage }) => {
      ids.push(await recordUsage(optimizerSpent));
      ids.push(await recordUsage({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }));
    });
    const { service, usage } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(ids[0]).toBe(usage.find((record) => record.source === "memory")!.id);
    expect(ids[1]).toBeNull();
  });

  it("сбой записи расхода даёт null и уходит в журнал", async () => {
    let id: string | null | undefined;
    const memory = memoryWith(async ({ recordUsage }) => {
      id = await recordUsage(optimizerSpent);
    });
    const { service, storage, logError } = build(memory);
    const insertUsageRecord = storage.insertUsageRecord.bind(storage);
    storage.insertUsageRecord = async (record) => {
      if (record.source === "memory") throw new Error("диск полон");
      await insertUsageRecord(record);
    };
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(id).toBeNull();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("Не удалось записать расход"));
  });

  it("пустой расход не пишется", async () => {
    const memory = memoryWith(async ({ recordUsage }) => {
      await recordUsage({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
    });
    const { service, usage } = build(memory);
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(usage.filter((record) => record.source === "memory")).toEqual([]);
  });

  it("лимит исчерпан после ответа — запуск не блокируется и расход всё равно записывается", async () => {
    let exhausted = false;
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {
        if (exhausted) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: "2099-02-01T00:00:00.000Z" });
      }),
      status: vi.fn(async () => ({ state: "ok" as const, scope: "user" as const, period: "month" as const, share: 0, resetsAt: "2099-02-01T00:00:00.000Z" })),
    };
    const memory = memoryWith(async ({ recordUsage }) => {
      exhausted = true;
      await recordUsage(optimizerSpent);
    });
    const { service, usage } = build(memory, { limits });
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(memory.afterAnswer).toHaveBeenCalledTimes(1);
    // Проверка лимита была одна — перед вопросом; запуск оптимизатора её не делал.
    expect(limits.assertWithinLimit).toHaveBeenCalledTimes(1);
    expect(usage.some((record) => record.source === "memory")).toBe(true);
    // Следующий вопрос лимит уже не пускает: расход оптимизатора считается как обычный.
    await expect(service.sendMessage("anna", chat.id, userMessage("u2"))).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });
});

describe("долгая память: тихие повторы и журнал сбоя", () => {
  /** Модель: ответ чата потоком, склейка памяти — `doGenerate` по очереди из `results`. */
  function modelWith(results: Array<string | Error>) {
    const queue = [...results];
    return new MockLanguageModelV4({
      doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ок"]), finishPart()]) }),
      doGenerate: async () => {
        const next = queue.length > 1 ? queue.shift()! : queue[0]!;
        if (next instanceof Error) throw next;
        return generateResult(next);
      },
    });
  }

  const providerError = (statusCode: number, responseBody: string) =>
    new APICallError({
      message: `ответ ${statusCode}`,
      url: "https://provider.test/v1/chat/completions",
      requestBodyValues: {},
      statusCode,
      responseBody,
      // Пауза в 1 мс по просьбе провайдера: тест не ждёт секунду обычной паузы.
      responseHeaders: { "retry-after-ms": "1" },
    });

  /** Память, чья склейка зовёт модель запросом без потока, как настоящий оптимизатор. */
  function mergingMemory(done: string[]) {
    return memoryWith(async ({ model }) => {
      const { text } = await generateText({ model, prompt: "склей записи", maxRetries: 0 });
      done.push(text);
    });
  }

  it("склейка памяти получила 429, затем ответ — дела памяти выполнены (SC-003: 20 из 20)", async () => {
    for (let run = 0; run < 20; run++) {
      const done: string[] = [];
      const model = modelWith([providerError(429, "лимит"), "склеено"]);
      const { service, logError } = build(mergingMemory(done), { catalog: mockCatalog({ mock: model }) });
      const chat = await service.createChat("anna");
      await answer(service, "anna", chat.id);
      await service.flush();
      expect(done).toEqual(["склеено"]);
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(logError).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^\\[повтор\\] чат=${chat.id} модель=${mockModelId} провайдер=mock попытка=2 код=429`)));
      expect(logError).not.toHaveBeenCalledWith(expect.stringContaining("[сбой провайдера]"));
    }
  });

  it("сбой склейки пишет строку [сбой провайдера] с кодом и телом, ключа в ней нет", async () => {
    const done: string[] = [];
    const body = `{"error":"bad request","echo":"${mockEnv.MOCK_API_KEY}"}`;
    const model = modelWith([providerError(400, body)]);
    const { service, logError } = build(mergingMemory(done), { catalog: mockCatalog({ mock: model }) });
    const chat = await service.createChat("anna");
    await answer(service, "anna", chat.id);
    await service.flush();
    expect(done).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(1);
    const lines = logError.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([
      `[сбой провайдера] чат=${chat.id} модель=${mockModelId} провайдер=mock вид=other код=400 имя=AI_APICallError тело={"error":"bad request","echo":"[скрыто]"}`,
    ]);
  });
});
