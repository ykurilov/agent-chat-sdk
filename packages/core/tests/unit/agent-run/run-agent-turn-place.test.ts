import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import type { ScreenPlace } from "../../../src/index";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn, TODAY } from "../support/turn-fixtures";

const card: ScreenPlace = { description: "Карточка клиента «ООО Ромашка», id 42", data: { customerId: 42 } };

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

function userParts(model: MockLanguageModelV4, call = 0): string[] {
  const last = [...model.doStreamCalls[call]!.prompt].reverse().find((message) => message.role === "user")!;
  return typeof last.content === "string" ? [last.content] : last.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`));
}

describe("runAgentTurn: место на экране", () => {
  it("набор инструментов-функция получает человека, чат и место хода", async () => {
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => lookupTool);
    await runTurn(answering(), { ownerId: "anna", place: card, tools });
    expect(tools).toHaveBeenCalledTimes(1);
    expect(tools.mock.calls[0]![0]).toMatchObject({ ownerId: "anna", chatId: "chat-1", providerId: "mock", place: card });
  });

  it("места нет — в инструментах null, в запросе части места нет", async () => {
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => lookupTool);
    const model = answering();
    await runTurn(model, { ownerId: "anna", tools });
    expect(tools.mock.calls[0]![0].place).toBeNull();
    expect(userParts(model)).toEqual(["Привет", TODAY]);
  });

  it("место: хвост последнего сообщения человека, данные модели не показываются", async () => {
    const model = answering();
    await runTurn(model, { ownerId: "anna", place: card });
    const parts = userParts(model);
    expect(parts[0]).toBe("Привет");
    expect(parts[1]).toBe(TODAY);
    expect(parts[2]).toContain("<screen_place>");
    expect(parts[2]).toContain("ООО Ромашка");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain("customerId");
  });

  it("ход из трёх шагов: tools(model) один раз, место на всех шагах одно и то же и в одном месте", async () => {
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => lookupTool);
    const model = steppedModel([callLookup("c1", "первое"), callLookup("c2", "второе"), reasoningAndTextParts(["итог"])]);
    await runTurn(model, { ownerId: "anna", place: card, tools });
    expect(model.doStreamCalls).toHaveLength(3);
    expect(tools).toHaveBeenCalledTimes(1);
    const placeParts = [0, 1, 2].map((call) => userParts(model, call));
    expect(placeParts[1]).toEqual(placeParts[0]);
    expect(placeParts[2]).toEqual(placeParts[0]);
    expect(placeParts[0]).toHaveLength(3);
  });

  it("место застывает в части ответа: вопрос человека не меняется, клиенту оно не уходит", async () => {
    const { storage, chunks } = await runTurn(answering(), { ownerId: "anna", place: card });
    const [question, answer] = await storage.listMessages("chat-1");
    expect(JSON.stringify(question)).not.toContain("Ромашка");
    expect(JSON.stringify(answer!.parts[0])).toContain("Ромашка");
    expect(JSON.stringify(chunks)).not.toContain("Ромашка");
  });

  it("набор может зависеть от человека (FR-011)", async () => {
    const tools = (model: AgentToolsModel): ToolSet => (model.ownerId === "anna" ? lookupTool : {});
    const forAnna = answering();
    await runTurn(forAnna, { ownerId: "anna", tools });
    expect((forAnna.doStreamCalls[0]!.tools ?? []).map((item) => item.name)).toEqual(["lookup"]);
    const forBoris = answering();
    await runTurn(forBoris, { ownerId: "boris", tools });
    expect(forBoris.doStreamCalls[0]!.tools ?? []).toEqual([]);
  });

  it("старые приложения работают: набор-объект и функция, которая читает только profile (FR-012)", async () => {
    const withObject = answering();
    await runTurn(withObject, { tools: lookupTool });
    expect((withObject.doStreamCalls[0]!.tools ?? []).map((item) => item.name)).toEqual(["lookup"]);

    const withOldFunction = answering();
    await runTurn(withOldFunction, { place: card, tools: ({ profile }) => (profile.id ? lookupTool : {}) });
    expect((withOldFunction.doStreamCalls[0]!.tools ?? []).map((item) => item.name)).toEqual(["lookup"]);
  });
});
