import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LAST_STEP_NOTE, LAST_STEP_TOOL_REFUSAL, STEP_LIMIT_PART_TYPE } from "../../../src/agent-run/last-step";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn, textOf } from "../support/turn-fixtures";

const callLookup = (id: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: "lookup", input: JSON.stringify({ query: id }) },
  finishPart("tool-calls"),
];

/** Модель: пока ей дают инструменты, вызывает поиск; без инструментов («none») пишет итог. */
function lookupUntilToolsGone() {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async ({ toolChoice }) => {
      call += 1;
      return { stream: streamOf(toolChoice?.type === "none" ? reasoningAndTextParts(["Итог: нашёл два из трёх."]) : callLookup(`c${call}`)) };
    },
  });
}

const lookup = () => {
  const execute = vi.fn(async ({ query }: { query: string }) => `нашёл ${query}`);
  return { execute, tools: { lookup: tool({ description: "Поиск", inputSchema: z.object({ query: z.string() }), execute }) } };
};

const lastText = (prompt: MockLanguageModelV4["doStreamCalls"][number]["prompt"]) => {
  const last = prompt.at(-1)!;
  return last.role === "user" && typeof last.content !== "string" ? last.content.map((part) => (part.type === "text" ? part.text : "")).join("") : null;
};

describe("runAgentTurn: последний шаг хода — без инструментов, с итогом (FR-048)", () => {
  it("лимит шагов: последний запрос с toolChoice «none» и пометкой в самом конце; ответ кончается итогом, а не вызовом", async () => {
    const model = lookupUntilToolsGone();
    const { execute, tools } = lookup();

    const { answer } = await runTurn(model, { tools, maxSteps: 3 });

    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doStreamCalls.slice(0, 2).map((call) => call.toolChoice?.type)).toEqual(["auto", "auto"]);
    expect(model.doStreamCalls[2]!.toolChoice).toEqual({ type: "none" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("Итог: нашёл два из трёх.");
    // Пометка — последним сообщением только последнего запроса; в ответ она не пишется.
    expect(lastText(model.doStreamCalls[2]!.prompt)).toBe(LAST_STEP_NOTE);
    expect(lastText(model.doStreamCalls[1]!.prompt)).not.toBe(LAST_STEP_NOTE);
    expect(JSON.stringify(answer.parts)).not.toContain(LAST_STEP_NOTE);
  });

  it("кэш: последний запрос — тот же запрос, что был бы, плюс пометка в конце; инструменты те же", async () => {
    const model = lookupUntilToolsGone();
    await runTurn(model, { tools: lookup().tools, maxSteps: 2 });

    const [first, last] = model.doStreamCalls;
    expect(last!.tools).toEqual(first!.tools);
    // Всё до пометки — история шагов: вопрос, вызов первого шага и его результат.
    expect(last!.prompt.slice(0, first!.prompt.length)).toEqual(first!.prompt);
    expect(last!.prompt).toHaveLength(first!.prompt.length + 3);
  });

  it("ход кончился раньше лимита — пометки и «none» нет", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(reasoningAndTextParts(["ок"])) }) });
    await runTurn(model, { tools: lookup().tools, maxSteps: 3 });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]!.toolChoice?.type).toBe("auto");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain(LAST_STEP_NOTE);
  });

  it("лимит в один шаг: единственный шаг идёт с инструментами и без пометки", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(reasoningAndTextParts(["ок"])) }) });
    await runTurn(model, { tools: lookup().tools, maxSteps: 1 });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]!.toolChoice?.type).toBe("auto");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain(LAST_STEP_NOTE);
  });

  it("лимит в один шаг и повтор после сбоя: повтор — тот же единственный шаг, тоже с инструментами", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        if (calls === 1) throw overloaded();
        return { stream: streamOf(reasoningAndTextParts(["ок"])) };
      },
    });
    await runTurn(model, { tools: lookup().tools, maxSteps: 1 });

    expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual(["auto", "auto"]);
  });

  it("повтор посреди хода: последний шаг считается по шагам всего хода, а не попытки", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ toolChoice }) => {
        calls += 1;
        if (calls === 2) throw overloaded();
        return { stream: streamOf(toolChoice?.type === "none" ? reasoningAndTextParts(["Итог."]) : callLookup(`c${calls}`)) };
      },
    });
    const { answer } = await runTurn(model, { tools: lookup().tools, maxSteps: 3 });

    // Шаг 1 — вызов, шаг 2 — сбой и повтор, повтор — второй шаг хода (с инструментами), третий — последний.
    expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual(["auto", "auto", "auto", "none"]);
    expect(textOf(answer.parts)).toBe("Итог.");
  });
});

/** Модель, которая зовёт инструмент на каждом шаге, даже когда вызовы запрещены. */
function lookupAlways() {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1;
      return { stream: streamOf(callLookup(`c${call}`)) };
    },
  });
}

type ToolPartView = { type: string; toolCallId: string; state: string; errorText?: string };
const toolParts = (parts: ReadonlyArray<{ type: string }>) => parts.filter((part) => part.type === "tool-lookup") as ToolPartView[];

describe("runAgentTurn: вызов на последнем шаге вопреки запрету не выполняется", () => {
  it("модель зовёт инструмент на каждом шаге: на 20-м инструмент не исполнен, вызов закрыт отказом", async () => {
    const { execute, tools } = lookup();
    const { answer } = await runTurn(lookupAlways(), { tools, maxSteps: 20 });

    expect(execute).toHaveBeenCalledTimes(19);
    expect(execute.mock.calls.map(([input]) => input.query)).not.toContain("c20");
    const calls = toolParts(answer.parts);
    expect(calls).toHaveLength(20);
    // История годна для строгих провайдеров: у каждого вызова есть результат.
    expect(calls.every((part) => part.state === "output-available" || part.state === "output-error")).toBe(true);
    expect(calls.at(-1)).toMatchObject({ toolCallId: "c20", state: "output-error", errorText: LAST_STEP_TOOL_REFUSAL });
    expect(answer.status).toBe("complete");
  });

  it("вызов с подтверждением на последнем шаге: подтверждения не спрашивают, инструмент не выполнен", async () => {
    const execute = vi.fn(async ({ query }: { query: string }) => `сделал ${query}`);
    const tools = {
      lookup: tool({ description: "Бронь", inputSchema: z.object({ query: z.string() }), needsApproval: ({ query }) => query === "c3", execute }),
    };
    const { answer } = await runTurn(lookupAlways(), { tools, maxSteps: 3 });

    expect(answer.status).toBe("complete");
    expect(execute.mock.calls.map(([input]) => input.query)).toEqual(["c1", "c2"]);
    expect(toolParts(answer.parts).at(-1)).toMatchObject({ toolCallId: "c3", state: "output-error", errorText: LAST_STEP_TOOL_REFUSAL });
  });
});

describe("runAgentTurn: ход упёрся в предел шагов — отметка в ответе и строка в журнале", () => {
  it("предел шагов: отметка в конце ответа, строка в журнале", async () => {
    const logError = vi.fn();
    const { answer } = await runTurn(lookupUntilToolsGone(), { tools: lookup().tools, maxSteps: 3, logError });

    expect(answer.parts.at(-1)).toEqual({ type: STEP_LIMIT_PART_TYPE, data: true });
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/^\[предел шагов\] чат=\S+ ответ=\S+ модель=\S+ шагов=3$/));
  });

  it("ход кончился раньше предела — отметки нет", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(reasoningAndTextParts(["ок"])) }) });
    const { answer } = await runTurn(model, { tools: lookup().tools, maxSteps: 3 });
    expect(answer.parts.some((part) => part.type === STEP_LIMIT_PART_TYPE)).toBe(false);
  });

  it("предел в один шаг: текстовый ответ — отметки нет, вызов инструмента — есть", async () => {
    const plain = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(reasoningAndTextParts(["ок"])) }) });
    expect((await runTurn(plain, { tools: lookup().tools, maxSteps: 1 })).answer.parts.some((part) => part.type === STEP_LIMIT_PART_TYPE)).toBe(false);
    const { answer } = await runTurn(lookupAlways(), { tools: lookup().tools, maxSteps: 1 });
    expect(answer.parts.at(-1)).toEqual({ type: STEP_LIMIT_PART_TYPE, data: true });
  });
});

/** Временная перегрузка провайдера: ход повторяет запрос почти сразу. */
function overloaded(): APICallError {
  return new APICallError({
    message: "перегрузка",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 503,
    responseHeaders: { "retry-after-ms": "10" },
    isRetryable: true,
  });
}
