import { readFileSync } from "node:fs";
import type { AskModelInput } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { activeExits, stateById } from "../src/engine/flow-graph";
import type { JudgeMessage } from "../src/runtime/flow-types";
import { createFlowJudge } from "../src/runtime/judge";
import { fixtureFlow, type FixtureName } from "./flow-fixtures";

interface JudgeCase {
  id: string;
  flow: FixtureName;
  state: string;
  exitId: string;
  expected: boolean;
  messages: JudgeMessage[];
}

const { cases } = JSON.parse(readFileSync(new URL("./judge-cases.json", import.meta.url), "utf8")) as { cases: JudgeCase[] };

/** Условие и цель состояния берутся из сценария, а не копируются в набор. */
function resolve(testCase: JudgeCase) {
  const flow = fixtureFlow(testCase.flow);
  const state = stateById(flow, testCase.state);
  if (!state) throw new Error(`${testCase.id}: нет состояния ${testCase.state}`);
  const active = activeExits(flow, state).find(({ exit }) => exit.id === testCase.exitId);
  if (!active || active.exit.when.type !== "judge") throw new Error(`${testCase.id}: ${testCase.exitId} — не условие словами состояния ${testCase.state}`);
  return { goal: state.instructions.split("\n")[0]!, condition: active.exit.when.text };
}

describe("набор судьи для SC-004", () => {
  it("20 случаев: 10 «выполнено» и 10 «нет», у каждого уникальный номер", () => {
    expect(cases).toHaveLength(20);
    expect(cases.filter((testCase) => testCase.expected)).toHaveLength(10);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(20);
  });

  it("покрывает все три примера прототипа", () => {
    expect(new Set(cases.map((testCase) => testCase.flow))).toEqual(new Set(["sales-review", "shop-support", "sheets-lesson"]));
  });

  it.each(cases.map((testCase) => [testCase.id, testCase] as const))("%s: условие есть в сценарии, у человека есть последнее слово", (_id, testCase) => {
    const { condition } = resolve(testCase);
    expect(condition.length).toBeGreaterThan(0);
    expect(testCase.messages.at(-1)!.role).toBe("human");
  });

  it("судья на поддельном decision-1 решает все 20 случаев верно (проводка: условие, цель, реплики, порог)", async () => {
    let correct = 0;
    for (const testCase of cases) {
      const { goal, condition } = resolve(testCase);
      const lastHuman = testCase.messages.at(-1)!.text;
      // Поддельный decision-1 «умный» ровно настолько, чтобы видеть: в запрос попали и условие, и последняя реплика.
      const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { state: { goal: string; conversation: JudgeMessage[] }; questions: Record<string, { instructions: string }> };
        const saw = body.questions[testCase.exitId]?.instructions.includes(condition) && body.state.goal === goal && body.state.conversation.at(-1)?.text === lastHuman;
        const probability = saw ? (testCase.expected ? 0.93 : 0.06) : 0.5;
        return new Response(JSON.stringify({ answers: { [testCase.exitId]: { type: "noul", noul: probability } }, usage: { cost: 0.00002, input_tokens: 400, output_tokens: 8 } }));
      }) as typeof globalThis.fetch;
      const judge = createFlowJudge(
        { fallback: { providerId: "openrouter", modelId: "m" } },
        () => ({ askModel: async (_input: AskModelInput) => { throw new Error("запасная не нужна"); }, recordUsage: async () => {}, assertWithinLimit: async () => {} }),
        { fetch, env: { OPENROUTER_API_KEY: "k" } },
      );
      const verdict = await judge.checkClaim({ ownerId: "o", chatId: "c", exitId: testCase.exitId, condition, goal, messages: testCase.messages });
      if (verdict?.confirmed === testCase.expected) correct += 1;
    }
    expect(correct).toBe(20);
  });
});
