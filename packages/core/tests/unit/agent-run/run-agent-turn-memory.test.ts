import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { chatId, runTurn, startTurn, storageWithQuestion, savedAnswer, TODAY } from "../support/turn-fixtures";

const BLOCK = "<agent_memory>\nСправочные данные.\n[{\"id\":\"n1\"}]\n</agent_memory>";

const lookupTool = {
  lookup: tool({ description: "Поиск", inputSchema: z.object({ query: z.string() }), execute: async ({ query }) => `нашёл ${query}` }),
} satisfies ToolSet;

const callLookup = (id: string, query: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: "lookup", input: JSON.stringify({ query }) },
  finishPart("tool-calls"),
];

function steppedModel(steps: LanguageModelV4StreamPart[][]): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = steps[step++];
      if (!next) throw new Error(`шаг ${step} не заготовлен`);
      return { stream: streamOf(next) };
    },
  });
}

const answering = () => new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(reasoningAndTextParts(["ок"])) }) });

/** Текст всех частей сообщения человека в запросе `call`. */
function userParts(model: MockLanguageModelV4, call = 0): string[] {
  const last = [...model.doStreamCalls[call]!.prompt].reverse().find((message) => message.role === "user")!;
  return typeof last.content === "string" ? [last.content] : last.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`));
}

describe("runAgentTurn с долгой памятью", () => {
  it("берёт блок один раз (для человека и чата хода) и кладёт в конец последнего сообщения человека", async () => {
    const snapshot = vi.fn(async () => BLOCK);
    const model = answering();
    await runTurn(model, { ownerId: "anna", memory: { snapshot } });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith({ userId: "anna", chatId });
    expect(userParts(model)).toEqual(["Привет", BLOCK, TODAY]);
  });

  it("ход из трёх шагов: snapshot один, блок на всех шагах один и тот же и стоит в одном месте", async () => {
    const snapshot = vi.fn(async () => BLOCK);
    const model = steppedModel([
      callLookup("c1", "первое"),
      callLookup("c2", "второе"),
      reasoningAndTextParts(["итог"]),
    ]);
    await runTurn(model, { ownerId: "anna", memory: { snapshot }, tools: lookupTool });
    expect(model.doStreamCalls).toHaveLength(3);
    expect(snapshot).toHaveBeenCalledTimes(1);
    for (const call of [0, 1, 2]) expect(userParts(model, call)).toEqual(["Привет", BLOCK, TODAY]);
    // Шаги дописываются после сообщения человека, а не в него.
    expect(model.doStreamCalls[2]!.prompt.length).toBeGreaterThan(model.doStreamCalls[0]!.prompt.length);
  });

  it("блок застывает в части ответа, вопрос человека не меняется", async () => {
    const { storage } = await runTurn(answering(), { ownerId: "anna", memory: { snapshot: async () => BLOCK } });
    const [question, answer] = await storage.listMessages(chatId);
    expect(JSON.stringify(question)).not.toContain("agent_memory");
    expect(answer!.parts[0]).toMatchObject({ type: FROZEN_CONTEXT_PART_TYPE, data: { blocks: [{ key: "memory", text: BLOCK, private: true }, { key: "today" }] } });
  });

  it("клиенту блок не уходит: в потоке ответа его нет", async () => {
    const { chunks } = await runTurn(answering(), { ownerId: "anna", memory: { snapshot: async () => BLOCK } });
    expect(JSON.stringify(chunks)).not.toContain("agent_memory");
  });

  it("память пуста (null) — запрос без добавки", async () => {
    const model = answering();
    await runTurn(model, { ownerId: "anna", memory: { snapshot: async () => null } });
    expect(userParts(model)).toEqual(["Привет", TODAY]);
  });

  it("сбой snapshot: ответ идёт без блока, сбой в журнал", async () => {
    const logError = vi.fn();
    const model = answering();
    const { answer } = await runTurn(model, {
      ownerId: "anna",
      logError,
      memory: {
        snapshot: async () => {
          throw new Error("база недоступна");
        },
      },
    });
    expect(answer.status).toBe("complete");
    expect(userParts(model)).toEqual(["Привет", TODAY]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0]![0])).toContain("база недоступна");
    expect(String(logError.mock.calls[0]![0])).toContain(chatId);
  });

  it("без номера человека памяти нет: snapshot не зовётся", async () => {
    const snapshot = vi.fn(async () => BLOCK);
    const model = answering();
    await runTurn(model, { memory: { snapshot } });
    expect(snapshot).not.toHaveBeenCalled();
    expect(userParts(model)).toEqual(["Привет", TODAY]);
  });

  it("без памяти в настройках — ничего лишнего", async () => {
    const model = answering();
    await runTurn(model, { ownerId: "anna" });
    expect(userParts(model)).toEqual(["Привет", TODAY]);
  });

  it("функция-набор инструментов получает номер человека, чат и провайдера", async () => {
    const toolsFor = vi.fn(() => lookupTool);
    const storage = await storageWithQuestion();
    const stream = startTurn(storage, answering(), { ownerId: "anna", tools: toolsFor });
    for await (const _chunk of stream) void _chunk;
    expect(toolsFor).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "anna", chatId, providerId: "mock" }));
    expect((await savedAnswer(storage))?.status).toBe("complete");
  });
});
