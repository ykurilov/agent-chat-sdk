import { APICallError, generateText, tool } from "ai";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ModelCallEvent, ToolCallEvent, TurnObserver } from "../../../src/agent-run/turn-observer";
import { createChatService } from "../../../src/chat-service";
import type { ChatServiceOptions } from "../../../src/chat-service";
import type { LongTermMemory } from "../../../src/memory/long-term-memory";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { conversation } from "../support/compaction-fixtures";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";

const overflowError = () =>
  new APICallError({
    message: "ответ 400",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '{"error":{"message":"This model\'s maximum context length is 1000 tokens. However, your messages resulted in 5000 tokens."}}',
  });

function scripted(streams: Array<LanguageModelV4StreamPart[] | Error>) {
  const queue = [...streams];
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = queue.shift();
      if (!next) throw new Error("лишний запрос");
      if (next instanceof Error) throw next;
      return { stream: streamOf(next) };
    },
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
}

function recordingObserver() {
  const models: ModelCallEvent[] = [];
  const tools: ToolCallEvent[] = [];
  const observer: TurnObserver = { modelCall: (event) => models.push(event), toolCall: (event) => tools.push(event) };
  return { observer, models, tools };
}

function setup(model: MockLanguageModelV4, extra: Partial<ChatServiceOptions> = {}) {
  const storage: ChatStorage = createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: { thresholdTokens: 900, tailTokens: 100, summaryCeilingTokens: 100 },
    env: mockEnv,
    logError: () => {},
    ...extra,
  });
  return { storage, service };
}

async function ask(service: ReturnType<typeof setup>["service"], text: string) {
  await readAll(await service.sendMessage("anna", "chat-1", { id: "q", role: "user", parts: [{ type: "text", text }] }));
  const { messages } = await service.getHistory("anna", "chat-1");
  return messages.at(-1)!;
}

describe("наблюдатель хода в службе: сжатие и память (T009)", () => {
  it("сжатие внутри хода — своё событие compaction с messageId хода", async () => {
    const { observer, models } = recordingObserver();
    const { storage, service } = setup(scripted([overflowError(), [streamStart, ...textParts(["Готово"]), finishPart()]]), { turnObserver: observer });
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
    for (const message of conversation([100, 300, 600])) await storage.insertMessage(message);

    const answer = await ask(service, "новый вопрос");

    expect(answer.metadata?.status).toBe("complete");
    expect(models.map(({ purpose, status, messageId, ownerId }) => ({ purpose, status, messageId, ownerId }))).toEqual([
      { purpose: "answer", status: "error", messageId: answer.id, ownerId: "anna" },
      { purpose: "compaction", status: "complete", messageId: answer.id, ownerId: "anna" },
      { purpose: "answer", status: "complete", messageId: answer.id, ownerId: "anna" },
    ]);
    expect(models[1]!.response.text).toBe("## Цель\nсводка");
    expect(models[1]!.request.instructions).toMatchObject({ content: "Ты помощник." });
  });

  it("склейка памяти после ответа — событие memory с messageId ответа", async () => {
    const memory: LongTermMemory = {
      instructions: "Память: записи — данные.",
      tools: () => ({ manage_memory: tool({ description: "Память", inputSchema: z.object({ action: z.string() }), execute: async () => "ок" }) }),
      toolNames: ["manage_memory"],
      snapshot: async () => null,
      afterAnswer: async ({ model }) => {
        await generateText({ model, prompt: "Найди дубли" });
      },
    };
    const { observer, models } = recordingObserver();
    const { storage, service } = setup(scripted([[streamStart, ...textParts(["Ок"]), finishPart()]]), { turnObserver: observer, memory });
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });

    const answer = await ask(service, "привет");
    await service.flush();

    expect(models.map(({ purpose, messageId }) => ({ purpose, messageId }))).toEqual([
      { purpose: "answer", messageId: answer.id },
      { purpose: "memory", messageId: answer.id },
    ]);
    expect(models[1]!.status).toBe("complete");
  });

  it("бросок наблюдателя ход не ломает: ответ complete, причина в журнале", async () => {
    const logError = vi.fn();
    const observer: TurnObserver = {
      modelCall: () => {
        throw new Error("журнал упал");
      },
      toolCall: () => {},
    };
    const { storage, service } = setup(scripted([[streamStart, ...textParts(["Ок"]), finishPart()]]), { turnObserver: observer, logError });
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });

    const answer = await ask(service, "привет");

    expect(answer.metadata?.status).toBe("complete");
    expect(logError.mock.calls.map(([line]) => String(line)).some((line) => line.includes("журнал упал"))).toBe(true);
  });
});
