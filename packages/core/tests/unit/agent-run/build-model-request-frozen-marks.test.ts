import { streamText } from "ai";
import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import type { FrozenContextData } from "../../../src/frozen-context/context-blocks";
import { standardCatalog } from "../../../src/models/standard-catalog";

const mark = { openrouter: { cacheControl: { type: "ephemeral" } } };
const instructions = "Ты помощник.";

const blocks = (memory: string, place?: string): FrozenContextData => ({
  blocks: [{ key: "memory", text: memory, private: true }, ...(place ? [{ key: "screen_place", text: place }] : [])],
  sent: "all",
  base: null,
});
const u1: AgentChatMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const a1 = (data?: FrozenContextData): AgentChatMessage => ({
  id: "a1",
  role: "assistant",
  parts: [...(data ? [{ type: FROZEN_CONTEXT_PART_TYPE, data } as never] : []), { type: "text", text: "Здравствуйте" }],
});
const u2: AgentChatMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Как дела?" }] };

function build(
  history: AgentChatMessage[],
  options: { current?: { answerId: string; data: FrozenContextData }; messages?: ModelMessage[] } = {},
  providerId = "openrouter",
) {
  return buildModelRequest({
    catalog: standardCatalog,
    modelId: providerId === "openrouter" ? "gemini-3.8-flash" : "deepseek-4.1-flash",
    providerId,
    chatId: "c1",
    instructions,
    history,
    frozenContext: { ...(options.current && { current: options.current }), group: false },
    ...(options.messages && { tailMessages: options.messages }),
    env: { OPENROUTER_API_KEY: "k", DEEPSEEK_API_KEY: "k", FIREWORKS_API_KEY: "k", TOGETHER_API_KEY: "k" },
  });
}

type Part = { type: string; text?: string; providerOptions?: unknown };
const partsOf = (message: { content: unknown }): Part[] =>
  typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content as Part[]);

describe("метка кэша и застывшие блоки (FR-008)", () => {
  it("блоки — частями вопроса без своих меток; метка одна — на последнем сообщении", async () => {
    const request = await build([u1], { current: { answerId: "a1", data: blocks("ПАМЯТЬ-1", "Экран 1") } });
    const parts = partsOf(request.messages[0]!);
    expect(parts.map((part) => part.text)).toEqual(["Привет", "ПАМЯТЬ-1", "Экран 1"]);
    expect(parts.every((part) => part.providerOptions === undefined)).toBe(true);
    expect(request.messages[0]?.providerOptions).toEqual(mark);
  });

  it("следующий ход: вопрос прошлого хода с его блоками побайтно тот же", async () => {
    const turn1 = await build([u1], { current: { answerId: "a1", data: blocks("ПАМЯТЬ-1", "Экран 1") } });
    const next: FrozenContextData = { ...blocks("ПАМЯТЬ-2", "Экран 2"), sent: { changed: ["memory", "screen_place"], removed: [] }, base: "a1" };
    const turn2 = await build([u1, a1(blocks("ПАМЯТЬ-1", "Экран 1")), u2], { current: { answerId: "a2", data: next } });
    expect(turn2.messages[0]!.content).toEqual(turn1.messages[0]!.content);
    expect(partsOf(turn2.messages[2]!).map((part) => part.text)).toEqual(["Как дела?", "ПАМЯТЬ-2", "Экран 2"]);
  });

  it("после вызова инструмента в том же ходе метка только на последнем сообщении", async () => {
    const withTool: AgentChatMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "dynamic-tool", toolName: "lookup", toolCallId: "t1", state: "output-available", input: {}, output: "нет данных" }],
    };
    const request = await build([u1, withTool], { current: { answerId: "a1", data: blocks("ПАМЯТЬ") } });
    // У результатов инструментов метка — на последнем результате (см. step-cache-mark.ts).
    const marked = request.messages.flatMap((message, index) => (message.providerOptions || partsOf(message).some((part) => part.providerOptions) ? [index] : []));
    expect(marked).toEqual([request.messages.length - 1]);
    expect(partsOf(request.messages[0]!).every((part) => part.providerOptions === undefined)).toBe(true);
  });

  it("хвостовые сообщения попытки: метка конца — на последнем сообщении истории, хвост без метки", async () => {
    const note: ModelMessage = { role: "user", content: [{ type: "text", text: "Продолжи с места обрыва." }] };
    const request = await build([u1, a1(blocks("ПАМЯТЬ"))], { messages: [note] });
    expect(request.messages).toHaveLength(3);
    expect(request.messages.map((message) => message.providerOptions)).toEqual([undefined, mark, undefined]);
    expect(request.messages[2]).toEqual(note);
  });

  it("без блоков метка одна — на последнем сообщении, как раньше", async () => {
    const request = await build([u1, a1(), u2]);
    expect(request.messages.map((message) => message.providerOptions)).toEqual([undefined, undefined, mark]);
    expect(partsOf(request.messages[2]!).every((part) => part.providerOptions === undefined)).toBe(true);
  });

  it("провайдер без меток кэша: ни одной метки и с блоками", async () => {
    const request = await build([u1], { current: { answerId: "a1", data: blocks("ПАМЯТЬ", "Экран") } }, "deepseek");
    expect(JSON.stringify(request.messages)).not.toContain("cacheControl");
  });

  it("из той же истории и тех же блоков запрос побайтно тот же", async () => {
    const current = { answerId: "a2", data: { ...blocks("ПАМЯТЬ"), sent: { changed: [], removed: [] }, base: "a1" } };
    const first = await build([u1, a1(blocks("ПАМЯТЬ")), u2], { current });
    const second = await build([u1, a1(blocks("ПАМЯТЬ")), u2], { current });
    expect(JSON.stringify(second.messages)).toBe(JSON.stringify(first.messages));
  });

  it("в запросе OpenRouter cache_control только на конце вопроса, на блоках перед ним его нет", async () => {
    const bodies: string[] = [];
    const fetchSpy: typeof globalThis.fetch = async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response("{}", { status: 400 });
    };
    const request = await buildModelRequest({
      catalog: standardCatalog,
      // Не Google: у Gemini метка с конца запроса переезжает (см. openrouter-gemini-cache-mark.test.ts).
      modelId: "gpt-6-luna",
      providerId: "openrouter",
      chatId: "c1",
      instructions,
      history: [u1],
      frozenContext: { current: { answerId: "a1", data: blocks("ПАМЯТЬ", "Экран") }, group: false },
      env: { OPENROUTER_API_KEY: "k" },
      fetch: fetchSpy,
    });
    await streamText({ ...request, maxRetries: 0, onError: () => {} }).consumeStream();
    const user = (JSON.parse(bodies[0]!) as { messages: Array<{ role: string; content: Array<{ text: string; cache_control?: unknown }> }> }).messages.find(
      (message) => message.role === "user",
    )!;
    expect(user.content.map((block) => block.cache_control !== undefined)).toEqual([false, false, true]);
    expect(user.content.map((block) => block.text)).toEqual(["Привет", "ПАМЯТЬ", "Экран"]);
  });

  describe("заметка продолжения (ответ на паузе ответа)", () => {
    const note: FrozenContextData = { ...blocks("ПАМЯТЬ", "Экран 2"), sent: { changed: ["screen_place"], removed: [] }, base: "a1" };
    const frozenPart = (data: FrozenContextData) => ({ type: FROZEN_CONTEXT_PART_TYPE, data }) as never;
    const paused = (state: "output-available" | "approval-responded"): AgentChatMessage => ({
      id: "a1",
      role: "assistant",
      parts: [
        frozenPart(blocks("ПАМЯТЬ", "Экран 1")),
        { type: "step-start" },
        state === "output-available"
          ? { type: "dynamic-tool", toolName: "ask_choice", toolCallId: "w1", state, input: {}, output: { выбрано: "Про" } }
          : ({ type: "dynamic-tool", toolName: "remove", toolCallId: "w1", state, input: {}, approval: { id: "ap1", approved: true } } as never),
        frozenPart(note),
      ],
    });

    it("ответ на виджет: заметка — последним сообщением после результата, метка — на ней одной", async () => {
      const request = await build([u1, paused("output-available")], { current: { answerId: "a1", data: blocks("ПАМЯТЬ", "Экран 1") } });
      expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "user"]);
      expect(partsOf(request.messages[3]!).map((part) => part.text)).toEqual(["Экран 2"]);
      expect(request.messages.map((message) => message.providerOptions)).toEqual([undefined, undefined, undefined, mark]);
      expect(request.noteAfterApprovals).toBeUndefined();
    });

    it("подтверждение, вызов ещё не выполнен: заметка придержана до результата, запрос кончается ответом инструмента", async () => {
      const request = await build([u1, paused("approval-responded")], { current: { answerId: "a1", data: blocks("ПАМЯТЬ", "Экран 1") } });
      expect(request.messages.at(-1)?.role).toBe("tool");
      expect(request.messages.at(-1)?.providerOptions).toEqual(mark);
      expect(request.noteAfterApprovals?.map((message) => partsOf(message).map((part) => part.text))).toEqual([["Экран 2"]]);
    });
  });
});
