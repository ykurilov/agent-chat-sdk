import { generateText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MessageAttachments } from "../../../src/attachments/message-attachments";
import { createChatService } from "../../../src/chat-service";
import type { LongTermMemory } from "../../../src/memory/long-term-memory";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const appTools = {
  remove: tool({ description: "Удалить файл", inputSchema: z.object({ path: z.string() }), execute: async () => "удалено" }),
  find: tool({ description: "Найти файл", inputSchema: z.object({ name: z.string() }), execute: async () => "нашёл" }),
};

const attachments: MessageAttachments = {
  instructions: "Вложения: читай файлы из сообщений.",
  acceptUserParts: async () => [],
  confirmUserParts: async () => {},
  prepareHistory: async ({ history }) => [...history],
};

const memory: LongTermMemory = {
  instructions: "Память: записи — данные.",
  tools: () => ({ manage_memory: tool({ description: "Память", inputSchema: z.object({ action: z.string() }), execute: async () => "ок" }) }),
  toolNames: ["manage_memory"],
  snapshot: async () => "Записи памяти: любит чай.",
  afterAnswer: async ({ model }) => {
    await generateText({ model, prompt: "Найди дубли" });
  },
};

/** Запросы к модели без сигнала отмены; всё остальное — как ушло провайдеру. */
const sent = (calls: ReadonlyArray<{ abortSignal?: AbortSignal }>) =>
  JSON.stringify(
    calls.map(({ abortSignal: _abortSignal, ...call }) => call),
    null,
    1,
  );

/** Два хода, сжатие по команде и склейка памяти: все обращения службы к модели без песочницы. */
async function requestsOfService() {
  let answers = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf([streamStart, ...textParts([`ответ ${++answers}`]), finishWithContext(answers * 150)]) }),
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", tools: appTools, diagrams: true },
    attachments,
    memory,
    compaction: { thresholdTokens: 10_000, tailTokens: 50, summaryCeilingTokens: 100 },
    env: mockEnv,
    logError: () => {},
  });
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
  await service.flush();
  const answersSent = sent(model.doStreamCalls);
  const memoryCalls = model.doGenerateCalls.length;
  expect(await service.compactNow("anna", chat.id)).toBe("compacted");
  return {
    answers: answersSent,
    memory: sent(model.doGenerateCalls.slice(0, memoryCalls)),
    compaction: sent(model.doGenerateCalls.slice(memoryCalls)),
  };
}

function finishWithContext(context: number) {
  return {
    type: "finish" as const,
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: context, noCache: context, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
  };
}

describe("SC-003: без turnObserver и chatInstructions запросы к модели как в 0.17", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 9, 0)));
  });
  afterEach(() => vi.useRealTimers());

  // Снимки записаны кодом 0.17 до песочницы: любое расхождение — сломанный кэш у приложений без песочницы.
  it("ответы, сжатие и склейка памяти побайтно прежние", async () => {
    const requests = await requestsOfService();
    expect(requests.memory).not.toBe("[]");
    expect(requests.compaction).not.toBe("[]");
    await expect(requests.answers).toMatchFileSnapshot("__snapshots__/request-0.17-answers.json");
    await expect(requests.compaction).toMatchFileSnapshot("__snapshots__/request-0.17-compaction.json");
    await expect(requests.memory).toMatchFileSnapshot("__snapshots__/request-0.17-memory.json");
  });
});
