import { describe, it, expect, vi } from "vitest";
import { judgeExchange, createAgentFlow, memoryFlowStore, FLOW_CHAIN_LIMIT, type AgentFlow, type JudgeExchangeInput, type JudgePort } from "../src";
import { fixtureFlow } from "./flow-fixtures";
const model = { modelId: "judge-test", providerId: "test" };
function scenario(): AgentFlow {
  const flow = fixtureFlow("sales-review");
  const base = flow.states[0]!;
  return { ...flow, start: "a", anyState: { except: [], exits: [] }, states: [
    { ...base, id: "a", exits: [{ id: "ab", to: "b", when: { type: "judge", text: "Согласие" } }] },
    { ...base, id: "b", exits: [] },
  ] };
}
function setup(flow = scenario()) {
  const ask = vi.fn(async (input: any) => ({ object: { verdicts: JSON.parse(input.prompt).conditions.map((c: any) => ({ exitId: c.exitId, probability: .9, reason: "Согласие подтверждено" })) }, text: "", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } }));
  const limit = vi.fn(async () => {});
  const port: JudgePort = { askModel: ask, assertWithinLimit: limit, recordUsage: vi.fn(async () => {}) };
  const options = { judge: { fallback: model, textModel: model }, port: () => port, logError: vi.fn() };
  const input: JudgeExchangeInput = { flow, stateId: "a", transcript: [{ role: "agent", text: "Согласны?" }, { role: "person", text: "Да" }], ownerId: "owner", chatId: "scope" };
  return { input, options, ask, limit, port };
}
describe("judgeExchange", () => {
  it("uses the configured judge, roles, threshold and preserves inputs", async () => {
    const s = setup(); const before = structuredClone(s.input);
    const result = await judgeExchange(s.input, s.options);
    expect(result.stateId).toBe("b"); expect(result.transitions[0]).toMatchObject({ from: "a", to: "b", exitId: "ab", probability: .9 });
    expect(s.input).toEqual(before); expect(s.limit).toHaveBeenCalledWith("owner", "scope");
    expect(JSON.parse(s.ask.mock.calls[0]![0].prompt).state.conversation.map((m: any) => m.role)).toEqual(["agent", "human"]);
    expect((await judgeExchange(s.input, { ...s.options, judge: { ...s.options.judge, threshold: .95 } })).transitions).toEqual([]);
  });
  it("keeps own exits before common exits and follows a bounded chain", async () => {
    const s = setup(); s.input.flow.anyState.exits = [{ id: "global", to: "a", when: { type: "judge", text: "Общее" } }];
    s.input.flow.states[1]!.exits = [{ id: "ba", to: "a", when: { type: "judge", text: "Назад" } }];
    const r = await judgeExchange(s.input, s.options);
    expect(r.transitions).toHaveLength(FLOW_CHAIN_LIMIT); expect(r.transitions[0]!.exitId).toBe("ab"); expect(r.status).toBe("chain_limit");
    s.input.flow.states[0]!.exits = [{ id: "noop", to: "b", when: { type: "event", event: "tool", name: "unused" } }];
    s.input.flow.anyState.exits[0]!.to = "b";
    expect((await judgeExchange(s.input, s.options)).transitions[0]!.exitId).toBe("global");
  });
  it("does not advance on judge failure or exhausted budget", async () => {
    const s = setup(); s.ask.mockRejectedValue(new Error("judge offline"));
    expect(await judgeExchange(s.input, s.options)).toMatchObject({ stateId: "a", status: "unchecked", transitions: [] });
    expect(s.options.logError).toHaveBeenCalled(); s.ask.mockClear(); s.limit.mockRejectedValue(new Error("budget"));
    expect((await judgeExchange(s.input, s.options)).transitions).toEqual([]); expect(s.ask).not.toHaveBeenCalled();
  });
  it("checks message once, ignores tools/data/timers and protects guarded exits", async () => {
    const s = setup(); s.input.flow.states[0]!.exits = [{ id: "msg", to: "b", when: { type: "event", event: "message" } }];
    s.input.flow.states[1]!.exits = [{ id: "msg2", to: "a", when: { type: "event", event: "message" } }];
    expect((await judgeExchange(s.input, s.options)).transitions.map(t => t.exitId)).toEqual(["msg"]); expect(s.ask).not.toHaveBeenCalled();
    const g = setup(); expect((await judgeExchange(g.input, { ...g.options, exitGuards: [{ flowId: g.input.flow.id, state: "a", exitId: "ab", requires: { key: "k", revision: "r" }, judgeWindow: "current-human-turn" }] })).transitions).toEqual([]);
  });
  it("ignores data and timers, and does not treat an agent reply as a person message", async () => {
    const s = setup(); s.input.flow.states[0]!.exits = [
      { id: "data", to: "b", when: { type: "data", field: "name", op: "filled" } },
      { id: "timer", to: "b", when: { type: "timer", from: "in_state", amount: 1, unit: "min" } },
      { id: "message", to: "b", when: { type: "event", event: "message" } },
    ];
    s.input.transcript = [{ role: "agent", text: "Ответ эксперта" }];
    expect(await judgeExchange(s.input, s.options)).toMatchObject({ stateId: "a", status: "checked", transitions: [] });
    expect(s.ask).not.toHaveBeenCalled();
  });
  it("uses decision settings and fallback through the same limit/accounting port", async () => {
    const s = setup(); const usage = vi.spyOn(s.port, "recordUsage");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { ab: { type: "noul", noul: .9 } }, usage: { cost: .001, input_tokens: 3, output_tokens: 1 } })));
    const options = { ...s.options, judge: { fallback: model, model: "custom-decision", threshold: .8, openrouter: { apiKey: "test-key" } }, fetch: fetcher as typeof fetch };
    expect((await judgeExchange(s.input, options)).stateId).toBe("b"); expect(usage).toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error("offline")); s.ask.mockResolvedValue({ object: { met: ["ab"] }, text: "", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } } as any);
    expect((await judgeExchange(s.input, options)).stateId).toBe("b");
    expect(s.ask.mock.calls[0]![0].model).toEqual(model);
  });
  it("aborts before applying a late judge result", async () => {
    const s = setup(); const c = new AbortController(); s.input.signal = c.signal;
    const original = s.ask.getMockImplementation()!; s.ask.mockImplementation(async input => { const result = await original(input); c.abort(); return result; });
    expect(await judgeExchange(s.input, s.options)).toMatchObject({ status: "aborted", transitions: [] });
  });
  it("handle shares judge settings without touching flow storage", async () => {
    const s = setup(); const store = memoryFlowStore();
    const handle = createAgentFlow({ store, loadFlow: async () => { throw Error("must not load"); }, judge: s.options.judge, logError: s.options.logError });
    handle.attach(s.port as any);
    expect((await handle.judgeExchange(s.input)).stateId).toBe("b");
    expect(s.ask).toHaveBeenCalledTimes(1);
  });
});
