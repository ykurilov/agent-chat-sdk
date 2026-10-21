import { describe, expect, it } from "vitest";
import { appIssues, checkFlow, placeOfPath, type FlowCatalog, type FlowIssue } from "../src/format";
import { fixtureFlow, stateOf } from "./flow-fixtures";

const catalog: FlowCatalog = { tools: ["give_booking_link", "call_expert"], events: ["paid"], widgets: ["booking_link"] };
const brief = (issues: FlowIssue[]) => issues.map(({ level, code, place }) => ({ level, code, place }));
const check = (edit: (json: Record<string, any>) => void) => brief(checkFlow(fixtureFlow("sales-review", edit), catalog));

describe("проверка графа v2: «Дни и время»", () => {
  it("сценарий с днями, касаниями, рамками и попутными задачами — без находок", () => {
    expect(
      check((json) => {
        json.schedule = {
          dayStart: "09:00",
          nightFrom: "21:00",
          lengthDays: 3,
          deadlineState: "bye",
          nudges: { afterSilence: [{ amount: 15, unit: "min" }] },
          dayFrame: { softFrom: 20, hardAt: 30 },
        };
        json.sideTasks = [{ id: "subscribe", text: "Подписка на канал", field: "channels" }];
        stateOf(json, "block").exits.push({ id: "block_day", when: { type: "timer", from: "state_days", days: 1 }, to: "offer" });
      }),
    ).toEqual([]);
  });

  it("«нода длится N дней» без начала дня", () => {
    expect(
      check((json) => stateOf(json, "block").exits.push({ id: "block_day", when: { type: "timer", from: "state_days", days: 1 }, to: "offer" })),
    ).toContainEqual({ level: "error", code: "state_days_without_day_start", place: { stateId: "block", exitId: "block_day" } });
  });

  it("«нода длится» меньше одного дня", () => {
    expect(
      check((json) => {
        json.schedule = { dayStart: "09:00" };
        stateOf(json, "block").exits.push({ id: "block_day", when: { type: "timer", from: "state_days", days: 0 }, to: "offer" });
      }),
    ).toContainEqual({ level: "error", code: "state_days_below_one", place: { stateId: "block", exitId: "block_day" } });
  });

  it("«наступил день N программы»: без «Дней и времени» — предупреждение; дальше срока, меньше 1, не целое — ошибка", () => {
    const programDay = (day: number, schedule?: Record<string, unknown>) =>
      check((json) => {
        if (schedule) json.schedule = schedule;
        stateOf(json, "block").exits.push({ id: "block_day3", when: { type: "timer", from: "program_day", day }, to: "offer" });
      });
    const place = { stateId: "block", exitId: "block_day3" };
    expect(programDay(3, { dayStart: "09:00", lengthDays: 3 })).toEqual([]);
    expect(programDay(3, { dayStart: "09:00" })).toEqual([]);
    expect(programDay(3)).toContainEqual({ level: "warning", code: "program_day_without_schedule", place });
    expect(programDay(4, { dayStart: "09:00", lengthDays: 3 })).toContainEqual({ level: "error", code: "program_day_after_end", place });
    expect(programDay(0, { dayStart: "09:00" })).toContainEqual({ level: "error", code: "program_day_invalid", place });
    expect(programDay(2.5, { dayStart: "09:00" })).toContainEqual({ level: "error", code: "program_day_invalid", place });
  });

  it("свои касания ноды на N дней: целое число с 1, иначе ошибка", () => {
    const ownFor = (days: number) =>
      check((json) => {
        json.schedule = { dayStart: "09:00", nudges: { afterSilence: [{ amount: 3, unit: "h" }] } };
        stateOf(json, "block").nudges = { afterSilence: [{ amount: 15, unit: "min" }], days };
      });
    expect(ownFor(1)).toEqual([]);
    expect(ownFor(0)).toContainEqual({ level: "error", code: "nudges_days_invalid", place: { stateId: "block" } });
    expect(ownFor(1.5)).toContainEqual({ level: "error", code: "nudges_days_invalid", place: { stateId: "block" } });
  });

  it("104 свои касания «до дня программы»: целое число с 1; дальше конца программы — предупреждение", () => {
    const untilFor = (untilProgramDay: number) =>
      check((json) => {
        json.schedule = { dayStart: "09:00", lengthDays: 5, nudges: { afterSilence: [{ amount: 3, unit: "h" }] } };
        stateOf(json, "block").nudges = { afterSilence: [{ amount: 15, unit: "min" }], untilProgramDay };
      });
    expect(untilFor(1)).toEqual([]);
    expect(untilFor(0)).toContainEqual({ level: "error", code: "nudges_until_day_invalid", place: { stateId: "block" } });
    expect(untilFor(1.5)).toContainEqual({ level: "error", code: "nudges_until_day_invalid", place: { stateId: "block" } });
    expect(untilFor(6)).toContainEqual({ level: "warning", code: "nudges_until_day_after_end", place: { stateId: "block" } });
  });

  it("104 потолок по дням программы: длиннее программы — предупреждение; не целые и пустой список — ошибка формата", () => {
    const capsFor = (maxPerDayByDay: unknown) => check((json) => (json.schedule = { dayStart: "09:00", lengthDays: 2, firstMessages: { maxPerDayByDay } }));
    expect(capsFor([3, 2])).toEqual([]);
    expect(capsFor([3, 2, 1])).toContainEqual({ level: "warning", code: "max_per_day_by_day_after_end", place: {} });
    expect(() => fixtureFlow("sales-review", (json) => (json.schedule = { dayStart: "09:00", firstMessages: { maxPerDayByDay: [] } }))).toThrow();
    expect(() => fixtureFlow("sales-review", (json) => (json.schedule = { dayStart: "09:00", firstMessages: { maxPerDayByDay: [1.5] } }))).toThrow();
  });

  it("ночь начинается не позже начала дня", () => {
    expect(check((json) => (json.schedule = { dayStart: "09:00", nightFrom: "08:00" }))).toContainEqual({
      level: "error",
      code: "night_before_day_start",
      place: {},
    });
    expect(check((json) => (json.schedule = { dayStart: "09:00", nightFrom: "09:00" }))).toContainEqual(
      expect.objectContaining({ code: "night_before_day_start" }),
    );
  });

  it("состояние «срок вышел» не существует", () => {
    expect(check((json) => (json.schedule = { dayStart: "09:00", deadlineState: "gone" }))).toContainEqual({
      level: "error",
      code: "unknown_deadline_state",
      place: { stateId: "gone" },
    });
  });

  describe("достижимость: системные входы", () => {
    const addEnd = (json: Record<string, any>, id: string) => {
      json.states.push({ id, title: "Срок вышел", instructions: "Попрощаться.", firstMessage: null, tags: [], exits: [] });
      json.layout[id] = { x: 0, y: 0 };
    };
    const unreachable = (issues: ReturnType<typeof check>) => issues.filter((issue) => issue.code === "unreachable_state");

    it("нода, в которую ведёт только «срок вышел», достижима", () => {
      const issues = check((json) => {
        addEnd(json, "expired");
        json.schedule = { dayStart: "09:00", lengthDays: 3, deadlineState: "expired" };
      });
      expect(unreachable(issues)).toEqual([]);
    });

    it("нода, в которую ведёт только общий переход «из любого состояния», достижима", () => {
      const issues = check((json) => {
        addEnd(json, "expired");
        json.anyState.exits.push({ id: "any_expired", when: { type: "timer", from: "since_start", amount: 3, unit: "d" }, to: "expired" });
      });
      expect(unreachable(issues)).toEqual([]);
    });

    it("нода без единого входа по-прежнему недостижима", () => {
      const issues = check((json) => {
        addEnd(json, "expired");
        addEnd(json, "lost");
        json.schedule = { dayStart: "09:00", lengthDays: 3, deadlineState: "expired" };
      });
      expect(unreachable(issues)).toEqual([{ level: "error", code: "unreachable_state", place: { stateId: "lost" } }]);
    });

    it("нода срока, которой нет, не прячет другие ошибки", () => {
      const issues = check((json) => {
        addEnd(json, "lost");
        json.schedule = { dayStart: "09:00", deadlineState: "gone" };
      });
      expect(unreachable(issues)).toEqual([{ level: "error", code: "unreachable_state", place: { stateId: "lost" } }]);
    });
  });

  it("мягкая рамка дня не раньше жёсткой", () => {
    expect(check((json) => (json.schedule = { dayStart: "09:00", dayFrame: { softFrom: 30, hardAt: 30 } }))).toContainEqual({
      level: "error",
      code: "day_frame_soft_after_hard",
      place: {},
    });
  });

  it("пустой ряд касаний — у сценария и у ноды", () => {
    const issues = check((json) => {
      json.schedule = { dayStart: "09:00", nudges: { afterSilence: [] } };
      stateOf(json, "offer").nudges = { afterSilence: [] };
    });
    expect(issues).toContainEqual({ level: "warning", code: "empty_nudges", place: {} });
    expect(issues).toContainEqual({ level: "warning", code: "empty_nudges", place: { stateId: "offer" } });
  });

  it("касания только по часам — не пустой ряд", () => {
    const issues = check((json) => (json.schedule = { dayStart: "09:00", nudges: { afterSilence: [], dailyAt: ["10:00"] } }));
    expect(issues.some((issue) => issue.code === "empty_nudges")).toBe(false);
  });
});

describe("проверка графа v2: попутные задачи и «да/нет»", () => {
  it("попутная задача ссылается на неизвестное поле", () => {
    expect(check((json) => (json.sideTasks = [{ id: "subscribe", text: "Подписка", field: "subscribed" }]))).toContainEqual({
      level: "error",
      code: "side_task_unknown_field",
      place: { sideTaskId: "subscribe", fieldId: "subscribed" },
    });
  });

  it("id попутных задач повторяются", () => {
    expect(
      check((json) => (json.sideTasks = [{ id: "subscribe", text: "Подписка" }, { id: "subscribe", text: "Отзыв" }])),
    ).toContainEqual({ level: "error", code: "duplicate_side_task", place: { sideTaskId: "subscribe" } });
  });

  it("«≠» не для поля «да/нет» — сравнение не подходит типу", () => {
    expect(
      check((json) => stateOf(json, "intro").exits.push({ id: "intro_ne", when: { type: "data", field: "sales", op: "ne", value: 1 }, to: "bye" })),
    ).toContainEqual(expect.objectContaining({ code: "op_not_for_type", place: { stateId: "intro", exitId: "intro_ne", fieldId: "sales" } }));
  });

  it("поле «да/нет» сравнивается с «да» или «нет»", () => {
    expect(
      check((json) => {
        json.chatNotes = [...(json.chatNotes ?? []), { id: "paid", name: "Оплатил", type: "boolean" }];
        stateOf(json, "intro").exits.push({ id: "intro_paid", when: { type: "data", field: "paid", op: "eq", value: "да" }, to: "bye" });
      }),
    ).toContainEqual({ level: "error", code: "value_not_boolean", place: { stateId: "intro", exitId: "intro_paid", fieldId: "paid" } });
  });
});

describe("проверка графа v2: свои проверки приложения", () => {
  it("находки приложения идут после встроенных", () => {
    const flow = fixtureFlow("sales-review", (json) => (json.start = "nowhere"));
    const own: FlowIssue = { level: "warning", code: "app_no_price", message: "В «Общем» нет цены", place: {} };
    const issues = checkFlow(flow, catalog, { checks: (checked) => (checked === flow ? [own] : []) });
    expect(issues.map((issue) => issue.code)).toEqual(["unknown_start", "app_no_price"]);
  });

  it("находки приложения в виде редактора: путь в JSON сценария переводится в место", () => {
    const flow = fixtureFlow("sales-review");
    const issues = checkFlow(flow, catalog, {
      checks: () => [
        { path: "states[1].exits[0]", message: "Выход без цены" },
        { path: "clientCard[0]", message: "Имя спрашивать иначе", level: "warning", code: "app_name" },
        { message: "Сценарий без цены" },
      ],
    });
    const own = issues.slice(-3);
    expect(own).toEqual([
      { level: "error", code: "app_check", message: "Выход без цены", place: { stateId: flow.states[1]!.id, exitId: flow.states[1]!.exits[0]!.id } },
      { level: "warning", code: "app_name", message: "Имя спрашивать иначе", place: { fieldId: flow.clientCard[0]!.id } },
      { level: "error", code: "app_check", message: "Сценарий без цены", place: {} },
    ]);
  });

  it("appIssues и placeOfPath доступны из обычной части пакета", () => {
    const flow = fixtureFlow("sales-review");
    expect(placeOfPath(flow, "states[0]")).toEqual({ stateId: flow.states[0]!.id });
    expect(appIssues(flow, [{ path: "nowhere", message: "м" }])).toEqual([{ level: "error", code: "app_check", message: "м", place: {} }]);
  });

  it("без своих проверок — как раньше", () => {
    const flow = fixtureFlow("sales-review");
    expect(checkFlow(flow, catalog, {})).toEqual(checkFlow(flow, catalog));
  });
});
