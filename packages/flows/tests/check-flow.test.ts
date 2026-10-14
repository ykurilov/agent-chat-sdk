import { describe, expect, it } from "vitest";
import { checkFlow, type FlowCatalog, type FlowIssue } from "../src/format";
import { fixtureFlow, stateOf, type FixtureName } from "./flow-fixtures";

const catalogs: Record<FixtureName, FlowCatalog> = {
  "sales-review": { tools: ["give_booking_link", "call_expert"], events: ["paid"], widgets: ["booking_link"] },
  "shop-support": { tools: ["find_order", "start_refund", "search_knowledge", "call_operator"], events: [], widgets: ["start_refund"] },
  "sheets-lesson": { tools: ["check_answer", "show_example"], events: [], widgets: [] },
};

const brief = (issues: FlowIssue[]) => issues.map(({ level, code, place }) => ({ level, code, place }));

describe("проверка графа: примеры прототипа", () => {
  it("«Разбор продаж» и «Поддержка магазина» — без находок", () => {
    expect(checkFlow(fixtureFlow("sales-review"), catalogs["sales-review"])).toEqual([]);
    expect(checkFlow(fixtureFlow("shop-support"), catalogs["shop-support"])).toEqual([]);
  });

  it("«Урок»: «Домашнее задание» недостижимо", () => {
    const issues = checkFlow(fixtureFlow("sheets-lesson"), catalogs["sheets-lesson"]);
    expect(brief(issues)).toEqual([{ level: "error", code: "unreachable_state", place: { stateId: "orphan" } }]);
    expect(issues[0]!.message).toContain("Домашнее задание");
  });

  it("«Урок» с ошибками из прототипа: без старта, условие без цели, пустое условие, чужое поле и инструмент", () => {
    const flow = fixtureFlow("sheets-lesson", (json) => {
      delete json.start;
      stateOf(json, "hint").exits[0].to = null;
      stateOf(json, "review").exits[0].when.text = "  ";
      stateOf(json, "task").exits[1].when.field = "attempts";
      stateOf(json, "explain").tools = ["show_example", "draw_chart"];
    });
    const issues = brief(checkFlow(flow, catalogs["sheets-lesson"]));
    expect(issues).toEqual(
      expect.arrayContaining([
        { level: "error", code: "no_start", place: {} },
        { level: "error", code: "exit_without_target", place: { stateId: "hint", exitId: "hint_given" } },
        { level: "error", code: "empty_judge", place: { stateId: "review", exitId: "review_done" } },
        { level: "error", code: "unknown_field", place: { stateId: "task", exitId: "task_many_tries", fieldId: "attempts" } },
        { level: "error", code: "tool_not_in_flow", place: { stateId: "explain" } },
      ]),
    );
    // Без старта достижимость не считается: недостижимым было бы всё.
    expect(issues.some((issue) => issue.code === "unreachable_state")).toBe(false);
  });
});

describe("проверка графа: виды находок", () => {
  const check = (edit: (json: Record<string, any>) => void, name: FixtureName = "sales-review") =>
    brief(checkFlow(fixtureFlow(name, edit), catalogs[name]));

  it("старт ведёт в несуществующее состояние", () => {
    expect(check((json) => (json.start = "hello"))).toContainEqual({ level: "error", code: "unknown_start", place: {} });
  });

  it("переход в несуществующее состояние", () => {
    expect(check((json) => (stateOf(json, "intro").exits[0].to = "nowhere"))).toContainEqual({
      level: "error",
      code: "unknown_target",
      place: { stateId: "intro", exitId: "intro_clear" },
    });
  });

  it("«назад» из общих переходов", () => {
    expect(check((json) => (json.anyState.exits[0].to = "@return"))).toContainEqual({
      level: "error",
      code: "return_from_any_state",
      place: { exitId: "any_silence" },
    });
  });

  it("нет достижимого конца — замечание", () => {
    const issues = check((json) => {
      for (const id of ["booked", "soft", "bye"]) stateOf(json, id).exits = [{ id: `${id}_back`, when: { type: "event", event: "message" }, to: "intro" }];
    });
    expect(issues).toContainEqual({ level: "warning", code: "no_reachable_end", place: {} });
    expect(issues.every((issue) => issue.level === "warning")).toBe(true);
  });

  it("событие, кнопка или инструмент, которых приложение не объявило", () => {
    const issues = check((json) => {
      stateOf(json, "offer").exits[0].when.name = "pay_button";
      stateOf(json, "offer").exits.push({ id: "offer_tool", when: { type: "event", event: "tool", name: "send_invoice" }, to: "booked" });
      stateOf(json, "offer").exits.push({ id: "offer_paid", when: { type: "event", event: "app", name: "refunded" }, to: "booked" });
      stateOf(json, "offer").exits.push({ id: "offer_any_button", when: { type: "event", event: "button" }, to: "booked" });
      json.tools.push("send_invoice");
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { level: "error", code: "unknown_event", place: { stateId: "offer", exitId: "offer_link" } },
        { level: "error", code: "unknown_event", place: { stateId: "offer", exitId: "offer_tool" } },
        { level: "error", code: "unknown_event", place: { stateId: "offer", exitId: "offer_paid" } },
        { level: "error", code: "event_without_name", place: { stateId: "offer", exitId: "offer_any_button" } },
        { level: "error", code: "unknown_tool", place: {} },
      ]),
    );
  });

  it("кнопка страницы из событий приложения тоже годится", () => {
    expect(check((json) => (stateOf(json, "offer").exits[0].when.name = "paid"))).toEqual([]);
  });

  it("инструмент состояния, которого нет у приложения", () => {
    expect(
      check((json) => {
        json.tools.push("draw_chart");
        stateOf(json, "offer").tools.push("draw_chart");
      }),
    ).toEqual([
      { level: "error", code: "unknown_tool", place: {} },
      { level: "error", code: "unknown_tool", place: { stateId: "offer" } },
    ]);
  });

  it("сравнение не по типу поля и значение не из вариантов", () => {
    const issues = check((json) => {
      stateOf(json, "block").exits.push({ id: "block_gt", when: { type: "data", field: "main_block", op: "gt", value: 3 }, to: "offer" });
      stateOf(json, "block").exits.push({ id: "block_maybe", when: { type: "data", field: "booked", op: "eq", value: "может быть" }, to: "offer" });
    });
    expect(issues).toEqual([
      { level: "error", code: "op_not_for_type", place: { stateId: "block", exitId: "block_gt", fieldId: "main_block" } },
      { level: "error", code: "value_not_in_options", place: { stateId: "block", exitId: "block_maybe", fieldId: "booked" } },
    ]);
  });

  it("число сравнивается с числом", () => {
    expect(check((json) => (stateOf(json, "task").exits[1].when.value = "два"), "sheets-lesson")).toContainEqual({
      level: "error",
      code: "value_not_number",
      place: { stateId: "task", exitId: "task_many_tries", fieldId: "tries" },
    });
  });

  it("«узнать здесь» — поле, которого нет", () => {
    expect(check((json) => stateOf(json, "intro").learn.push("budget"))).toEqual([
      { level: "error", code: "unknown_learn_field", place: { stateId: "intro", fieldId: "budget" } },
    ]);
  });

  it("повторы id: состояние, условие, поле", () => {
    const issues = check((json) => {
      json.states.push({ id: "bye", title: "Ещё прощание" });
      stateOf(json, "block").exits[1].id = "block_not_ready";
      json.chatNotes.push({ id: "name", name: "Имя в чате" });
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { level: "error", code: "duplicate_state", place: { stateId: "bye" } },
        { level: "error", code: "duplicate_exit", place: { stateId: "block", exitId: "block_not_ready" } },
        { level: "error", code: "duplicate_field", place: { fieldId: "name" } },
      ]),
    );
  });

  it("исключение общих переходов называет несуществующее состояние — замечание", () => {
    expect(check((json) => json.anyState.except.push("night"))).toEqual([
      { level: "warning", code: "unknown_except_state", place: { stateId: "night" } },
    ]);
  });

  it("достижимость учитывает общие переходы, но не из исключённых и конечных состояний", () => {
    // «Напоминание» достижимо только общим переходом.
    expect(check(() => {})).toEqual([]);
    const issues = check((json) => {
      json.anyState.except = json.states.map((state: { id: string }) => state.id);
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { level: "error", code: "unreachable_state", place: { stateId: "remind" } },
        { level: "error", code: "unreachable_state", place: { stateId: "morning" } },
      ]),
    );
  });
});
