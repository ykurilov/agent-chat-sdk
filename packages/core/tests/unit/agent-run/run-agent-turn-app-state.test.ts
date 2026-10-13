import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const callTool = (name: string, input: object = {}, id = "c1"): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) },
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

/** `write` ставит поле, `read` отдаёт всё состояние; `keep` получает модель инструментов хода. */
const stateTools = (keep?: (model: AgentToolsModel) => void) => (model: AgentToolsModel): ToolSet => {
  keep?.(model);
  return {
    write: tool({
      description: "Записать поле",
      inputSchema: z.object({ field: z.string(), value: z.string() }),
      execute: async ({ field, value }) => {
        model.state!.set(`fields.${field}`, value);
        return "записано";
      },
    }),
    read: tool({
      description: "Прочитать состояние",
      inputSchema: z.object({}),
      execute: async () => model.state!.get(),
    }),
  };
};

const outputOf = (parts: AgentChatMessage["parts"], toolCallId: string) =>
  (parts.find((part) => (part as { toolCallId?: string }).toolCallId === toolCallId) as { output?: unknown } | undefined)?.output;

describe("runAgentTurn: model.state", () => {
  it("запись — часть data-app-state в потоке и в ответе, сразу после вызова инструмента", async () => {
    const model = steppedModel([callTool("write", { field: "email", value: "a@x.ru" }), reasoningAndTextParts(["готово"])]);
    const { chunks, answer } = await runTurn(model, { ownerId: "anna", tools: stateTools() });
    const stateChunks = chunks.filter((chunk) => chunk.type === "data-app-state");
    expect(stateChunks).toEqual([expect.objectContaining({ data: { set: { "fields.email": "a@x.ru" } } })]);
    expect((stateChunks[0] as { transient?: boolean }).transient).toBeUndefined();
    const types = answer.parts.map((part) => part.type);
    expect(types.indexOf("data-app-state")).toBe(types.indexOf("tool-write") + 1);
    expect(answer.parts[types.indexOf("data-app-state")]).toMatchObject({ data: { set: { "fields.email": "a@x.ru" } } });
  });

  it("база — appState хода; следующий шаг видит записанное на прошлом", async () => {
    const model = steppedModel([
      callTool("write", { field: "phone", value: "+7" }, "c1"),
      callTool("read", {}, "c2"),
      reasoningAndTextParts(["готово"]),
    ]);
    const { answer } = await runTurn(model, { ownerId: "anna", tools: stateTools(), appState: { fields: { email: "a@x.ru" }, $closed: { code: "x" } } });
    expect(outputOf(answer.parts, "c2")).toEqual({ fields: { email: "a@x.ru", phone: "+7" } });
  });

  it("без appState база — свёртка истории хода", async () => {
    const model = steppedModel([callTool("read"), reasoningAndTextParts(["готово"])]);
    const history = [
      { id: "u0", role: "user" as const, parts: [{ type: "text" as const, text: "раньше" }] },
      { id: "a0", role: "assistant" as const, parts: [{ type: "data-app-state", data: { set: { "fields.email": "a@x.ru" } } }] as AgentChatMessage["parts"] },
      { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "Привет" }] },
    ];
    const { answer } = await runTurn(model, { ownerId: "anna", tools: stateTools(), history });
    expect(outputOf(answer.parts, "c1")).toEqual({ fields: { email: "a@x.ru" } });
  });

  it("запись больше предела — ошибка вызова с текстом для модели, ход идёт дальше", async () => {
    const model = steppedModel([callTool("write", { field: "doc", value: "я".repeat(20_000) }), reasoningAndTextParts(["готово"])]);
    const { chunks, answer } = await runTurn(model, { ownerId: "anna", tools: stateTools() });
    const failure = chunks.find((chunk) => chunk.type === "tool-output-error") as { errorText?: string } | undefined;
    expect(failure?.errorText).toContain("16 КБ");
    expect(answer.parts.some((part) => part.type === "data-app-state")).toBe(false);
    expect(answer.status).toBe("complete");
  });

  it("после конца хода запись не принимается: не бросает, строка в журнал, ответ без части", async () => {
    const logError = vi.fn();
    let kept!: AgentToolsModel;
    const model = steppedModel([reasoningAndTextParts(["готово"])]);
    const { storage } = await runTurn(model, { ownerId: "anna", logError, tools: stateTools((m) => (kept = m)) });
    expect(() => kept.state!.set("fields.late", "x")).not.toThrow();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("после конца хода"));
    expect(JSON.stringify(await storage.listMessages("chat-1"))).not.toContain("data-app-state");
  });

  const state = (field: string) => ({ type: "data-app-state", data: { set: { [`fields.${field}`]: field } } });
  const written = (id: string) => ({ type: "tool-write", toolCallId: id, state: "output-available", input: { field: id, value: id }, output: "записано" });
  const said = (text: string) => ({ type: "text", text, state: "done" });
  const step = { type: "step-start" };

  it.each<[string, { user?: unknown[]; answer: unknown[] }]>([
    ["сразу после вызова", { answer: [step, written("w1"), state("w1"), step, said("Записал почту.")] }],
    ["в начале ответа", { answer: [state("a"), step, said("Записал.")] }],
    ["между двумя текстами одного шага", { answer: [step, said("Первое."), state("a"), said("Второе.")] }],
    ["в конце ответа", { answer: [step, said("Записал."), state("a")] }],
    ["после параллельных вызовов", { answer: [step, written("w1"), written("w2"), state("w1"), state("w2"), step, said("Готово.")] }],
    ["в ответе только с записью", { answer: [step, state("a")] }],
    ["в сообщении человека", { user: [{ type: "text", text: "почта a@x.ru" }, state("u")], answer: [step, said("Понял.")] }],
  ])("части состояния модели не уходят (%s): запрос побайтно тот же, что без них", async (_place, { user, answer }) => {
    const userParts = (user ?? [{ type: "text", text: "почта a@x.ru" }]) as AgentChatMessage["parts"];
    const answerParts = answer as AgentChatMessage["parts"];
    const withoutState = (parts: AgentChatMessage["parts"]) => parts.filter((part) => part.type !== "data-app-state");
    const history = (keep: (parts: AgentChatMessage["parts"]) => AgentChatMessage["parts"]) => [
      { id: "u0", role: "user" as const, parts: keep(userParts) },
      { id: "a0", role: "assistant" as const, parts: keep(answerParts) },
      { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "Привет" }] },
    ];
    const prompts: string[] = [];
    for (const keep of [(parts: AgentChatMessage["parts"]) => parts, withoutState]) {
      const model = steppedModel([reasoningAndTextParts(["готово"])]);
      await runTurn(model, { ownerId: "anna", tools: stateTools(), history: history(keep) });
      prompts.push(JSON.stringify(model.doStreamCalls[0]!.prompt));
    }
    expect(prompts[0]).not.toContain("data-app-state");
    expect(prompts[0]).toBe(prompts[1]);
  });
});
