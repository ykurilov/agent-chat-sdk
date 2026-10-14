import { describe, expect, it } from "vitest";
import { ANY_STATE_LAYOUT_KEY, RETURN_TARGET, checkFlow, parseFlow } from "../src/format";
import {
  addExit,
  addField,
  addState,
  connectExit,
  defaultCondition,
  flowToJson,
  loadFlowJson,
  freeSpot,
  moveExit,
  moveField,
  normalizeCondition,
  placeNode,
  removeExit,
  removeField,
  removeState,
  setStart,
  updateExit,
  updateField,
  updateState,
} from "../src/react/editor/editor-model";
import { fixtureFlow } from "./flow-fixtures";

const catalog = { tools: ["give_booking_link", "call_expert"], events: ["booking_link"], widgets: [] };

describe("правки графа", () => {
  it("новое состояние получает свободный id, место на доске и пустые поля", () => {
    const flow = fixtureFlow("sales-review");
    const { flow: next, stateId } = addState(flow, { title: "Новое состояние", at: { x: 10, y: 20 } });
    expect(flow.states.some((state) => state.id === stateId)).toBe(false);
    const state = next.states.find((candidate) => candidate.id === stateId)!;
    expect(state).toMatchObject({ title: "Новое состояние", exits: [], instructions: "", firstMessage: null });
    expect(next.layout[stateId]).toEqual({ x: 10, y: 20 });
    // Второе подряд — другой id.
    expect(addState(next, { title: "x" }).stateId).not.toBe(stateId);
  });

  it("первое состояние пустого сценария становится стартом", () => {
    const empty = { ...fixtureFlow("sales-review"), start: null, states: [], layout: {} };
    const { flow, stateId } = addState(empty, { title: "Первое" });
    expect(flow.start).toBe(stateId);
  });

  it("удаление состояния обнуляет ведущие в него условия, старт и исключения", () => {
    const flow = fixtureFlow("sales-review");
    const next = removeState(removeState(flow, "intro"), "morning");
    expect(next.states.map((state) => state.id)).not.toContain("intro");
    expect(next.start).toBeNull();
    expect(next.anyState.except).toEqual([]);
    const remind = next.states.find((state) => state.id === "remind")!;
    expect(remind.exits.find((exit) => exit.id === "remind_morning")!.to).toBeNull();
    expect(next.layout.intro).toBeUndefined();
  });

  it("соединение ставит цель условию состояния и общего перехода", () => {
    const flow = fixtureFlow("sales-review");
    const next = connectExit(connectExit(flow, "intro", "intro_clear", "offer"), null, "any_silence", "soft");
    expect(next.states[0]!.exits[0]!.to).toBe("offer");
    expect(next.anyState.exits[0]!.to).toBe("soft");
  });

  it("новое условие — нужного вида, с id и без цели; вид меняется со значениями по умолчанию", () => {
    const flow = fixtureFlow("sales-review");
    const { flow: next, exitId } = addExit(flow, "booked", "timer");
    const exit = next.states.find((state) => state.id === "booked")!.exits[0]!;
    expect(exit).toEqual({ id: exitId, when: { type: "timer", from: "in_state", amount: 1, unit: "h" }, to: null });
    expect(defaultCondition("judge", flow)).toEqual({ type: "judge", text: "" });
    expect(defaultCondition("event", flow)).toEqual({ type: "event", event: "message" });
    expect(defaultCondition("data", flow)).toEqual({ type: "data", field: "name", op: "filled" });
  });

  it("условие правится, переставляется и удаляется", () => {
    const flow = fixtureFlow("sales-review");
    let next = updateExit(flow, "offer", "offer_refused", { when: { type: "judge", text: "Ушёл" }, to: "bye" });
    expect(next.states.find((state) => state.id === "offer")!.exits[2]).toMatchObject({ when: { text: "Ушёл" }, to: "bye" });
    next = moveExit(next, "offer", "offer_refused", -1);
    expect(next.states.find((state) => state.id === "offer")!.exits.map((exit) => exit.id)).toEqual([
      "offer_link",
      "offer_refused",
      "offer_doubts",
    ]);
    // За край не уходит.
    expect(moveExit(next, "offer", "offer_link", -1)).toBe(next);
    next = removeExit(next, "offer", "offer_link");
    expect(next.states.find((state) => state.id === "offer")!.exits).toHaveLength(2);
    next = removeExit(next, null, "any_silence");
    expect(next.anyState.exits).toEqual([]);
  });

  it("правка состояния и старт", () => {
    const flow = fixtureFlow("sales-review");
    const next = setStart(updateState(flow, "offer", { title: "Оффер", noSideQuestions: true }), "offer");
    expect(next.start).toBe("offer");
    expect(next.states.find((state) => state.id === "offer")).toMatchObject({ title: "Оффер", noSideQuestions: true });
  });

  it("поля карточки и заметок: добавить, править, переставить, удалить вместе с «узнать здесь»", () => {
    const flow = fixtureFlow("sales-review");
    const { flow: added, fieldId } = addField(flow, "chatNotes", "Бюджет");
    expect(added.chatNotes.at(-1)).toEqual({ id: fieldId, name: "Бюджет", about: "", type: "text", options: [] });
    const { fieldId: cardId, flow: withCard } = addField(added, "clientCard", "Город");
    expect(withCard.clientCard.at(-1)).toMatchObject({ id: cardId, refreshAfterMonths: null });

    const typed = updateField(withCard, "chatNotes", fieldId, { type: "number" });
    expect(typed.chatNotes.at(-1)!.type).toBe("number");
    const moved = moveField(typed, "clientCard", "name", 1);
    expect(moved.clientCard.slice(0, 2).map((field) => field.id)).toEqual(["course_topic", "name"]);

    const removed = removeField(moved, "clientCard", "sales");
    expect(removed.clientCard.some((field) => field.id === "sales")).toBe(false);
    expect(removed.states.find((state) => state.id === "intro")!.learn).toEqual(["course_topic"]);
  });

  it("место узла на доске, в том числе «Из любого состояния»", () => {
    const flow = placeNode(placeNode(fixtureFlow("sales-review"), "intro", { x: 1, y: 2 }), ANY_STATE_LAYOUT_KEY, { x: 3, y: 4 });
    expect(flow.layout.intro).toEqual({ x: 1, y: 2 });
    expect(flow.layout[ANY_STATE_LAYOUT_KEY]).toEqual({ x: 3, y: 4 });
  });

  it("после всех правок JSON редактора принимает parseFlow без правок (SC-006)", () => {
    let flow = fixtureFlow("shop-support");
    const created = addState(flow, { title: "Новое" });
    flow = created.flow;
    for (const kind of ["judge", "data", "event", "timer"] as const) {
      const made = addExit(flow, created.stateId, kind);
      flow = connectExit(made.flow, created.stateId, made.exitId, RETURN_TARGET);
    }
    flow = addField(flow, "chatNotes", "Ещё").flow;
    const parsed = parseFlow(JSON.parse(flowToJson(flow)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.flow).toEqual(flow);
  });

  it("загрузка JSON: годный — сценарий, битый — ошибки строками с местом", () => {
    const flow = fixtureFlow("sheets-lesson");
    const loaded = loadFlowJson(flowToJson(flow));
    expect(loaded).toEqual({ ok: true, flow });
    const broken = loadFlowJson("{ нет");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toMatch(/JSON/);
    const wrong = loadFlowJson(JSON.stringify({ format: "agent-flow", version: 1, id: "x", name: "x", states: [{ id: "a", exits: 1 }] }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors.join("\n")).toContain("states[0].exits");
  });

  it("новое состояние со связью: проверка графа больше не видит недостижимого", () => {
    const flow = fixtureFlow("sales-review");
    const created = addState(flow, { title: "Ещё шаг" });
    const made = addExit(created.flow, "block", "judge");
    const linked = connectExit(made.flow, "block", made.exitId, created.stateId);
    const codes = (value: typeof flow) => checkFlow(value, catalog).map((issue) => issue.code);
    expect(codes(created.flow)).toContain("unreachable_state");
    expect(codes(linked)).not.toContain("unreachable_state");
    expect(codes(linked)).toContain("empty_judge");
  });

  it("смена вида условия в карточке — значения по умолчанию; поле другого типа — подходящее сравнение", () => {
    const flow = fixtureFlow("sheets-lesson");
    const judge = { type: "judge", text: "x" } as const;
    expect(normalizeCondition(flow, judge, { type: "timer" } as never)).toEqual({ type: "timer", from: "in_state", amount: 1, unit: "h" });
    const tries = { type: "data", field: "tries", op: "gt", value: 2 } as const;
    expect(normalizeCondition(flow, tries, { ...tries, field: "answer" })).toEqual({ type: "data", field: "answer", op: "filled" });
    expect(normalizeCondition(flow, tries, { ...tries, value: "5" })).toEqual({ ...tries, value: 5 });
    const span = { type: "timer", from: "in_state", amount: 10, unit: "min" } as const;
    expect(normalizeCondition(flow, span, { type: "timer", from: "time_of_day" } as never)).toEqual({ type: "timer", from: "time_of_day", at: "10:00" });
    expect(normalizeCondition(flow, { type: "timer", from: "time_of_day", at: "09:00" }, { type: "timer", from: "silence" } as never)).toEqual({
      type: "timer",
      from: "silence",
      amount: 1,
      unit: "h",
    });
  });

  it("свободное место для нового состояния — ниже всех узлов", () => {
    const flow = fixtureFlow("sales-review");
    const spot = freeSpot(flow);
    expect(Object.values(flow.layout).every((point) => point.y < spot.y)).toBe(true);
  });
});
