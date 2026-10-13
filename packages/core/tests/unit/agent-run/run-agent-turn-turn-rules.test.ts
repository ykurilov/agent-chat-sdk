import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LAST_STEP_NOTE, TURN_BUDGET_NOTE } from "../../../src/agent-run/last-step";
import { finishPart, mockCatalog, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn, textOf } from "../support/turn-fixtures";

const callLookup = (id: string, calls = 1): LanguageModelV4StreamPart[] => [
  streamStart,
  ...Array.from({ length: calls }, (_, index) => ({
    type: "tool-call" as const,
    toolCallId: `${id}-${index}`,
    toolName: "lookup",
    input: JSON.stringify({ query: id }),
  })),
  finishPart("tool-calls"),
];

/** Модель: пока ей дают инструменты, вызывает поиск (`callsPerStep` вызовов за шаг); без инструментов пишет итог. */
function lookupUntilToolsGone(callsPerStep = 1) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async ({ toolChoice }) => {
      call += 1;
      return { stream: streamOf(toolChoice?.type === "none" ? reasoningAndTextParts(["Итог: что успел."]) : callLookup(`c${call}`, callsPerStep)) };
    },
  });
}

const lookupTools = () => {
  const execute = vi.fn(async ({ query }: { query: string }) => `нашёл ${query}`);
  return { execute, tools: { lookup: tool({ description: "Поиск", inputSchema: z.object({ query: z.string() }), execute }) } };
};

const lastText = (prompt: MockLanguageModelV4["doStreamCalls"][number]["prompt"]) => {
  const last = prompt.at(-1)!;
  return last.role === "user" && typeof last.content !== "string" ? last.content.map((part) => (part.type === "text" ? part.text : "")).join("") : null;
};

// Шаг заглушки: 100 токенов входа и 30 выхода; по 1000 $ за миллион — 0,13 $ за шаг.
const pricing = { inputPerMillion: 1000, outputPerMillion: 1000, cachedInputPerMillion: 1000 };

describe("runAgentTurn: потолки хода — ход кончается итогом, а не обрывом", () => {
  it("maxToolCalls: дошли до потолка вызовов — следующий шаг без инструментов и с пометкой о бюджете", async () => {
    const model = lookupUntilToolsGone();
    const { execute, tools } = lookupTools();

    const { answer } = await runTurn(model, { tools, turnRules: { maxToolCalls: 2 } });

    expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual(["auto", "auto", "none"]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(lastText(model.doStreamCalls[2]!.prompt)).toBe(TURN_BUDGET_NOTE);
    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("Итог: что успел.");
    expect(JSON.stringify(answer.parts)).not.toContain(TURN_BUDGET_NOTE);
  });

  it("maxToolCalls считает вызовы, а не шаги: три вызова за шаг при потолке 2 — уже второй шаг итоговый", async () => {
    const model = lookupUntilToolsGone(3);
    await runTurn(model, { tools: lookupTools().tools, turnRules: { maxToolCalls: 2 } });
    expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual(["auto", "none"]);
  });

  it("maxCostUsd: стоимость хода по ценам профиля дошла до потолка — следующий шаг итоговый", async () => {
    const model = lookupUntilToolsGone();
    const catalog = mockCatalog({ mock: model }, { pricing });

    await runTurn(model, { catalog, tools: lookupTools().tools, turnRules: { maxCostUsd: 0.2 } });

    // 0,13 после первого шага — меньше потолка; 0,26 после второго — потолок.
    expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual(["auto", "auto", "none"]);
    expect(lastText(model.doStreamCalls[2]!.prompt)).toBe(TURN_BUDGET_NOTE);
  });

  it("потолок раньше лимита шагов — пометка о бюджете, а не о шагах; кэш: инструменты те же, начало запроса то же", async () => {
    const model = lookupUntilToolsGone();
    await runTurn(model, { tools: lookupTools().tools, maxSteps: 10, turnRules: { maxToolCalls: 1 } });

    const [first, last] = model.doStreamCalls;
    expect(model.doStreamCalls).toHaveLength(2);
    expect(last!.tools).toEqual(first!.tools);
    expect(last!.prompt.slice(0, first!.prompt.length)).toEqual(first!.prompt);
    expect(JSON.stringify(last!.prompt)).not.toContain(LAST_STEP_NOTE);
  });

  it("потолок не достигнут — ход как без правил", async () => {
    const model = lookupUntilToolsGone();
    const catalog = mockCatalog({ mock: model }, { pricing });
    await runTurn(model, { catalog, tools: lookupTools().tools, maxSteps: 3, turnRules: { maxCostUsd: 100, maxToolCalls: 100 } });
    expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual(["auto", "auto", "none"]);
    expect(lastText(model.doStreamCalls[2]!.prompt)).toBe(LAST_STEP_NOTE);
  });

  it("модель без цены у провайдера: потолок денег не действует, потолок вызовов — действует", async () => {
    const model = lookupUntilToolsGone();
    await runTurn(model, { tools: lookupTools().tools, maxSteps: 4, turnRules: { maxCostUsd: 0.0001, maxToolCalls: 3 } });
    expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual(["auto", "auto", "auto", "none"]);
  });
});
