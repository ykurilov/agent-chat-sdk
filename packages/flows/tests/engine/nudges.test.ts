import { describe, expect, it } from "vitest";
import type { AgentFlow, FlowNudges, FlowSchedule } from "../../src/format/flow-format";
import type { FlowRun } from "../../src/engine/flow-run";
import { nextMorning, nextNudge } from "../../src/engine/nudges";
import { dueReasons, FLOW_DEADLINE_EXIT, FLOW_FIRST_EXIT, FLOW_GIVE_UP_EXIT, nextWake } from "../../src/engine/timers";
import { startRun, withoutUndeliveredTouch } from "../../src/engine/run-updates";
import { fixtureFlow, stateOf } from "../flow-fixtures";

// T701/T702: касания и утреннее — чистый счёт сроков. 14.10.2026 — среда, Москва UTC+3.

const MSK = "Europe/Moscow";
const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);

const REMINDERS: FlowNudges = {
  afterSilence: [
    { amount: 15, unit: "min" },
    { amount: 1, unit: "h" },
  ],
  dailyAt: ["09:00", "19:00"],
  giveUpAfter: { amount: 3, unit: "d" },
};

/** Сценарий без своих таймеров тишины: касания — общие или ноды. */
function flowWith(schedule: Partial<FlowSchedule> & Record<string, unknown> = {}, edit?: (json: Record<string, any>) => void): AgentFlow {
  return fixtureFlow("sales-review", (json) => {
    json.anyState.exits = [];
    json.schedule = { dayStart: "09:00", nightFrom: "21:00", ...schedule };
    edit?.(json);
  });
}

const runAt = (flow: AgentFlow, startedAt: number, extra: Partial<FlowRun> = {}): FlowRun => ({ ...startRun(flow, startedAt), ...extra });

describe("nextNudge: ряд касаний по тишине, часы, «не завершил»", () => {
  const flow = flowWith({ nudges: REMINDERS });

  it("агент ответил и молчат — 15 мин, после первого касания — 1 ч от него", () => {
    const run = runAt(flow, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(14, 10) });
    expect(nextNudge(flow, run, msk(14, 10), MSK)).toEqual({ at: msk(14, 10, 15), reason: { kind: "silence", step: 1 } });
    const afterFirst = { ...run, lastAgentAt: msk(14, 10, 15), nudgeStep: 1 };
    expect(nextNudge(flow, afterFirst, msk(14, 10, 15), MSK)).toEqual({ at: msk(14, 11, 15), reason: { kind: "silence", step: 2 } });
  });

  it("ряд кончился — по часам dailyAt (ближайшие после последнего касания), затем «не завершил» через 3 дня тишины человека", () => {
    const run = runAt(flow, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(14, 11, 15), nudgeStep: 2 });
    expect(nextNudge(flow, run, msk(14, 11, 15), MSK)).toEqual({ at: msk(14, 19), reason: { kind: "daily", at: "19:00" } });
    const evening = { ...run, lastAgentAt: msk(14, 19) };
    expect(nextNudge(flow, evening, msk(14, 19), MSK)).toEqual({ at: msk(15, 9), reason: { kind: "daily", at: "09:00" } });
    const late = { ...run, lastAgentAt: msk(17, 9) };
    expect(nextNudge(flow, late, msk(17, 9), MSK)).toEqual({ at: msk(17, 10), reason: { kind: "give_up" } });
  });

  it("человек ответил после агента, агент ещё не писал, разговор закончен — касаний нет", () => {
    const base = runAt(flow, msk(14, 10));
    expect(nextNudge(flow, { ...base, lastAgentAt: msk(14, 10), lastHumanAt: msk(14, 10, 5) }, msk(14, 10, 5), MSK)).toBeNull();
    expect(nextNudge(flow, base, msk(14, 10), MSK)).toBeNull();
    expect(nextNudge(flow, { ...base, lastAgentAt: msk(14, 10), endedAt: msk(14, 10) }, msk(14, 10), MSK)).toBeNull();
  });

  it("свои касания ноды главнее общих; «off» — касаний нет", () => {
    const own = flowWith({ nudges: REMINDERS }, (json) => {
      stateOf(json, "intro").nudges = { afterSilence: [{ amount: 2, unit: "h" }] };
      stateOf(json, "block").nudges = "off";
    });
    const run = runAt(own, msk(14, 10), { lastAgentAt: msk(14, 10) });
    expect(nextNudge(own, run, msk(14, 10), MSK)).toEqual({ at: msk(14, 12), reason: { kind: "silence", step: 1 } });
    expect(nextNudge(own, { ...run, state: "block" }, msk(14, 10), MSK)).toBeNull();
  });

  it("пауза сотрудника: тишина считается от её конца (ответ сотрудника — слова агента)", () => {
    const run = runAt(flow, msk(14, 10), { lastAgentAt: msk(14, 10) });
    expect(nextNudge(flow, run, msk(14, 13), MSK, { pausedUntil: msk(14, 13) })).toEqual({ at: msk(14, 13, 15), reason: { kind: "silence", step: 1 } });
  });

  it("«не завершил»: тишина человека считается и от конца паузы сотрудника (его слова — слова агента, FR-507)", () => {
    const run = runAt(flow, msk(14, 10), { lastHumanAt: msk(14, 10), lastAgentAt: msk(17, 9), nudgeStep: 2 });
    const staff = { pausedUntil: msk(16, 12) };
    expect(nextNudge(flow, run, msk(17, 9), MSK, staff)).toEqual({ at: msk(17, 19), reason: { kind: "daily", at: "19:00" } });
    expect(dueReasons(flow, run, msk(17, 10), MSK, staff).giveUp).toBe(false);
    expect(nextWake(flow, run, msk(17, 10), MSK, staff)?.exitId).not.toBe(FLOW_GIVE_UP_EXIT);
    const later = { ...run, lastAgentAt: msk(19, 9) };
    expect(nextNudge(flow, later, msk(19, 9), MSK, staff)).toEqual({ at: msk(19, 12), reason: { kind: "give_up" } });
  });

  it("человек писал без ответа (ночь, рамка, пауза) — касаний по тишине нет", () => {
    const run = runAt(flow, msk(14, 10), { lastAgentAt: msk(14, 10) });
    expect(nextNudge(flow, run, msk(14, 10), MSK, { unanswered: 2 })).toBeNull();
  });
});

describe("nextMorning: утреннее сообщение в начале дня", () => {
  it("по умолчанию — когда задан срок: следующее начало дня после последнего ответа агента", () => {
    const flow = flowWith({ lengthDays: 3 });
    const run = runAt(flow, msk(13, 15), { lastAgentAt: msk(13, 15), lastHumanAt: msk(13, 15) });
    expect(nextMorning(flow, run, MSK)).toBe(msk(14, 9));
    expect(nextMorning(flowWith(), run, MSK)).toBeNull();
    expect(nextMorning(flowWith({ lengthDays: 3, firstMessages: { morning: false } }), run, MSK)).toBeNull();
    expect(nextMorning(flowWith({ firstMessages: { morning: true } }), run, MSK)).toBe(msk(14, 9));
  });

  it("человек писал меньше чем за 3 ч до утра — утреннее завтра; порог настраивается", () => {
    const flow = flowWith({ lengthDays: 3 });
    const run = runAt(flow, msk(13, 15), { lastAgentAt: msk(13, 15), lastHumanAt: msk(14, 6, 30) });
    expect(nextMorning(flow, run, MSK)).toBe(msk(15, 9));
    const short = flowWith({ lengthDays: 3, firstMessages: { skipMorningIfHumanWithinMin: 60 } });
    expect(nextMorning(short, run, MSK)).toBe(msk(14, 9));
  });

  it("утреннее не дошло — следующее утро, а не то же сразу (FR-309)", () => {
    const flow = flowWith({ lengthDays: 3 });
    const run = runAt(flow, msk(13, 15), { lastAgentAt: msk(13, 15) });
    expect(nextMorning(flow, run, MSK, { undeliveredAt: msk(14, 9) })).toBe(msk(15, 9));
  });

  it("утро попало на паузу сотрудника — пропускается до следующего", () => {
    const flow = flowWith({ lengthDays: 3 });
    const run = runAt(flow, msk(13, 15), { lastAgentAt: msk(13, 15) });
    expect(nextMorning(flow, run, MSK, { pausedUntil: msk(14, 11) })).toBe(msk(15, 9));
    expect(nextMorning(flow, run, MSK, { pausedUntil: msk(13, 18) })).toBe(msk(14, 9));
  });
});

describe("withoutUndeliveredTouch: недоставленное касание не засчитано (FR-309)", () => {
  const flow = flowWith({ nudges: REMINDERS });
  const touch = { answerId: "a2", at: msk(14, 10, 15), lastAgentAt: msk(14, 10), nudgeStep: 0, agentAnswers: 1 };
  const run = runAt(flow, msk(14, 10), { lastAgentAt: msk(14, 10, 15), nudgeStep: 1, agentAnswers: 2, touch });

  it("ответ касания помечен — счёт как до него, срок не раньше касания; повторный откат тот же", () => {
    const { run: reverted, undeliveredAt } = withoutUndeliveredTouch(run, new Set(["a2"]));
    expect(reverted).toMatchObject({ lastAgentAt: msk(14, 10), nudgeStep: 0, agentAnswers: 1 });
    expect(reverted.touch).toBeUndefined();
    expect(undeliveredAt).toBe(msk(14, 10, 15));
    expect(withoutUndeliveredTouch(reverted, new Set(["a2"])).run).toEqual(reverted);
    expect(nextNudge(flow, reverted, msk(14, 10, 15), MSK, { undeliveredAt })).toEqual({ at: msk(14, 10, 30), reason: { kind: "silence", step: 1 } });
  });

  it("пометки нет или помечен другой ответ — ничего не меняется", () => {
    expect(withoutUndeliveredTouch(run, new Set())).toEqual({ run, undeliveredAt: null });
    expect(withoutUndeliveredTouch(run, new Set(["a1"]))).toEqual({ run, undeliveredAt: null });
  });
});

describe("nextWake и dueReasons: один срок — один ход со всеми причинами", () => {
  it("при равенстве: «срок вышел» > таймер ноды > «пишет первым»", () => {
    const flow = flowWith({ lengthDays: 1 }, (json) => stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" }));
    const run = runAt(flow, msk(13, 15), { lastAgentAt: msk(13, 15) });
    expect(nextWake(flow, run, msk(13, 15), MSK)).toEqual({ at: msk(14, 9), exitId: FLOW_DEADLINE_EXIT });
    const long = flowWith({ lengthDays: 3 }, (json) => stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" }));
    expect(nextWake(long, runAt(long, msk(13, 15), { lastAgentAt: msk(13, 15) }), msk(13, 15), MSK)).toEqual({ at: msk(14, 9), exitId: "intro_day" });
    const morningOnly = flowWith({ lengthDays: 3 });
    expect(nextWake(morningOnly, runAt(morningOnly, msk(13, 15), { lastAgentAt: msk(13, 15) }), msk(13, 15), MSK)).toEqual({ at: msk(14, 9), exitId: FLOW_FIRST_EXIT });
  });

  it("утро и переход ноды в один момент — одна запись: переход и утреннее", () => {
    const flow = flowWith({ lengthDays: 3 }, (json) => stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" }));
    const run = runAt(flow, msk(13, 15), { lastAgentAt: msk(13, 15) });
    expect(dueReasons(flow, run, msk(14, 9), MSK)).toEqual({ deadline: false, giveUp: false, exitId: "intro_day", reasons: [{ kind: "morning" }] });
  });

  it("ночные сообщения без ответа — причина «ответь на накопленное» в начале дня, вместе с утренним", () => {
    const flow = flowWith({ lengthDays: 3 });
    const run = runAt(flow, msk(13, 15), { lastAgentAt: msk(13, 15), lastHumanAt: msk(13, 15) });
    expect(nextWake(flow, run, msk(13, 23), MSK, { unanswered: 2 })).toEqual({ at: msk(14, 9), exitId: FLOW_FIRST_EXIT });
    expect(dueReasons(flow, run, msk(14, 9), MSK, { unanswered: 2 }).reasons).toEqual([{ kind: "morning" }, { kind: "night_messages", count: 2 }]);
  });

  it("касание по тишине наступило — причина с номером шага; «не завершил» — без причин", () => {
    const flow = flowWith({ nudges: REMINDERS });
    const run = runAt(flow, msk(14, 10), { lastAgentAt: msk(14, 10), lastHumanAt: msk(14, 10) });
    expect(nextWake(flow, run, msk(14, 10), MSK)).toEqual({ at: msk(14, 10, 15), exitId: FLOW_FIRST_EXIT });
    expect(dueReasons(flow, run, msk(14, 10, 15), MSK).reasons).toEqual([{ kind: "silence", step: 1 }]);
    const silent = { ...run, lastAgentAt: msk(17, 9), nudgeStep: 2 };
    expect(nextWake(flow, silent, msk(17, 9), MSK)).toEqual({ at: msk(17, 10), exitId: FLOW_GIVE_UP_EXIT });
    expect(dueReasons(flow, silent, msk(17, 10), MSK)).toEqual({ deadline: false, giveUp: true, exitId: null, reasons: [] });
  });

  it("ничего не наступило — пусто", () => {
    const flow = flowWith({ nudges: REMINDERS });
    const run = runAt(flow, msk(14, 10), { lastAgentAt: msk(14, 10) });
    expect(dueReasons(flow, run, msk(14, 10, 5), MSK)).toEqual({ deadline: false, giveUp: false, exitId: null, reasons: [] });
  });
});
