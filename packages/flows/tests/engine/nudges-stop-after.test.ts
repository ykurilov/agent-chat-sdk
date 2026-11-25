import { describe, expect, it } from "vitest";
import type { AgentFlow, FlowNudges, FlowSchedule } from "../../src/format/flow-format";
import type { FlowRun } from "../../src/engine/flow-run";
import { nextMorning, nextNudge } from "../../src/engine/nudges";
import { dueReasons, FLOW_DEADLINE_EXIT, FLOW_GIVE_UP_EXIT, nextFirstMessageAfter, nextWake } from "../../src/engine/timers";
import { startRun } from "../../src/engine/run-updates";
import { checkFlow, compactFlow, flowJsonSchema, parseFlow } from "../../src/format";
import { fixtureFlow, fixtureJson, stateOf } from "../flow-fixtures";

// `nudges.stopAfter`: столько тишины человека — касания и утренние прекращаются, разговор не кончается.

const MSK = "Europe/Moscow";
const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);

const STOP: FlowNudges = {
  afterSilence: [{ amount: 1, unit: "d" }],
  dailyAt: ["19:00"],
  stopAfter: { amount: 3, unit: "d" },
};

function flowWith(schedule: Partial<FlowSchedule> & Record<string, unknown> = {}, edit?: (json: Record<string, any>) => void): AgentFlow {
  return fixtureFlow("sales-review", (json) => {
    json.anyState.exits = [];
    json.schedule = { dayStart: "09:00", nightFrom: "21:00", ...schedule };
    edit?.(json);
  });
}

const runAt = (flow: AgentFlow, startedAt: number, extra: Partial<FlowRun> = {}): FlowRun => ({ ...startRun(flow, startedAt), ...extra });

describe("nudges.stopAfter: касания до срока, разговор открыт", () => {
  const flow = flowWith({ nudges: STOP });

  it("касания идут, пока тишина человека меньше stopAfter; на сроке и после — ни касаний, ни конца", () => {
    const run = runAt(flow, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(14, 10) });
    expect(nextNudge(flow, run, msk(14, 10), MSK)).toEqual({ at: msk(15, 10), reason: { kind: "silence", step: 1 } });
    // После ряда — по часам: 19:00 16-го, тишина 2 д 9 ч.
    const afterRing = { ...run, lastAgentAt: msk(16, 10), nudgeStep: 1 };
    expect(nextNudge(flow, afterRing, msk(16, 10), MSK)).toEqual({ at: msk(16, 19), reason: { kind: "daily", at: "19:00" } });
    // Следующее 19:00 — 17-го, это позже 17-го 10:00 (3 дня тишины): касаний больше нет, конца тоже.
    const late = { ...run, lastAgentAt: msk(16, 19), nudgeStep: 1 };
    expect(nextNudge(flow, late, msk(16, 19), MSK)).toBeNull();
    expect(nextWake(flow, late, msk(16, 19), MSK)).toBeNull();
    expect(dueReasons(flow, late, msk(20, 10), MSK)).toEqual({ deadline: false, giveUp: false, exitId: null, reasons: [] });
  });

  it("срок касания до stopAfter, а ход только после него (сервер стоял) — касание не пишется", () => {
    const run = runAt(flow, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(16, 10), nudgeStep: 1 });
    expect(dueReasons(flow, run, msk(17, 11), MSK).reasons).toEqual([]);
    expect(nextFirstMessageAfter(flow, run, msk(17, 11), MSK)).toBeNull();
  });

  it("человек написал — отсчёт заново: касания снова идут", () => {
    const run = runAt(flow, msk(14, 10), { lastHumanAt: msk(20, 10), lastAgentAt: msk(20, 10, 1), nudgeStep: 0 });
    expect(nextNudge(flow, run, msk(20, 10, 1), MSK)).toEqual({ at: msk(21, 10, 1), reason: { kind: "silence", step: 1 } });
  });

  it("человек не писал ни разу — отсчёт от начала разговора; пауза и открытие заново двигают его, как у giveUpAfter", () => {
    const silent = runAt(flow, msk(14, 10), { lastAgentAt: msk(16, 19), nudgeStep: 1 });
    expect(nextNudge(flow, silent, msk(16, 19), MSK)).toBeNull();
    expect(nextNudge(flow, silent, msk(16, 19), MSK, { pausedUntil: msk(16, 12) })).toEqual({ at: msk(17, 19), reason: { kind: "daily", at: "19:00" } });
    const reopened = { ...silent, reopenedAt: msk(16, 12) };
    expect(nextNudge(flow, reopened, msk(16, 19), MSK)).toEqual({ at: msk(17, 19), reason: { kind: "daily", at: "19:00" } });
  });

  it("с giveUpAfter: касания кончаются по stopAfter, разговор — по giveUpAfter", () => {
    const both = flowWith({ nudges: { ...STOP, giveUpAfter: { amount: 10, unit: "d" } } });
    const run = runAt(both, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(16, 19), nudgeStep: 1 });
    expect(nextNudge(both, run, msk(16, 19), MSK)).toEqual({ at: msk(24, 10), reason: { kind: "give_up" } });
    expect(nextWake(both, run, msk(16, 19), MSK)).toEqual({ at: msk(24, 10), exitId: FLOW_GIVE_UP_EXIT });
  });

  it("утренние сообщения программы тоже прекращаются", () => {
    const program = flowWith({ lengthDays: 30, firstMessages: { morning: true }, nudges: STOP });
    const run = runAt(program, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(14, 10) });
    expect(nextMorning(program, run, MSK)).toBe(msk(15, 9));
    const later = { ...run, lastAgentAt: msk(17, 9) };
    expect(nextMorning(program, later, MSK)).toBeNull();
    expect(nextWake(program, later, msk(17, 9), MSK)?.exitId).not.toBe("@first");
  });

  it("stopAfter своих касаний ноды и уровня сценария (`nudges` в корне)", () => {
    const own = flowWith({}, (json) => (stateOf(json, "intro").nudges = STOP));
    const run = runAt(own, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(16, 19), nudgeStep: 1 });
    expect(nextNudge(own, run, msk(16, 19), MSK)).toBeNull();
    const root = fixtureFlow("sales-review", (json) => ((json.anyState.exits = []), (json.nudges = STOP)));
    expect(nextNudge(root, runAt(root, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(16, 19), nudgeStep: 1 }), msk(16, 19), MSK)).toBeNull();
  });

  it("прощание по сроку программы приходит и после stopAfter", () => {
    const program = flowWith({ lengthDays: 5, firstMessages: { morning: true }, nudges: STOP });
    const run = runAt(program, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(17, 9) });
    expect(nextWake(program, run, msk(17, 9), MSK)?.exitId).toBe(FLOW_DEADLINE_EXIT);
    expect(dueReasons(program, run, msk(19, 9), MSK).deadline).toBe(true);
  });

  it("свои касания ноды без days и своего stopAfter общим stopAfter не гасятся", () => {
    const own = flowWith({ nudges: STOP }, (json) => (stateOf(json, "intro").nudges = { afterSilence: [{ amount: 1, unit: "d" }], dailyAt: ["19:00"] }));
    const run = runAt(own, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(25, 19), nudgeStep: 1 });
    expect(nextNudge(own, run, msk(25, 19), MSK)).toEqual({ at: msk(26, 19), reason: { kind: "daily", at: "19:00" } });
  });

  it("без stopAfter — как раньше: касания по часам идут сколько угодно", () => {
    const plain = flowWith({ nudges: { afterSilence: [{ amount: 1, unit: "d" }], dailyAt: ["19:00"] } });
    const run = runAt(plain, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(25, 19), nudgeStep: 1 });
    expect(nextNudge(plain, run, msk(25, 19), MSK)).toEqual({ at: msk(26, 19), reason: { kind: "daily", at: "19:00" } });
  });
});

describe("nudges.stopAfter в формате", () => {
  const parsed = (json: unknown): AgentFlow => {
    const result = parseFlow(json);
    if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
    return result.flow;
  };

  it("разбирается на трёх уровнях и сжимается обратно", () => {
    const json = fixtureJson("sales-review");
    json.nudges = STOP;
    json.schedule = { dayStart: "09:00", nudges: STOP };
    stateOf(json, "intro").nudges = { ...STOP, days: 1 };
    const flow = parsed(json);
    expect(flow.nudges?.stopAfter).toEqual({ amount: 3, unit: "d" });
    expect(flow.schedule?.nudges?.stopAfter).toEqual({ amount: 3, unit: "d" });
    expect(parsed(compactFlow(flow))).toEqual(flow);
  });

  it("JSON Schema знает поле", () => {
    expect(JSON.stringify(flowJsonSchema())).toContain("stopAfter");
  });

  it("checkFlow: stopAfter дольше giveUpAfter — находка; короче — нет", () => {
    const catalog = { tools: ["give_booking_link", "call_expert"], events: ["paid"], widgets: ["booking_link"] };
    const longer = checkFlow(fixtureFlow("sales-review", (json) => (json.nudges = { ...STOP, stopAfter: { amount: 5, unit: "d" }, giveUpAfter: { amount: 2, unit: "d" } })), catalog);
    expect(longer).toContainEqual(expect.objectContaining({ code: "nudges_stop_after_give_up" }));
    const own = checkFlow(fixtureFlow("sales-review", (json) => (stateOf(json, "intro").nudges = { ...STOP, stopAfter: { amount: 72, unit: "h" }, giveUpAfter: { amount: 1, unit: "d" } })), catalog);
    expect(own).toContainEqual(expect.objectContaining({ level: "warning", code: "nudges_stop_after_give_up", place: { stateId: "intro" } }));
    const fine = checkFlow(fixtureFlow("sales-review", (json) => (json.nudges = { ...STOP, giveUpAfter: { amount: 10, unit: "d" } })), catalog);
    expect(fine).not.toContainEqual(expect.objectContaining({ code: "nudges_stop_after_give_up" }));
  });
});
