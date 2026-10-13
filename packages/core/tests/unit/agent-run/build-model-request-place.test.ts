import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import { voiceModePart } from "../../../src/agent-run/mode-notes";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../../src/conversation/types";
import type { ScreenPlace } from "../../../src/index";
import { screenPlaceBlock } from "../../../src/agent-run/screen-place";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import type { FrozenContextData } from "../../../src/frozen-context/context-blocks";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "../support/mock-model";

const MEMORY = "<agent_memory>\nСправочные данные.\n[]\n</agent_memory>";
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

const cardOne: ScreenPlace = { description: "Карточка клиента «ООО Ромашка», id 42" };
const cardTwo: ScreenPlace = { description: "Карточка клиента «ИП Лютик», id 43" };

/** Застывшие блоки хода: память, затем место — как их собирает ход. */
function frozen(extra: { place?: ScreenPlace | null; memoryBlock?: string | null }): FrozenContextData {
  const place = screenPlaceBlock(extra.place);
  return {
    blocks: [...(extra.memoryBlock ? [{ key: "memory", text: extra.memoryBlock, private: true }] : []), ...(place ? [{ key: "screen_place", text: place }] : [])],
    sent: "all",
    base: null,
  };
}

function request(history: readonly AgentChatMessage[], extra: { place?: ScreenPlace | null; memoryBlock?: string | null; answerId?: string } = {}) {
  return buildModelRequest({
    catalog,
    modelId: mockModelId,
    providerId: "mock",
    chatId: "chat-1",
    instructions,
    tools,
    history,
    frozenContext: { current: { answerId: extra.answerId ?? "a-next", data: frozen(extra) }, group: false },
    env: mockEnv,
  });
}

function partsOf(message: { content: unknown }): Array<{ type: string; text?: string }> {
  return typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content as Array<{ type: string; text?: string }>);
}

const texts = (message: { content: unknown }) => partsOf(message).map((part) => part.text);

describe("buildModelRequest: место на экране", () => {
  it("кладёт место отдельной текстовой частью в конец последнего сообщения человека", async () => {
    const { messages } = await request(conversation, { place: cardOne });
    const last = messages.at(-1)!;
    expect(last.role).toBe("user");
    const parts = texts(last);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("Второй вопрос");
    expect(parts[1]).toContain("<screen_place>");
    expect(parts[1]).toContain("Карточка клиента «ООО Ромашка», id 42");
  });

  it("порядок: части человека → пометка режима → блок памяти → место", async () => {
    const voiceHistory: AgentChatMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }, voiceModePart()] },
    ];
    const { messages } = await buildModelRequest({
      catalog,
      modelId: mockModelId,
      providerId: "mock",
      chatId: "chat-1",
      instructions,
      history: voiceHistory,
      modeNotes: { voice: "ПОМЕТКА-ГОЛОС", text: "ПОМЕТКА-ТЕКСТ" },
      frozenContext: { current: { answerId: "a1", data: frozen({ memoryBlock: MEMORY, place: cardOne }) }, group: false },
      env: mockEnv,
    });
    const parts = texts(messages.at(-1)!);
    expect(parts[0]).toBe("Привет");
    expect(parts[1]).toBe("ПОМЕТКА-ГОЛОС");
    expect(parts[2]).toBe(MEMORY);
    expect(parts[3]).toContain("<screen_place>");
    expect(parts).toHaveLength(4);
  });

  it("нет места (undefined или null) — запрос такой же, как без него (FR-016)", async () => {
    const plain = await request(conversation);
    expect((await request(conversation, { place: null })).messages).toEqual(plain.messages);
    expect((await request(conversation, { place: undefined })).messages).toEqual(plain.messages);
    expect(JSON.stringify(plain.messages)).not.toContain("screen_place");
  });

  it("продолжение: ответ хода уже в истории — место в сообщении человека перед ним", async () => {
    const { messages } = await request([...conversation, text("a2", "assistant", "Второй ответ")], { place: cardOne, answerId: "a2" });
    expect(texts(messages.at(-2)!).at(-1)).toContain("<screen_place>");
    expect(JSON.stringify(messages.at(-1))).not.toContain("screen_place");
    expect(JSON.stringify(messages.slice(0, -2))).not.toContain("screen_place");
  });

  it("страж кэша (SC-005): два хода с одним местом — запрос второго начинается с запроса первого целиком", async () => {
    const turnOne = await request(conversation, { place: cardOne, memoryBlock: MEMORY, answerId: "a2" });
    const a2: AgentChatMessage = {
      id: "a2",
      role: "assistant",
      parts: [{ type: FROZEN_CONTEXT_PART_TYPE, data: frozen({ place: cardOne, memoryBlock: MEMORY }) } as never, { type: "text", text: "Второй ответ" }],
    };
    const next = [...conversation, a2, text("u3", "user", "Третий вопрос")];
    const unchanged = { ...frozen({ place: cardOne, memoryBlock: MEMORY }), sent: { changed: [], removed: [] }, base: "a2" };
    const turnTwo = await buildModelRequest({
      catalog,
      modelId: mockModelId,
      providerId: "mock",
      chatId: "chat-1",
      instructions,
      tools,
      history: next,
      frozenContext: { current: { answerId: "a3", data: unchanged }, group: false },
      env: mockEnv,
    });
    expect(JSON.stringify(turnTwo.instructions)).toBe(JSON.stringify(turnOne.instructions));
    expect(JSON.stringify(turnTwo.tools)).toBe(JSON.stringify(turnOne.tools));
    expect(JSON.stringify(turnTwo.messages.slice(0, turnOne.messages.length))).toBe(JSON.stringify(turnOne.messages));
    expect(texts(turnTwo.messages.at(-1)!)).toEqual(["Третий вопрос"]);
  });

  it("страж кэша (SC-005): то же место на том же ходе — запросы побайтно равны; другое место меняет только хвост последнего сообщения", async () => {
    const again = await request(conversation, { place: cardOne });
    const same = await request(conversation, { place: cardOne });
    expect(JSON.stringify(same)).toBe(JSON.stringify(again));

    const other = await request(conversation, { place: cardTwo });
    expect(JSON.stringify(other.instructions)).toBe(JSON.stringify(again.instructions));
    expect(JSON.stringify(other.tools)).toBe(JSON.stringify(again.tools));
    expect(JSON.stringify(other.messages.slice(0, -1))).toBe(JSON.stringify(again.messages.slice(0, -1)));
    expect(JSON.stringify(other.messages.at(-1))).not.toBe(JSON.stringify(again.messages.at(-1)));
    expect(texts(other.messages.at(-1)!)[0]).toBe("Второй вопрос");
  });

  it("запрос с местом и без него различается только последним сообщением", async () => {
    const plain = await request(conversation);
    const withPlace = await request(conversation, { place: cardOne });
    expect(JSON.stringify(withPlace.instructions)).toBe(JSON.stringify(plain.instructions));
    expect(JSON.stringify(withPlace.tools)).toBe(JSON.stringify(plain.tools));
    expect(JSON.stringify(withPlace.messages.slice(0, -1))).toBe(JSON.stringify(plain.messages.slice(0, -1)));
  });
});
