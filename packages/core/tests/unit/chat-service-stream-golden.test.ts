import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf, streamStart } from "./support/mock-model";

/** Id, которые меняются от запуска к запуску: в эталоне — по порядку появления. */
function withStableIds(serialized: string): string {
  const seen = new Map<string, string>();
  return serialized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    if (!seen.has(id)) seen.set(id, `id-${seen.size + 1}`);
    return seen.get(id)!;
  });
}

describe("поток ответа без afterTurn", () => {
  // Эталон записан на коде до этапа Э2 (ветка ведущего eb82335): без хука итога поток не меняется ни на байт.
  it("рассуждение, вызов инструмента и текст — побайтно как эталон", async () => {
    const scripts: LanguageModelV4StreamPart[][] = [
      [streamStart, { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: JSON.stringify({ topic: "дроби" }) }, finishPart("tool-calls")],
      [streamStart, ...reasoningAndTextParts(["Дроби ", "— это части целого."]), finishPart()],
    ];
    let call = 0;
    const model = mockModel(() => streamOf(scripts[call++]!));
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        tools: () => ({
          lookup: tool({ description: "Справка", inputSchema: z.object({ topic: z.string() }), execute: async ({ topic }) => `Справка про ${topic}` }),
        }),
      },
      env: mockEnv,
    });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Что такое дроби?" }] }));
    // Длительность рассуждения зависит от часов: в эталоне — только то, что она есть.
    const stable = chunks.map((chunk) =>
      chunk.type === "message-metadata" || chunk.type === "finish" || chunk.type === "start"
        ? JSON.parse(JSON.stringify(chunk, (key, value) => (key === "reasoningDurationsMs" ? Object.keys(value as object) : value)))
        : chunk,
    );
    await expect(withStableIds(JSON.stringify(stable, null, 1))).toMatchFileSnapshot("./__golden__/turn-stream-without-after-turn.json");
  });
});
