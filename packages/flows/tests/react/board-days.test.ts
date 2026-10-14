import { describe, expect, it } from "vitest";
import { checkFlow, type AgentFlow, type FlowState } from "../../src/format";
import { russianFlowEditorLabels as labels } from "../../src/labels/editor";
import { russianFlowTestChatLabels } from "../../src/labels/test-chat";
import { appIssues } from "../../src/format";
import { normalizeCondition, flowToJson, loadFlowJson } from "../../src/react/editor/editor-model";
import {
  DEFAULT_NUDGES,
  durationOf,
  nudgesMode,
  setAfterEnd,
  setDuration,
  setScheduleOn,
  setStateNudges,
  stateTimingText,
  updateSchedule,
  updateStateNudges,
} from "../../src/react/editor/schedule-model";
import { addCatalogField, addSideTask, catalogFieldsToAdd, removeSideTask, setSideTaskField, updateSideTask } from "../../src/react/editor/side-task-model";
import { formatDayLine } from "../../src/react/test-chat/flow-test-chat";
import { fixtureFlow } from "../flow-fixtures";

// Этап 10 сценариев: логика доски для формата v2 — «Дни и время», «Длится», касания, попутные задачи, «да/нет»,
// поля приложения, свои проверки приложения, строка дня тестового чата.

const catalog = { tools: ["give_booking_link", "call_expert"], events: ["booking_link"], widgets: [] };
const state = (flow: AgentFlow, id: string): FlowState => flow.states.find((candidate) => candidate.id === id)!;
const roundTrip = (flow: AgentFlow) => {
  const loaded = loadFlowJson(flowToJson(flow));
  if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
  return loaded.flow;
};

describe("«Дни и время»", () => {
  it("включение даёт начало дня 09:00 и порог позднего старта 3 ч; выключение убирает раздел", () => {
    const on = setScheduleOn(fixtureFlow("sales-review"), true);
    expect(on.schedule).toEqual({ dayStart: "09:00", lateStartHours: 3, farewellOnDeadline: false });
    expect(checkFlow(on, catalog).filter((issue) => issue.level === "error")).toEqual([]);
    expect(setScheduleOn(on, true)).toBe(on);
    expect(setScheduleOn(on, false).schedule).toBeUndefined();
  });

  it("правка полей; пустое значение убирает поле, а не пишет пустую строку", () => {
    let flow = setScheduleOn(fixtureFlow("sales-review"), true);
    flow = updateSchedule(flow, { nightFrom: "21:00", lengthDays: 3, farewellOnDeadline: true, farewellText: "Спасибо, что были с нами!" });
    expect(flow.schedule).toMatchObject({ nightFrom: "21:00", lengthDays: 3, farewellOnDeadline: true, farewellText: "Спасибо, что были с нами!" });
    flow = updateSchedule(flow, { nightFrom: undefined, farewellText: "" });
    expect(flow.schedule).not.toHaveProperty("nightFrom");
    expect(flow.schedule).not.toHaveProperty("farewellText");
    // Рамки дня и сообщения первым — вложенные: пустые убираются целиком.
    flow = updateSchedule(flow, { dayFrame: { softFrom: 12, hardAt: 15 } });
    expect(flow.schedule?.dayFrame).toEqual({ softFrom: 12, hardAt: 15 });
    flow = updateSchedule(flow, { dayFrame: { softFrom: undefined, hardAt: undefined } });
    expect(flow.schedule).not.toHaveProperty("dayFrame");
    expect(roundTrip(flow).schedule).toEqual(flow.schedule);
  });

  it("после конца разговора: reply / silent; без «Дней и времени» тоже сохраняется", () => {
    const flow = setAfterEnd(fixtureFlow("sales-review"), "silent");
    expect(flow.afterEnd).toBe("silent");
    expect(roundTrip(flow).afterEnd).toBe("silent");
    expect(setAfterEnd(flow, "reply").afterEnd).toBe("reply");
  });
});

describe("нода «Длится»", () => {
  it("дни — выход state_days, часы — in_state; правка того же выхода, а не нового", () => {
    let flow = setScheduleOn(fixtureFlow("sales-review"), true);
    expect(durationOf(state(flow, "intro"))).toBeNull();
    flow = setDuration(flow, "intro", { amount: 1, unit: "d" });
    const made = durationOf(state(flow, "intro"))!;
    expect(made).toMatchObject({ amount: 1, unit: "d", to: null });
    expect(state(flow, "intro").exits.find((exit) => exit.id === made.exitId)!.when).toEqual({ type: "timer", from: "state_days", days: 1 });

    flow = setDuration(flow, "intro", { amount: 6, unit: "h" });
    expect(state(flow, "intro").exits.filter((exit) => exit.when.type === "timer")).toHaveLength(1);
    expect(state(flow, "intro").exits.find((exit) => exit.id === made.exitId)!.when).toEqual({ type: "timer", from: "in_state", amount: 6, unit: "h" });

    flow = setDuration(flow, "intro", null);
    expect(durationOf(state(flow, "intro"))).toBeNull();
    expect(state(flow, "intro").exits.some((exit) => exit.id === made.exitId)).toBe(false);
  });

  it("минуты в этом состоянии — обычный таймер, не «Длится»", () => {
    // У «Сомнений» есть таймер 20 мин в состоянии — его «Длится» не забирает.
    expect(durationOf(state(fixtureFlow("sales-review"), "doubts"))).toBeNull();
  });
});

describe("касания ноды", () => {
  it("как у сценария / свои / выкл", () => {
    let flow = setScheduleOn(fixtureFlow("sales-review"), true);
    expect(nudgesMode(state(flow, "intro"))).toBe("inherit");
    flow = setStateNudges(flow, "intro", "own");
    expect(state(flow, "intro").nudges).toEqual(DEFAULT_NUDGES);
    expect(nudgesMode(state(flow, "intro"))).toBe("own");
    flow = updateStateNudges(flow, "intro", { afterSilence: [{ amount: 30, unit: "min" }], giveUpAfter: { amount: 3, unit: "d" } });
    expect(roundTrip(flow).states.find((candidate) => candidate.id === "intro")!.nudges).toEqual({
      afterSilence: [{ amount: 30, unit: "min" }],
      giveUpAfter: { amount: 3, unit: "d" },
    });
    flow = setStateNudges(flow, "intro", "off");
    expect(state(flow, "intro").nudges).toBe("off");
    flow = setStateNudges(flow, "intro", "inherit");
    expect(state(flow, "intro")).not.toHaveProperty("nudges");
  });

  it("свои касания берут за образец общие, если они есть", () => {
    let flow = updateSchedule(setScheduleOn(fixtureFlow("sales-review"), true), { nudges: { afterSilence: [{ amount: 2, unit: "h" }] } });
    flow = setStateNudges(flow, "intro", "own");
    expect(state(flow, "intro").nudges).toEqual({ afterSilence: [{ amount: 2, unit: "h" }] });
  });

  it("подпись на карточке ноды: «1 день · касания 15 мин · 1 ч · 4 ч»", () => {
    let flow = setScheduleOn(fixtureFlow("sales-review"), true);
    expect(stateTimingText(flow, state(flow, "intro"), labels)).toBe("");
    flow = setDuration(flow, "intro", { amount: 1, unit: "d" });
    flow = setStateNudges(flow, "intro", "own");
    expect(stateTimingText(flow, state(flow, "intro"), labels)).toBe("1 день · касания 15 мин · 1 ч · 4 ч");
    flow = setStateNudges(setDuration(flow, "intro", { amount: 3, unit: "h" }), "intro", "off");
    expect(stateTimingText(flow, state(flow, "intro"), labels)).toBe("3 ч · без касаний");
  });
});

describe("попутные задачи", () => {
  it("добавить, править, убрать; по умолчанию 2 попытки на человека", () => {
    let made = addSideTask(fixtureFlow("sales-review"), "Узнать, откуда пришёл человек");
    expect(made.flow.sideTasks).toEqual([{ id: made.sideTaskId, text: "Узнать, откуда пришёл человек", maxAttempts: 2, perConversation: false }]);
    const second = addSideTask(made.flow, "Ещё");
    expect(second.sideTaskId).not.toBe(made.sideTaskId);
    let flow = updateSideTask(second.flow, made.sideTaskId, { when: "После первого ответа", maxAttempts: 3, perConversation: true });
    expect(flow.sideTasks![0]).toMatchObject({ when: "После первого ответа", maxAttempts: 3, perConversation: true });
    flow = updateSideTask(flow, made.sideTaskId, { when: "" });
    expect(flow.sideTasks![0]).not.toHaveProperty("when");
    expect(roundTrip(flow).sideTasks).toEqual(flow.sideTasks);
    flow = removeSideTask(flow, made.sideTaskId);
    expect(flow.sideTasks!.map((task) => task.id)).toEqual([second.sideTaskId]);
    expect(removeSideTask(flow, second.sideTaskId)).not.toHaveProperty("sideTasks");
  });

  it("поле из словаря приложения добавляется в карточку, когда его выбрали у задачи", () => {
    const appCatalog = { ...catalog, fields: [{ id: "city", title: "Город", type: "text" as const }] };
    const made = addSideTask(fixtureFlow("sales-review"), "Узнать город");
    expect(catalogFieldsToAdd(made.flow, appCatalog).map((field) => field.id)).toEqual(["city"]);
    const flow = setSideTaskField(made.flow, made.sideTaskId, "city", appCatalog);
    expect(flow.sideTasks![0]!.field).toBe("city");
    expect(flow.clientCard.find((field) => field.id === "city")).toMatchObject({ name: "Город", type: "text", options: [] });
    expect(catalogFieldsToAdd(flow, appCatalog)).toEqual([]);
    expect(checkFlow(flow, appCatalog).filter((issue) => issue.place.sideTaskId)).toEqual([]);
    expect(setSideTaskField(flow, made.sideTaskId, null, appCatalog).sideTasks![0]).not.toHaveProperty("field");
  });
});

describe("поля приложения и «да/нет»", () => {
  it("поле из catalog.fields: id, название, тип и варианты; повторно не добавляется", () => {
    const field = { id: "has_course", title: "Есть курс", type: "boolean" as const };
    const flow = addCatalogField(fixtureFlow("sales-review"), "chatNotes", field);
    expect(flow.chatNotes.at(-1)).toEqual({ id: "has_course", name: "Есть курс", about: "", type: "boolean", options: [] });
    expect(addCatalogField(flow, "clientCard", field)).toBe(flow);
    const choice = addCatalogField(flow, "clientCard", { id: "level", title: "Уровень", type: "choice", options: ["новичок", "опытный"] });
    expect(choice.clientCard.at(-1)).toMatchObject({ id: "level", options: ["новичок", "опытный"], refreshAfterMonths: null });
  });

  it("условие по «да/нет»: = и ≠ со значением true/false", () => {
    const flow = addCatalogField(fixtureFlow("sales-review"), "chatNotes", { id: "agreed", title: "Согласился", type: "boolean" });
    const previous = { type: "data" as const, field: "agreed", op: "filled" as const };
    expect(normalizeCondition(flow, previous, { ...previous, op: "eq" })).toEqual({ type: "data", field: "agreed", op: "eq", value: true });
    expect(normalizeCondition(flow, previous, { ...previous, op: "ne", value: "false" })).toEqual({ type: "data", field: "agreed", op: "ne", value: false });
    expect(normalizeCondition(flow, previous, { ...previous, op: "eq", value: false })).toEqual({ type: "data", field: "agreed", op: "eq", value: false });
    expect(normalizeCondition(flow, previous, { ...previous, op: "gt" as never })).toEqual({ type: "data", field: "agreed", op: "filled" });
  });
});

describe("свои проверки приложения", () => {
  it("path ведёт на место: нода, условие, поле, попутная задача; без level — ошибка", () => {
    const flow = addSideTask(fixtureFlow("sales-review"), "Узнать город").flow;
    const taskId = flow.sideTasks![0]!.id;
    const issues = appIssues(flow, [
      { path: "states[1]", message: "«Продажа» только в одной ноде" },
      { path: "states[1].exits[1]", message: "условие", level: "warning" },
      { path: "states[intro]", message: "по id" },
      { path: "anyState.exits[0]", message: "общее" },
      { path: "clientCard[0]", message: "поле" },
      { path: "sideTasks[0]", message: "задача" },
      { path: "schedule.dayStart", message: "дни" },
      { message: "весь сценарий" },
      { level: "warning", code: "own", message: "готовое", place: { stateId: "intro" } },
    ]);
    const second = flow.states[1]!;
    expect(issues).toEqual([
      { level: "error", code: "app_check", message: "«Продажа» только в одной ноде", place: { stateId: second.id } },
      { level: "warning", code: "app_check", message: "условие", place: { stateId: second.id, exitId: second.exits[1]!.id } },
      { level: "error", code: "app_check", message: "по id", place: { stateId: "intro" } },
      { level: "error", code: "app_check", message: "общее", place: { exitId: flow.anyState.exits[0]!.id } },
      { level: "error", code: "app_check", message: "поле", place: { fieldId: flow.clientCard[0]!.id } },
      { level: "error", code: "app_check", message: "задача", place: { sideTaskId: taskId } },
      { level: "error", code: "app_check", message: "дни", place: {} },
      { level: "error", code: "app_check", message: "весь сценарий", place: {} },
      { level: "warning", code: "own", message: "готовое", place: { stateId: "intro" } },
    ]);
  });
});

describe("строка дня тестового чата", () => {
  const at = Date.UTC(2026, 9, 14, 11, 20); // 14:20 по Москве
  it("«День 2 из 3 · 14:20», без срока — «День 2 · 14:20», вечер до первого дня", () => {
    const day = { day: 2, totalDays: 3, isLastDay: false, dayStartedAt: 0, nextDayStartAt: 0 };
    expect(formatDayLine(day, at, "Europe/Moscow", russianFlowTestChatLabels)).toBe("День 2 из 3 · 14:20");
    expect(formatDayLine({ ...day, totalDays: undefined }, at, "Europe/Moscow", russianFlowTestChatLabels)).toBe("День 2 · 14:20");
    expect(formatDayLine({ ...day, day: 0 }, at, "Europe/Moscow", russianFlowTestChatLabels)).toBe("До первого дня · 14:20");
    expect(formatDayLine(undefined, at, "Europe/Moscow", russianFlowTestChatLabels)).toBeNull();
  });
});
