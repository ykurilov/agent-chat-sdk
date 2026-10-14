import { describe, expect, it } from "vitest";
import { applyTransition, noteAgentAnswer, noteHumanMessage, startRun, type FlowRun, type Transition } from "../src/format";
import { fixtureFlow, MIN } from "./flow-fixtures";

const T0 = Date.UTC(2026, 9, 14, 9, 0);
const sales = fixtureFlow("sales-review");

/** Запись `FlowRun`, которую сохранил 0.48: без полей дней, касаний и конца разговора. */
const stored048 = (): FlowRun => ({
  state: "intro",
  enteredAt: T0,
  startedAt: T0,
  path: [{ state: "intro", at: T0, tags: [], from: null, exitId: null, decidedBy: "start" }],
  pausedClocks: {},
  notes: {},
  humanMessages: 2,
  agentAnswers: 2,
  sideQuestionAt: null,
  lastRejected: null,
  lastAgentAt: T0 + MIN,
  lastHumanAt: T0,
  chain: 0,
});

describe("FlowRun v2: старые записи", () => {
  it("запись 0.48 проходит все шаги, новых полей без нужды не появляется", () => {
    let run = noteHumanMessage(stored048(), T0 + 2 * MIN);
    run = noteAgentAnswer(run, T0 + 3 * MIN);
    run = applyTransition(sales, run, { from: "intro", to: "block", exitId: "intro_clear", decidedBy: "judge", tags: [], at: T0 + 4 * MIN });
    for (const key of ["dayAnchorAt", "dayCounts", "nudgeStep", "endedAt", "endReason"]) expect(run).not.toHaveProperty(key);
    expect(run.path.at(-1)).not.toHaveProperty("reason");
  });

  it("новый чат стартует без новых полей — как в 0.48", () => {
    expect(Object.keys(startRun(sales, T0))).toEqual(Object.keys(stored048()));
  });
});

describe("FlowRun v2: сообщение человека", () => {
  it("растит счёт сообщений за день сценария, новый день начинает счёт заново", () => {
    let run = noteHumanMessage(stored048(), T0, "2026-10-14");
    run = noteHumanMessage(run, T0 + MIN, "2026-10-14");
    expect(run.dayCounts).toEqual({ "2026-10-14": 2 });
    run = noteHumanMessage(run, T0 + 24 * 60 * MIN, "2026-10-15");
    expect(run.dayCounts).toEqual({ "2026-10-15": 1 });
  });

  it("сбрасывает ряд касаний на первый шаг", () => {
    const touched: FlowRun = { ...stored048(), nudgeStep: 2 };
    expect(noteHumanMessage(touched, T0 + MIN).nudgeStep).toBe(0);
  });
});

describe("FlowRun v2: причина перехода", () => {
  it("переход несёт причину словами — она попадает в путь", () => {
    const transition: Transition = {
      from: "intro",
      to: "block",
      exitId: "intro_clear",
      decidedBy: "timer",
      tags: [],
      at: T0 + MIN,
      reason: { kind: "timer", text: "нода длится 1 день" },
    };
    expect(applyTransition(sales, stored048(), transition).path.at(-1)?.reason).toEqual({ kind: "timer", text: "нода длится 1 день" });
  });

  it("конец разговора — поля записи", () => {
    const ended: FlowRun = { ...stored048(), endedAt: T0, endReason: "deadline", dayAnchorAt: T0, dayCounts: {}, nudgeStep: 0 };
    expect(ended.endReason).toBe("deadline");
  });
});
