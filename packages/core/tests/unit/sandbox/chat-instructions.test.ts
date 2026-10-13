import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MessageAttachments } from "../../../src/attachments/message-attachments";
import { createChatService } from "../../../src/chat-service";
import type { ChatServiceOptions } from "../../../src/chat-service";
import type { Chat } from "../../../src/conversation/types";
import type { LongTermMemory } from "../../../src/memory/long-term-memory";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { diagramsInstructions } from "../../../src/widgets/diagrams-instructions";
import { generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";

const attachments: MessageAttachments = {
  instructions: "Вложения: читай файлы.",
  acceptUserParts: async () => [],
  confirmUserParts: async () => {},
  prepareHistory: async ({ history }) => [...history],
};

const memory: LongTermMemory = {
  instructions: "Память: записи — данные.",
  tools: () => ({ manage_memory: tool({ description: "Память", inputSchema: z.object({ action: z.string() }), execute: async () => "ок" }) }),
  toolNames: ["manage_memory"],
  snapshot: async () => null,
};

const blocks = `\n${attachments.instructions}\n${diagramsInstructions}\n${memory.instructions}`;

function setup(extra: Partial<ChatServiceOptions>) {
  let answers = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf([streamStart, ...textParts([`ответ ${++answers}`]), {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: answers * 150, noCache: answers * 150, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
    }]) }),
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", diagrams: true },
    attachments,
    memory,
    compaction: { thresholdTokens: 10_000, tailTokens: 50, summaryCeilingTokens: 100 },
    env: mockEnv,
    logError: () => {},
    ...extra,
  });
  return { model, service };
}

const systemOf = (call: { prompt: ReadonlyArray<{ role: string; content: unknown }> }) => call.prompt[0];
const ask = async (service: ReturnType<typeof setup>["service"], chatId: string, id: string) =>
  readAll(await service.sendMessage("anna", chatId, { id, role: "user", parts: [{ type: "text", text: "привет" }] }));

describe("chatInstructions: инструкция на чат (T012)", () => {
  it("своя инструкция чата — со всеми служебными блоками; функция получает чат", async () => {
    const chatInstructions = vi.fn(async (chat: Chat) => `Песочная инструкция для ${chat.ownerId}.`);
    const { model, service } = setup({ chatInstructions });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1");
    expect(systemOf(model.doStreamCalls[0]!)).toEqual({ role: "system", content: `Песочная инструкция для anna.${blocks}` });
    expect(chatInstructions).toHaveBeenCalledWith(expect.objectContaining({ id: chat.id, ownerId: "anna" }));
  });

  it("null — инструкция приложения, та же, что без chatInstructions", async () => {
    const plain = setup({});
    const sandboxed = setup({ chatInstructions: async () => null });
    await ask(plain.service, (await plain.service.createChat("anna")).id, "u1");
    await ask(sandboxed.service, (await sandboxed.service.createChat("anna")).id, "u1");
    expect(systemOf(sandboxed.model.doStreamCalls[0]!)).toEqual({ role: "system", content: `Ты помощник.${blocks}` });
    expect(systemOf(sandboxed.model.doStreamCalls[0]!)).toEqual(systemOf(plain.model.doStreamCalls[0]!));
  });

  it("инструкция меняется между ходами — следующий ход уже с новой", async () => {
    let text = "Первая.";
    const { model, service } = setup({ chatInstructions: async () => text });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1");
    text = "Вторая.";
    await ask(service, chat.id, "u2");
    expect(model.doStreamCalls.map((call) => (systemOf(call) as { content: string }).content)).toEqual([`Первая.${blocks}`, `Вторая.${blocks}`]);
  });

  it("сжатие идёт с инструкцией чата: префикс запроса тот же, что у ответа", async () => {
    const { model, service } = setup({ chatInstructions: async () => "Песочная." });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1");
    await ask(service, chat.id, "u2");
    await service.flush();
    expect(await service.compactNow("anna", chat.id)).toBe("compacted");
    expect(systemOf(model.doGenerateCalls.at(-1)!)).toEqual({ role: "system", content: `Песочная.${blocks}` });
  });
});
