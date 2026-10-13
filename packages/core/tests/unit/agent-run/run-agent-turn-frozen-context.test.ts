import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { todayBlock } from "../../../src/agent-run/today";
import { newStoredMessage } from "../../../src/conversation/types";
import type { AgentChatMessage, StoredMessage } from "../../../src/conversation/types";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import type { FrozenContextData } from "../../../src/frozen-context/context-blocks";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, mockCatalog, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { TODAY, savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

type Prompt = MockLanguageModelV4["doStreamCalls"][number]["prompt"];
type Part = StoredMessage["parts"][number];

const MEMORY = "<agent_memory>\nЛюбит кофе\n</agent_memory>";
const memoryOf = (text: string) => ({ snapshot: vi.fn(async () => text) }) as never;
const firstUser = (prompt: Prompt) => JSON.stringify(prompt.find((message) => message.role === "user"));
const answerText = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];
const brokenText = (text: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "text-start", id: "txt-0" },
  { type: "text-delta", id: "txt-0", delta: text },
  { type: "error", error: new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseBody: "busy" }) },
];

function scriptedModel(script: LanguageModelV4StreamPart[][]) {
  const queue = [...script];
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = queue.shift();
      if (!next) throw new Error("лишний запрос");
      return { stream: streamOf(next) };
    },
  });
}

const frozenPart = (parts: readonly Part[]) => parts.find((part) => part.type === FROZEN_CONTEXT_PART_TYPE) as { data: FrozenContextData } | undefined;

describe("runAgentTurn: застывший контекст хода (FR-005, US3)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("часть пишется первой частью ответа; клиенту не уходит", async () => {
    const storage = await storageWithQuestion();
    const model = scriptedModel([answerText("Привет!")]);
    const chunks = await readAll(startTurn(storage, model, { ownerId: "anna", memory: memoryOf(MEMORY) }));

    const answer = (await savedAnswer(storage))!;
    expect(answer.parts[0]!.type).toBe(FROZEN_CONTEXT_PART_TYPE);
    expect(frozenPart(answer.parts)!.data).toEqual({
      blocks: [
        { key: "memory", text: MEMORY, private: true },
        { key: "today", text: TODAY },
      ],
      sent: "all",
      base: null,
      memoryFrom: "u1",
    });
    expect(JSON.stringify(chunks)).not.toContain(FROZEN_CONTEXT_PART_TYPE);
    expect(answer.status).toBe("complete");
  });

  it("автопродолжение после обрыва: вопрос с блоками в каждом запросе побайтно тот же, память прочитана один раз", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const memory = memoryOf(MEMORY);
    const model = scriptedModel([brokenText("Начало "), answerText("и конец.")]);
    const storage = await storageWithQuestion();
    await onFakeClock(() => readAll(startTurn(storage, model, { ownerId: "anna", memory, catalog: mockCatalog({ mock: model }) })));

    expect(model.doStreamCalls).toHaveLength(2);
    const [first, second] = model.doStreamCalls.map((call) => call.prompt);
    expect(firstUser(second!)).toBe(firstUser(first!));
    expect(firstUser(first!)).toContain("Любит кофе");
    expect((memory as { snapshot: ReturnType<typeof vi.fn> }).snapshot).toHaveBeenCalledTimes(1);
  });

  it("запасной провайдер: вопрос с теми же байтами, что у основного", async () => {
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseBody: "busy", responseHeaders: { "retry-after-ms": "1" } });
      },
    });
    const backup = scriptedModel([answerText("Ответ запасного")]);
    const storage = await storageWithQuestion();
    await readAll(
      startTurn(storage, primary, { ownerId: "anna", memory: memoryOf(MEMORY), catalog: mockCatalog({ mock: primary, "mock-backup": backup }), providerFallback: {} }),
    );
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(firstUser(backup.doStreamCalls[0]!.prompt)).toBe(firstUser(primary.doStreamCalls[0]!.prompt));
  });

  it("продолжение после подтверждения: вопрос с блоками из части ответа, новый день — заметкой после результата, память не перечитана", async () => {
    const data: FrozenContextData = {
      blocks: [
        { key: "memory", text: MEMORY, private: true },
        { key: "today", text: TODAY },
      ],
      sent: "all",
      base: null,
      memoryFrom: "u1",
    };
    const message: AgentChatMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: FROZEN_CONTEXT_PART_TYPE, data } as never,
        { type: "step-start" },
        { type: "tool-remove", toolCallId: "c1", state: "approval-responded", input: { path: "a" }, approval: { id: "ap1", approved: true } } as never,
      ],
      metadata: { reasoningDurationsMs: {} },
    };
    const storage = await storageWithQuestion();
    await storage.insertMessage(
      newStoredMessage({ id: "a1", chatId: "chat-1", parentId: "u1", role: "assistant", status: "streaming", modelId: "mock-model", providerId: "mock", parts: message.parts }),
    );
    const memory = memoryOf("<agent_memory>\nДругое\n</agent_memory>");
    const model = scriptedModel([answerText("Готово")]);
    const remove = tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute: async () => "удалено" });
    await readAll(
      startTurn(storage, model, {
        ownerId: "anna",
        memory,
        tools: { remove },
        now: () => new Date(2026, 0, 2, 12),
        history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }, message],
        resume: { message, usage: null },
      }),
    );

    expect((memory as { snapshot: ReturnType<typeof vi.fn> }).snapshot).not.toHaveBeenCalled();
    const sent = firstUser(model.doStreamCalls[0]!.prompt);
    expect(sent).toContain("Любит кофе");
    expect(sent).toContain(JSON.stringify(TODAY).slice(1, -1));
    expect(sent).not.toContain("Другое");
    expect(sent).not.toContain(JSON.stringify(todayBlock(new Date(2026, 0, 2, 12))).slice(1, -1));
    // Новый день — заметкой продолжения в конце запроса, после результата одобренного вызова.
    const prompt = model.doStreamCalls[0]!.prompt;
    expect(prompt.map((entry) => entry.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(JSON.stringify(prompt.at(-1))).toContain(JSON.stringify(todayBlock(new Date(2026, 0, 2, 12))).slice(1, -1));
    expect(JSON.stringify(prompt)).not.toContain("Другое");
    const answer = (await savedAnswer(storage))!;
    expect(answer.parts.filter((part) => part.type === FROZEN_CONTEXT_PART_TYPE)).toHaveLength(2);
  });

  it("продолжение старого ответа без части: часть дописывается в ответ, блоки идут в вопрос перед ним", async () => {
    const message: AgentChatMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "step-start" }, { type: "text", text: "Начало", state: "done" }],
      metadata: { reasoningDurationsMs: {} },
    };
    const storage = await storageWithQuestion();
    const model = scriptedModel([answerText(" и конец")]);
    await readAll(
      startTurn(storage, model, {
        history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }, message],
        resume: { message, usage: null, replay: true },
      }),
    );
    const answer = (await savedAnswer(storage))!;
    expect(frozenPart(answer.parts)?.data.blocks).toEqual([{ key: "today", text: TODAY }]);
    expect(firstUser(model.doStreamCalls[0]!.prompt)).toContain(JSON.stringify(TODAY).slice(1, -1));
  });
});
