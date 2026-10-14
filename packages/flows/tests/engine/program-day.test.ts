import { describe, expect, it } from "vitest";
import type { FlowSchedule, ProgramDayTimerCondition } from "../../src/format/flow-format";
import type { FlowRun } from "../../src/engine/flow-run";
import { flowDay, programDayDue } from "../../src/engine/flow-days";
import { describeCondition } from "../../src/engine/next-transition";
import { nextDue, timerDueAt } from "../../src/engine/timers";
import { startRun } from "../../src/engine/run-updates";
import { fixtureFlow } from "../flow-fixtures";

// Таймер «наступил день N программы» (`program_day`): срок — начало дня N по той же нумерации, что `flowDay`.
// 13.10.2026 — вторник. Москва — UTC+3, Новосибирск — UTC+7.

const MSK = "Europe/Moscow";
const NSK = "Asia/Novosibirsk";
const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);
const nsk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 7, minute);

const schedule = (extra: Partial<FlowSchedule> = {}): FlowSchedule => ({ dayStart: "09:00", nightFrom: "21:00", lateStartHours: 3, farewellOnDeadline: false, ...extra });
const run = (startedAt: number, extra: Partial<FlowRun> = {}): FlowRun => ({ ...startRun(fixtureFlow("sales-review"), startedAt), ...extra });
const day = (n: number): ProgramDayTimerCondition => ({ type: "timer", from: "program_day", day: n });

/** Срок совпадает с нумерацией `flowDay`: в момент срока идёт день N, за миг до него — ещё N−1. */
function sameAsFlowDay(subject: FlowRun, n: number, timeZone: string, rules: FlowSchedule) {
  const due = programDayDue(subject, n, timeZone, rules);
  expect(flowDay(subject, due, timeZone, rules).day).toBe(n);
  expect(flowDay(subject, due - 1, timeZone, rules).day).toBe(n - 1);
}

describe("programDayDue: начало дня N программы", () => {
  it("старт днём: день 3 — 09:00 послезавтра, где бы ни была нода; день 1 — уже наступил", () => {
    const started = run(msk(13, 15));
    expect(programDayDue(started, 3, MSK, schedule())).toBe(msk(15, 9));
    expect(programDayDue({ ...started, enteredAt: msk(13, 16) }, 3, MSK, schedule())).toBe(msk(15, 9));
    expect(programDayDue({ ...started, enteredAt: msk(14, 11) }, 3, MSK, schedule())).toBe(msk(15, 9));
    expect(programDayDue(started, 1, MSK, schedule())).toBe(msk(13, 9));
    sameAsFlowDay(started, 3, MSK, schedule());
  });

  it("поздний старт: до ночи меньше 3 ч — первый день завтра, день 3 сдвигается вместе с ним", () => {
    const late = run(msk(13, 19));
    expect(programDayDue(late, 3, MSK, schedule())).toBe(msk(16, 9));
    sameAsFlowDay(late, 3, MSK, schedule());
    sameAsFlowDay(late, 1, MSK, schedule());
  });

  it("ночной старт относится к ближайшему утру", () => {
    expect(programDayDue(run(msk(13, 23)), 3, MSK, schedule())).toBe(msk(16, 9));
    expect(programDayDue(run(msk(14, 2)), 3, MSK, schedule())).toBe(msk(16, 9));
    sameAsFlowDay(run(msk(14, 2)), 3, MSK, schedule());
  });

  it("пояс сменился в первый день — день 3 по новому поясу; позже — номер дня сохраняется", () => {
    const firstDay = run(msk(14, 10), { dayAnchorAt: msk(14, 9), lastHumanAt: msk(14, 10) });
    expect(programDayDue(firstDay, 3, NSK, schedule())).toBe(nsk(16, 9));
    sameAsFlowDay(firstDay, 3, NSK, schedule());

    const thirdDay = run(msk(14, 10), { dayAnchorAt: msk(14, 9), lastHumanAt: msk(16, 12) });
    expect(programDayDue(thirdDay, 4, NSK, schedule())).toBe(nsk(17, 9));
  });

  it("своё начало дня: dayStart 07:30", () => {
    const early = schedule({ dayStart: "07:30" });
    expect(programDayDue(run(msk(13, 15)), 2, MSK, early)).toBe(msk(14, 7, 30));
    sameAsFlowDay(run(msk(13, 15)), 2, MSK, early);
  });
});

describe("timerDueAt и nextDue: «наступил день N»", () => {
  const programFlow = (withSchedule = true) =>
    fixtureFlow("sales-review", (json) => {
      if (withSchedule) json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 5 };
      json.states.find((state: { id: string }) => state.id === "block").exits.push({ id: "block_day3", when: day(3), to: "offer" });
    });

  it("без «Дней и времени» таймер не идёт", () => {
    expect(timerDueAt(day(3), run(msk(13, 15)), MSK, programFlow().schedule)).toBe(msk(15, 9));
    expect(timerDueAt(day(3), run(msk(13, 15)), MSK)).toBeNull();
    expect(nextDue(programFlow(false), run(msk(13, 15), { state: "block", lastAgentAt: null }), msk(13, 16), MSK)).toBeNull();
  });

  it("быстрый клиент вошёл в ноду в день 1 — срок в начале дня 3, а не дня 2", () => {
    const entered = run(msk(13, 15), { state: "block", enteredAt: msk(13, 16) });
    expect(nextDue(programFlow(), { ...entered, lastAgentAt: null }, msk(13, 16), MSK)).toEqual({ at: msk(15, 9), exitId: "block_day3" });
  });

  it("вошёл в день 4 — срок уже наступил: выход сразу", () => {
    const entered = run(msk(13, 15), { state: "block", enteredAt: msk(16, 12), lastAgentAt: null });
    const due = nextDue(programFlow(), entered, msk(16, 12), MSK);
    expect(due).toEqual({ at: msk(15, 9), exitId: "block_day3" });
    expect(due!.at).toBeLessThan(msk(16, 12));
  });

  it("describeCondition: «наступил день N»", () => {
    expect(describeCondition(programFlow(), day(3))).toBe("наступил день 3");
  });
});
