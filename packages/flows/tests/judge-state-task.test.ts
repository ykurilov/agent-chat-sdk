import type { AskModelInput } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { judgeExchange, type AgentFlow, type JudgeExchangeInput, type JudgePort } from "../src";
import { createFlowJudge } from "../src/runtime/judge";
import { fixtureFlow } from "./flow-fixtures";

// Случай из eval приложения-генератора (corrections-refuse r3, клиент 2): условие «…и он уже получил свой маленький шаг»,
// а судья после второго ответа агента («сначала сходите к врачу, как к вам обращаться?») сказал «да» с 0,82.
// Судья видел только цель «Цель» — первую строку инструкции; что такое «маленький шаг» в этом состоянии, сказано ниже.

const CONDITION = "Понятны цель человека, его опыт и ограничения по здоровью — и он уже получил свой маленький шаг";
const TASK = "Узнай, к чему человек идёт и что ему мешает: что он уже пробовал и чем это закончилось, есть ли ограничения по здоровью. Когда картина ясна, дай маленький шаг под его ситуацию — одно действие, которое он может сделать сразу, — а не общий план.";

function leadMagnetFlow(): AgentFlow {
  const flow = fixtureFlow("sales-review");
  const base = flow.states[0]!;
  return { ...flow, start: "goal", anyState: { except: [], exits: [] }, states: [
    { ...base, id: "goal", title: "Цель", instructions: `Цель\n${TASK}`, exits: [{ id: "goal_done", to: "marathon", when: { type: "judge", text: CONDITION } }] },
    { ...base, id: "marathon", title: "Марафон", instructions: "Марафон\nПригласи в марафон «Лёгкое лето»: 4 недели, 4900 ₽.", exits: [] },
  ] };
}

/** Реплики, которые судья видел после второго ответа агента. */
const TRANSCRIPT: JudgeExchangeInput["transcript"] = [
  { role: "agent", text: "Привет! Я помощник тренера Олега Власова. Какая у вас цель: похудеть, подтянуться или что-то ещё?" },
  { role: "person", text: "Привет. Поясница болит от сидячей работы, хочу подтянуться и сладкое по вечерам убрать." },
  { role: "agent", text: "С поясницей сначала лучше сходить к врачу — при боли начинать с нагрузок без его совета не стоит. А как к вам обращаться?" },
];

const input = (): JudgeExchangeInput => ({ flow: leadMagnetFlow(), stateId: "goal", transcript: TRANSCRIPT, ownerId: "o", chatId: "c" });

function port(asked: AskModelInput[], answer: unknown): JudgePort {
  return {
    askModel: async (request) => { asked.push(request); return { text: "", object: answer, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } }; },
    recordUsage: async () => {},
    assertWithinLimit: async () => {},
  };
}

describe("судья видит задачу состояния и проверяет условие целиком", () => {
  it("decision-1: в state — задача состояния, в вопросе — «да» только когда выполнена каждая часть условия", async () => {
    const sent: any[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ answers: { goal_done: { type: "noul", noul: 0.2 } }, usage: { cost: 0.00001, input_tokens: 400, output_tokens: 8 } }));
    }) as typeof globalThis.fetch;
    const result = await judgeExchange(input(), { judge: { fallback: { providerId: "openrouter", modelId: "m" } }, port: () => port([], null), fetch, env: { OPENROUTER_API_KEY: "k" } });

    expect(result).toMatchObject({ stateId: "goal", transitions: [], status: "checked" });
    const { state, questions } = sent[0];
    expect(state.goal).toBe("Цель");
    expect(state.task).toBe(TASK);
    expect(state.conversation.map((message: { role: string }) => message.role)).toEqual(["agent", "human", "agent"]);
    const question: string = questions.goal_done.instructions;
    expect(question).toContain(CONDITION);
    expect(question).toMatch(/кажд\S* част/);
  });

  it("текстовый судья: задача состояния в запросе, правило «каждая часть» в его инструкции", async () => {
    const asked: AskModelInput[] = [];
    const model = { providerId: "test", modelId: "judge-test" };
    await judgeExchange(input(), { judge: { fallback: model, textModel: model }, port: () => port(asked, { verdicts: [{ exitId: "goal_done", probability: 0.1, reason: "опыт не узнали, шага не было" }] }) });

    expect(JSON.parse(asked[0]!.prompt as string).state.task).toBe(TASK);
    expect(asked[0]!.system).toMatch(/кажд\S* част/);
  });

  it("запасная модель: задача состояния в запросе, правило «каждая часть» в её инструкции", async () => {
    const asked: AskModelInput[] = [];
    await judgeExchange(input(), { judge: { fallback: { providerId: "test", modelId: "fallback" } }, port: () => port(asked, { met: [] }), env: {} });

    expect(JSON.parse(asked[0]!.prompt as string).task).toBe(TASK);
    expect(asked[0]!.system).toMatch(/кажд\S* част/);
  });

  it("у состояния одна строка инструкции — задачи в state нет", async () => {
    const sent: any[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ answers: { goal_done: { type: "noul", noul: 0.2 } }, usage: {} }));
    }) as typeof globalThis.fetch;
    const flow = leadMagnetFlow();
    flow.states[0]!.instructions = "Понять цель человека";
    await judgeExchange({ ...input(), flow }, { judge: { fallback: { providerId: "openrouter", modelId: "m" } }, port: () => port([], null), fetch, env: { OPENROUTER_API_KEY: "k" } });

    expect(sent[0].state.goal).toBe("Понять цель человека");
    expect("task" in sent[0].state).toBe(false);
  });
});
