import { describe, expect, it } from "vitest";
import { applyTransition, migrateRun, nextTransition, noteAgentAnswer, startRun, type AgentFlow, type FlowRun } from "../src/format";
import { MIN, fixtureFlow } from "./flow-fixtures";

const T0 = Date.UTC(2026, 9, 13, 6, 0);
const v1 = fixtureFlow("sales-review");
/** Версия 2: «Работа с сомнениями» и «Поиск затыка» удалены, заметка «Причина сомнений» убрана, появилась «Бюджет». */
const v2 = fixtureFlow("sales-review", (json) => {
  json.states = json.states.filter((state: { id: string }) => state.id !== "doubts" && state.id !== "block");
  json.states.find((state: { id: string }) => state.id === "intro").exits[0].to = "offer";
  for (const state of json.states) {
    for (const exit of state.exits ?? []) if (exit.to === "doubts") exit.to = "soft";
  }
  json.chatNotes = json.chatNotes.filter((note: { id: string }) => note.id !== "doubt");
  json.chatNotes.push({ id: "budget", name: "Бюджет" });
});

function walk(flow: AgentFlow, states: string[]): FlowRun {
  let run = startRun(flow, T0);
  states.forEach((state, index) => {
    const at = T0 + (index + 1) * MIN;
    run = noteAgentAnswer(applyTransition(flow, run, { from: run.state, to: state, exitId: "test", decidedBy: "event", tags: [], at }), at);
  });
  return run;
}

describe("перевод чата на новую версию (В11)", () => {
  it("то же состояние есть — часы, путь и счётчики целы, заметки — по совпадающим id", () => {
    const run = { ...walk(v1, ["block", "offer"]), notes: { main_block: "Не доверяют", doubt: "Дорого" }, pausedClocks: {} };
    const moved = migrateRun(run, v2, {}, T0 + 10 * MIN);
    expect(moved).toEqual({ ...run, notes: { main_block: "Не доверяют" } });
  });

  it("состояния нет — вход в выбранное, запись «перевод» в пути", () => {
    const run = walk(v1, ["block", "offer", "doubts"]);
    const moved = migrateRun(run, v2, { doubts: "soft", block: "offer" }, T0 + 10 * MIN);
    expect(moved).toMatchObject({ state: "soft", enteredAt: T0 + 10 * MIN, startedAt: T0, pausedClocks: {}, lastRejected: null });
    expect(moved.path.at(-1)).toEqual({ state: "soft", at: T0 + 10 * MIN, tags: [], from: "doubts", exitId: null, decidedBy: "migrate" });
  });

  it("«назад» после перевода ведёт туда, куда отправили удалённое основное состояние", () => {
    const run = walk(v1, ["block", "remind"]);
    const moved = migrateRun(run, v2, { block: "offer" }, T0 + 10 * MIN);
    expect(moved.state).toBe("remind");
    expect(nextTransition(v2, moved, { type: "event", event: "message" }, T0 + 11 * MIN)).toMatchObject({ to: "offer", returned: true });
  });

  it("остановленные часы удалённого состояния переходят к выбранному", () => {
    const run = { ...walk(v1, ["block", "remind"]), pausedClocks: { block: 7 * MIN } };
    expect(migrateRun(run, v2, { block: "offer" }, T0 + 10 * MIN).pausedClocks).toEqual({ offer: 7 * MIN });
  });

  it("состояния нет, а цель не выбрана или её нет в новой версии — ошибка", () => {
    const run = walk(v1, ["block"]);
    expect(() => migrateRun(run, v2, {}, T0)).toThrow(/block/);
    expect(() => migrateRun(run, v2, { block: "nowhere" }, T0)).toThrow(/nowhere/);
  });
});
