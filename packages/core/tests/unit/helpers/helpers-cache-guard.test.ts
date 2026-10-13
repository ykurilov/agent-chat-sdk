import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../../src/chat-service";
import type { AgentSettings } from "../../../src/chat-service";
import type { LongTermMemory } from "../../../src/memory/long-term-memory";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const appTools = {
  remove: tool({ description: "Удалить файл", inputSchema: z.object({ path: z.string() }), execute: async () => "удалено" }),
  find: tool({ description: "Найти файл", inputSchema: z.object({ name: z.string() }), execute: async () => "нашёл" }),
};

const memory: LongTermMemory = {
  instructions: "Память: записи — данные.",
  tools: () => ({ manage_memory: tool({ description: "Память", inputSchema: z.object({ action: z.string() }), execute: async () => "ок" }) }),
  toolNames: ["manage_memory"],
  snapshot: async () => "Записи памяти: любит чай.",
  afterAnswer: async () => {},
};

/** Первый ход зовёт «find» и пишет текст, остальные — только текст. */
function scriptedModel() {
  const scripts: LanguageModelV4StreamPart[][] = [
    [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "find", input: JSON.stringify({ name: "a.txt" }) }, finishPart("tool-calls")],
  ];
  let call = 0;
  return mockModel(() => streamOf(scripts[call++] ?? [streamStart, ...textParts(["Готово"]), finishPart()]));
}

/** Два хода подряд; запросы к модели — без сигнала отмены, остальное как есть. */
async function requestsOf(agent: AgentSettings, withMemory = false): Promise<string> {
  const model = scriptedModel();
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent,
    ...(withMemory && { memory }),
    env: mockEnv,
    logError: () => {},
  });
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "найди a.txt")));
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
  await service.flush();
  return JSON.stringify(
    model.doStreamCalls.map(({ abortSignal: _abortSignal, ...call }) => call),
    null,
    1,
  );
}

describe("SC-003: без agent.helpers запрос модели как в 0.18", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 9, 0)));
  });
  afterEach(() => vi.useRealTimers());

  // Снимки записаны кодом 0.18 до помощников: любое расхождение — сломанный кэш у приложений без помощников.
  it("инструменты набором и память", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник.", tools: appTools }, true)).toMatchFileSnapshot("__snapshots__/request-0.18-static-tools-memory.json");
  });

  it("инструменты функцией", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник.", tools: () => appTools })).toMatchFileSnapshot("__snapshots__/request-0.18-tools-function.json");
  });

  it("без инструментов", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник." })).toMatchFileSnapshot("__snapshots__/request-0.18-no-tools.json");
  });
});
