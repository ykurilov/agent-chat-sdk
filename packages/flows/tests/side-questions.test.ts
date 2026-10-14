import { describe, expect, it } from "vitest";
import { applyTransition, fieldValueFits, isFieldStale, sideQuestion, startRun, type AgentFlow, type FlowRun } from "../src/format";
import { DAY, fixtureFlow } from "./flow-fixtures";

const T0 = Date.UTC(2026, 9, 13, 6, 0);
const sales = fixtureFlow("sales-review");

function runIn(flow: AgentFlow, state: string, patch: Partial<FlowRun> = {}): FlowRun {
  const run = startRun(flow, T0);
  const moved = state === run.state ? run : applyTransition(flow, run, { from: run.state, to: state, exitId: "test", decidedBy: "event", tags: [], at: T0 });
  return { ...moved, ...patch };
}

const known = (value: unknown, updatedAt = T0) => ({ value, updatedAt });
const allCard = {
  name: known("Ольга"),
  course_topic: known("Акварель"),
  sales: known("до 10 продаж"),
  occupation: known("Иллюстратор"),
  audience: known("Новички"),
  channels: known("Инстаграм"),
};

describe("что спросить между делом", () => {
  it("«узнать здесь» — прямо и вне темпа", () => {
    const run = runIn(sales, "intro", { humanMessages: 1, sideQuestionAt: 1 });
    expect(sideQuestion(sales, run, { card: {}, now: T0 })).toEqual({ fieldId: "course_topic", reason: "learn" });
    expect(sideQuestion(sales, run, { card: { course_topic: known("Акварель") }, now: T0 })).toEqual({ fieldId: "sales", reason: "learn" });
  });

  it("«узнать здесь» работает и в состоянии «без вопросов»; заметка чата берётся из чата", () => {
    const run = runIn(sales, "doubts");
    expect(sideQuestion(sales, run, { card: allCard, now: T0 })).toEqual({ fieldId: "doubt", reason: "learn" });
    expect(sideQuestion(sales, { ...run, notes: { doubt: "Нет времени" } }, { card: allCard, now: T0 })).toBeNull();
  });

  it("в состоянии «без вопросов» между делом не спрашивает", () => {
    expect(sideQuestion(sales, runIn(sales, "remind"), { card: {}, now: T0 })).toBeNull();
  });

  it("темп: не чаще раза в N сообщений человека", () => {
    const card = { course_topic: known("Акварель"), sales: known("до 10 продаж") };
    expect(sideQuestion(sales, runIn(sales, "intro", { humanMessages: 4, sideQuestionAt: 2 }), { card, now: T0 })).toBeNull();
    expect(sideQuestion(sales, runIn(sales, "intro", { humanMessages: 7, sideQuestionAt: 2 }), { card, now: T0 })).toEqual({
      fieldId: "name",
      reason: "unknown",
    });
    // Ещё не спрашивал — можно.
    expect(sideQuestion(sales, runIn(sales, "intro", { humanMessages: 1 }), { card, now: T0 })).toEqual({ fieldId: "name", reason: "unknown" });
  });

  it("устаревшее поле — уточнить раньше неизвестных", () => {
    const sevenMonthsAgo = Date.UTC(2026, 2, 13);
    const card = { ...allCard, audience: known(""), channels: known("Инстаграм", sevenMonthsAgo) };
    expect(sideQuestion(sales, runIn(sales, "block", { notes: { main_block: "Не доверяют" } }), { card, now: T0 })).toEqual({
      fieldId: "channels",
      reason: "stale",
    });
  });

  it("значение не по типу — неизвестно", () => {
    const card = { ...allCard, sales: known(5) };
    expect(sideQuestion(sales, runIn(sales, "block", { notes: { main_block: "x" } }), { card, now: T0 })).toEqual({
      fieldId: "sales",
      reason: "unknown",
    });
  });

  it("всё известно или конец сценария — спрашивать нечего", () => {
    expect(sideQuestion(sales, runIn(sales, "block", { notes: { main_block: "x" } }), { card: allCard, now: T0 })).toBeNull();
    expect(sideQuestion(sales, runIn(sales, "booked"), { card: {}, now: T0 })).toBeNull();
  });
});

describe("поля карточки: тип и срок", () => {
  it("значение подходит полю по типу и вариантам", () => {
    expect(fieldValueFits({ type: "text", options: [] }, "Акварель")).toBe(true);
    expect(fieldValueFits({ type: "text", options: [] }, "")).toBe(false);
    expect(fieldValueFits({ type: "number", options: [] }, 3)).toBe(true);
    expect(fieldValueFits({ type: "number", options: [] }, "3")).toBe(false);
    expect(fieldValueFits({ type: "choice", options: ["да", "нет"] }, "Да")).toBe(true);
    expect(fieldValueFits({ type: "choice", options: ["да", "нет"] }, "может быть")).toBe(false);
  });

  it("устаревает через N месяцев; без срока — никогда", () => {
    const channels = sales.clientCard.find((field) => field.id === "channels")!;
    const name = sales.clientCard.find((field) => field.id === "name")!;
    expect(isFieldStale(channels, Date.UTC(2026, 3, 14), T0)).toBe(false);
    expect(isFieldStale(channels, Date.UTC(2026, 3, 12), T0)).toBe(true);
    expect(isFieldStale(name, T0 - 5000 * DAY, T0)).toBe(false);
  });
});
