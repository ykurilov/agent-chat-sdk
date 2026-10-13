import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { GREETING_LEAD } from "../../../src/agent-run/greeting-lead";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "../support/mock-model";

const BLOCK = "<agent_memory>\nСправочные данные.\n[]\n</agent_memory>";
const instructions = "Ты помощник.";
const catalog = mockCatalog({ mock: mockModel(() => streamOf(reasoningAndTextParts(["ок"]))) });

const tools = {
  b_tool: tool({ description: "Б", inputSchema: jsonSchema<object>({ type: "object", properties: {} }), execute: async () => "б" }),
  a_tool: tool({ description: "А", inputSchema: jsonSchema<object>({ type: "object", properties: {} }), execute: async () => "а" }),
};

const text = (id: string, role: "user" | "assistant", value: string): AgentChatMessage => ({ id, role, parts: [{ type: "text", text: value }] });

const conversation: AgentChatMessage[] = [
  text("u1", "user", "Первый вопрос"),
  text("a1", "assistant", "Первый ответ"),
  text("u2", "user", "Второй вопрос"),
];

/** Запрос, где застывший блок памяти у ответа `answerId` (по умолчанию — ответа, которого в истории ещё нет). */
function request(history: readonly AgentChatMessage[], memoryBlock?: string | null, answerId = "a-next") {
  return buildModelRequest({
    catalog,
    modelId: mockModelId,
    providerId: "mock",
    chatId: "chat-1",
    instructions,
    tools,
    history,
    frozenContext: {
      current: { answerId, data: { blocks: memoryBlock ? [{ key: "memory", text: memoryBlock, private: true }] : [], sent: "all", base: null } },
      group: false,
    },
    env: mockEnv,
  });
}

/** Части сообщения как список: строковое содержимое считается одной текстовой частью. */
function partsOf(message: { content: unknown }): Array<{ type: string; text?: string }> {
  return typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content as Array<{ type: string; text?: string }>);
}

describe("buildModelRequest: блок памяти", () => {
  it("добавляет блок отдельной текстовой частью в конец последнего сообщения человека", async () => {
    const { messages } = await request(conversation, BLOCK);
    const last = messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(partsOf(last)).toEqual([
      { type: "text", text: "Второй вопрос" },
      { type: "text", text: BLOCK },
    ]);
  });

  it("прежние сообщения не тронуты: блок только у последнего сообщения человека", async () => {
    const without = await request(conversation);
    const withBlock = await request(conversation, BLOCK);
    expect(withBlock.messages).toHaveLength(without.messages.length);
    expect(JSON.stringify(withBlock.messages.slice(0, -1))).toBe(JSON.stringify(without.messages.slice(0, -1)));
  });

  it("продолжение: ответ хода уже в истории — блок в сообщении человека перед ним", async () => {
    const { messages } = await request([...conversation, text("a2", "assistant", "Второй ответ")], BLOCK, "a2");
    expect(partsOf(messages.at(-2)!).at(-1)).toEqual({ type: "text", text: BLOCK });
    expect(JSON.stringify(messages.at(-1))).not.toContain("agent_memory");
    expect(JSON.stringify(messages.slice(0, -2))).not.toContain("agent_memory");
  });

  it("память пуста (null) или блока нет — запрос такой же, как без памяти", async () => {
    const plain = await request(conversation);
    expect((await request(conversation, null)).messages).toEqual(plain.messages);
    expect((await request(conversation, "")).messages).toEqual(plain.messages);
  });

  it("нет сообщений человека (агент пишет первым) — блок в отдельном сообщении человека перед ответом", async () => {
    const { messages } = await request([text("a1", "assistant", "Пишу первым")], BLOCK, "a1");
    expect(messages[0]).toEqual({ role: "user", content: [{ type: "text", text: GREETING_LEAD }, { type: "text", text: BLOCK }] });
    expect(messages[1]!.role).toBe("assistant");
  });

  it("страж кэша: с разной памятью инструкция, инструменты и все сообщения до последнего человека побайтно равны", async () => {
    const first = await request(conversation, "<agent_memory>\nОдно\n</agent_memory>");
    const second = await request(conversation, "<agent_memory>\nСовсем другое, и намного длиннее\n</agent_memory>");
    expect(JSON.stringify(second.instructions)).toBe(JSON.stringify(first.instructions));
    expect(JSON.stringify(Object.keys(second.tools ?? {}))).toBe(JSON.stringify(["a_tool", "b_tool"]));
    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools));
    expect(JSON.stringify(second.messages.slice(0, -1))).toBe(JSON.stringify(first.messages.slice(0, -1)));
    expect(JSON.stringify(second.messages.at(-1))).not.toBe(JSON.stringify(first.messages.at(-1)));
  });

  it("страж кэша: запрос без блока и с блоком различается только последним сообщением", async () => {
    const plain = await request(conversation);
    const withBlock = await request(conversation, BLOCK);
    expect(JSON.stringify(withBlock.instructions)).toBe(JSON.stringify(plain.instructions));
    expect(JSON.stringify(withBlock.messages.slice(0, -1))).toBe(JSON.stringify(plain.messages.slice(0, -1)));
  });
});
