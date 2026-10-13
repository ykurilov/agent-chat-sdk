import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import { createChatService } from "../../../src/chat-service";
import type { ChatServiceOptions } from "../../../src/chat-service";
import type { Chat } from "../../../src/conversation/types";
import type { TurnResult } from "../../../src/turn-hooks/turn-hooks";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";

function setup(extra: Partial<ChatServiceOptions>) {
  const models: AgentToolsModel[] = [];
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: streamOf([
        streamStart,
        ...textParts(["ответ"]),
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } },
      ]),
    }),
  });
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: {
      instructions: "Ты помощник.",
      tools: (toolsModel) => {
        models.push(toolsModel);
        return { noop: tool({ description: "Ничего", inputSchema: z.object({}), execute: async () => "ок" }) };
      },
    },
    env: mockEnv,
    logError: () => {},
    ...extra,
  });
  return { model, service, models };
}

const ask = async (service: ReturnType<typeof setup>["service"], chatId: string) =>
  readAll(await service.sendMessage("sandbox:anna", chatId, { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "привет" }] }));

describe("staffOfChat: сотрудник хода (копия чата человека)", () => {
  it("сотрудник чата идёт инструментам в `model.staff`; функция получает чат", async () => {
    const staffOfChat = vi.fn((chat: Chat) => (chat.ownerId === "sandbox:anna" ? { id: "anna" } : null));
    const { service, models } = setup({ staffOfChat });
    const chat = await service.createChat("sandbox:anna");
    await ask(service, chat.id);
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((toolsModel) => toolsModel.staff?.id === "anna" && toolsModel.ownerId === "sandbox:anna")).toBe(true);
    expect(staffOfChat).toHaveBeenCalledWith(expect.objectContaining({ id: chat.id, ownerId: "sandbox:anna" }));
  });

  it("`null` и без опции — `staff` нет, запрос к модели побайтно тот же", async () => {
    const plain = setup({});
    const none = setup({ staffOfChat: () => null });
    await ask(plain.service, (await plain.service.createChat("sandbox:anna")).id);
    await ask(none.service, (await none.service.createChat("sandbox:anna")).id);
    expect([...plain.models, ...none.models].every((toolsModel) => !("staff" in toolsModel))).toBe(true);
    expect(JSON.stringify(none.model.doStreamCalls[0]!.prompt)).toBe(JSON.stringify(plain.model.doStreamCalls[0]!.prompt));
  });

  it("итог хода (`afterTurn`): у копии `staff` и `actorId` сотрудника, у обычного чата `actorId` — владелец", async () => {
    const results: TurnResult[] = [];
    const staffOfChat = (chat: Chat) => (chat.title === "копия" ? { id: "anna" } : null);
    const { service } = setup({ staffOfChat, afterTurn: (result) => void results.push(result) });
    const copy = await service.createChat("sandbox:anna");
    await service.renameChat("sandbox:anna", copy.id, "копия");
    const plain = await service.createChat("sandbox:anna");
    await ask(service, copy.id);
    await ask(service, plain.id);
    expect(results.map(({ chatId, actorId, staff }) => ({ chatId, actorId, staff }))).toEqual([
      { chatId: copy.id, actorId: "anna", staff: { id: "anna" } },
      { chatId: plain.id, actorId: "sandbox:anna", staff: undefined },
    ]);
  });
});
