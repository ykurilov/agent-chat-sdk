import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_FLOW_FORMAT_VERSION,
  DEFAULT_LATE_START_HOURS,
  DEFAULT_SIDE_TASK_MAX_ATTEMPTS,
  FLOW_OPS_BY_FIELD_TYPE,
  compactFlow,
  migrateFlow,
  parseFlow,
  type AgentFlow,
  type ParseFlowResult,
} from "../src/format";
import { dataConditionHolds } from "../src/engine/data-conditions";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Record<string, any>;
const examples = ["sales-review", "shop-support", "sheets-lesson"] as const;

function parsed(input: unknown): AgentFlow {
  const result = parseFlow(input);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  return result.flow;
}

function errorsOf(result: ParseFlowResult) {
  if (result.ok) throw new Error("сценарий разобрался, а не должен был");
  return result.errors;
}

const minimal = () => ({ format: "agent-flow", version: 2, id: "one", name: "Один", states: [{ id: "s1", title: "Начало" }] });

/** Ключи сценария после `parseFlow` в 0.48: без новых полей сценарий v2 выглядит так же. */
const KEYS_048 = ["format", "version", "id", "name", "start", "common", "pace", "clientCard", "chatNotes", "tools", "anyState", "states", "layout"];
const STATE_KEYS_048 = ["id", "kind", "title", "instructions", "firstMessage", "learn", "noSideQuestions", "tools", "tags", "exits"];

describe("формат v2: перевод из версии 1", () => {
  it("текущая версия формата — 2", () => {
    expect(AGENT_FLOW_FORMAT_VERSION).toBe(2);
  });

  it.each(examples)("%s (v1 из 0.48) открывается как v2 и по смыслу не меняется", (name) => {
    const v1 = fixture(name);
    expect(v1.version).toBe(1);
    const flow = parsed(v1);
    expect(flow.version).toBe(2);
    expect(Object.keys(flow)).toEqual(KEYS_048);
    for (const state of flow.states) expect(Object.keys(state)).toEqual(STATE_KEYS_048);
    expect(parsed({ ...v1, version: 2 })).toEqual(flow);
  });

  it("шаг 1 → 2 только меняет номер версии", () => {
    const v1 = fixture("sales-review");
    expect(migrateFlow(v1, 1)).toEqual({ ...v1, version: 2 });
  });
});

describe("формат v2: новые поля", () => {
  const schedule = {
    dayStart: "09:00",
    nightFrom: "21:00",
    lengthDays: 3,
    deadlineState: "s1",
    firstMessages: { maxPerDay: 2, morning: true, skipMorningIfHumanWithinMin: 180 },
    nudges: { afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }], dailyAt: ["10:00"], giveUpAfter: { amount: 3, unit: "d" } },
    dayFrame: { softFrom: 20, hardAt: 30, hardText: "На сегодня всё, продолжим завтра." },
  };

  it("«Дни и время»: читаются, порог позднего старта и прощание при сроке — по умолчанию", () => {
    const flow = parsed({ ...minimal(), schedule });
    expect(flow.schedule).toEqual({ ...schedule, lateStartHours: DEFAULT_LATE_START_HOURS, farewellOnDeadline: false });
    expect(DEFAULT_LATE_START_HOURS).toBe(3);
  });

  it("порог 0 — правило «день старта — первый», прощание можно включить", () => {
    const flow = parsed({ ...minimal(), schedule: { dayStart: "09:00", lateStartHours: 0, farewellOnDeadline: true } });
    expect(flow.schedule).toEqual({ dayStart: "09:00", lateStartHours: 0, farewellOnDeadline: true });
  });

  it("касания ноды: своё расписание или «off»", () => {
    const flow = parsed({
      ...minimal(),
      states: [
        { id: "s1", title: "Сборка", nudges: { afterSilence: [{ amount: 4, unit: "h" }] } },
        { id: "s2", title: "Тихо", nudges: "off" },
      ],
    });
    expect(flow.states[0]!.nudges).toEqual({ afterSilence: [{ amount: 4, unit: "h" }] });
    expect(flow.states[1]!.nudges).toBe("off");
  });

  it("таймер «нода длится N дней»", () => {
    const flow = parsed({
      ...minimal(),
      states: [{ id: "s1", title: "Сборка", exits: [{ id: "x1", when: { type: "timer", from: "state_days", days: 1 }, to: "s1" }] }],
    });
    expect(flow.states[0]!.exits[0]!.when).toEqual({ type: "timer", from: "state_days", days: 1 });
  });

  it("таймер «наступил день N программы» — дополнение к v2", () => {
    const flow = parsed({
      ...minimal(),
      states: [{ id: "s1", title: "Сборка", exits: [{ id: "x1", when: { type: "timer", from: "program_day", day: 3 }, to: "s1" }] }],
    });
    expect(flow.version).toBe(2);
    expect(flow.states[0]!.exits[0]!.when).toEqual({ type: "timer", from: "program_day", day: 3 });
    expect(parsed(compactFlow(flow))).toEqual(flow);
    // Без номера дня — ошибка формы; дробный и меньше 1 — находка `checkFlow`, черновик сохраняется.
    const noDay = { ...minimal(), states: [{ id: "s1", title: "", exits: [{ id: "x1", when: { type: "timer", from: "program_day" } }] }] };
    expect(errorsOf(parseFlow(noDay))[0]!.path).toBe("states[0].exits[0].when.day");
    const fractional = { ...minimal(), states: [{ id: "s1", title: "", exits: [{ id: "x1", when: { type: "timer", from: "program_day", day: 2.5 } }] }] };
    expect(parseFlow(fractional).ok).toBe(true);
  });

  it("поле «да/нет»: операции «=» и «≠», значение — true/false", () => {
    expect(FLOW_OPS_BY_FIELD_TYPE.boolean).toEqual(["filled", "eq", "ne"]);
    const flow = parsed({
      ...minimal(),
      chatNotes: [{ id: "paid", name: "Оплатил", type: "boolean" }],
      states: [{ id: "s1", title: "", exits: [{ id: "x1", when: { type: "data", field: "paid", op: "ne", value: true }, to: "s1" }] }],
    });
    expect(flow.chatNotes[0]!.type).toBe("boolean");
    expect(flow.states[0]!.exits[0]!.when).toEqual({ type: "data", field: "paid", op: "ne", value: true });
  });

  it("условие по полю «да/нет»: = и ≠ сравнивают true/false, текст «да» не подходит", () => {
    expect(dataConditionHolds({ type: "data", field: "paid", op: "eq", value: true }, "boolean", true)).toBe(true);
    expect(dataConditionHolds({ type: "data", field: "paid", op: "ne", value: true }, "boolean", false)).toBe(true);
    expect(dataConditionHolds({ type: "data", field: "paid", op: "ne", value: true }, "boolean", true)).toBe(false);
    expect(dataConditionHolds({ type: "data", field: "paid", op: "eq", value: true }, "boolean", "да")).toBe(false);
    expect(dataConditionHolds({ type: "data", field: "paid", op: "filled" }, "boolean", false)).toBe(true);
    expect(dataConditionHolds({ type: "data", field: "rating", op: "ne", value: 3 }, "number", 4)).toBe(false);
  });

  it("попутные задачи: две попытки на человека по умолчанию, «заново в каждом разговоре» — флаг", () => {
    const flow = parsed({
      ...minimal(),
      sideTasks: [
        { id: "subscribe", text: "Предложи подписаться на канал", when: "после разбора", field: "subscribed" },
        { id: "review", text: "Попроси отзыв", maxAttempts: 1, perConversation: true },
      ],
    });
    expect(DEFAULT_SIDE_TASK_MAX_ATTEMPTS).toBe(2);
    expect(flow.sideTasks).toEqual([
      { id: "subscribe", text: "Предложи подписаться на канал", when: "после разбора", field: "subscribed", maxAttempts: 2, perConversation: false },
      { id: "review", text: "Попроси отзыв", maxAttempts: 1, perConversation: true },
    ]);
  });

  it("сжатие убирает значения по умолчанию, разбор возвращает тот же сценарий", () => {
    const json = {
      ...minimal(),
      schedule: { dayStart: "09:00", lengthDays: 3, nudges: { afterSilence: [{ amount: 15, unit: "min" }] } },
      sideTasks: [{ id: "subscribe", text: "Подписка" }],
      chatNotes: [{ id: "paid", name: "Оплатил", type: "boolean" }],
      states: [
        {
          id: "s1",
          title: "Сборка",
          nudges: "off",
          exits: [{ id: "x1", when: { type: "timer", from: "state_days", days: 2 }, to: "s1" }],
        },
      ],
    };
    const flow = parsed(json);
    expect(compactFlow(flow)).toEqual(json);
    expect(parsed(compactFlow(flow))).toEqual(flow);
  });
});

describe("формат v2: ошибки формы", () => {
  it("начало дня, ночь и время касаний — только «ЧЧ:ММ»", () => {
    const errors = errorsOf(
      parseFlow({ ...minimal(), schedule: { dayStart: "9", nightFrom: "25:00", nudges: { afterSilence: [], dailyAt: ["7 утра"] } } }),
    );
    expect(errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(["schedule.dayStart", "schedule.nightFrom", "schedule.nudges.dailyAt[0]"]),
    );
  });

  it("срок сценария — от 1 до 60 дней, порог позднего старта — от 0 до 24 часов", () => {
    for (const lengthDays of [0, 61, 1.5]) {
      expect(errorsOf(parseFlow({ ...minimal(), schedule: { dayStart: "09:00", lengthDays } }))[0]!.path).toBe("schedule.lengthDays");
    }
    for (const lateStartHours of [-1, 25]) {
      expect(errorsOf(parseFlow({ ...minimal(), schedule: { dayStart: "09:00", lateStartHours } }))[0]!.path).toBe(
        "schedule.lateStartHours",
      );
    }
  });

  it("«Дни и время» без начала дня — ошибка формы", () => {
    expect(errorsOf(parseFlow({ ...minimal(), schedule: { lengthDays: 3 } }))[0]!.path).toBe("schedule.dayStart");
  });

  it("касание без срока, неизвестная единица, касания ноды — не «off» и не расписание", () => {
    const errors = errorsOf(
      parseFlow({
        ...minimal(),
        schedule: { dayStart: "09:00", nudges: { afterSilence: [{ amount: 15 }, { amount: 1, unit: "week" }] } },
        states: [{ id: "s1", title: "", nudges: "never" }],
      }),
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("schedule.nudges.afterSilence[0].unit");
    expect(paths).toContain("schedule.nudges.afterSilence[1].unit");
    expect(paths).toContain("states[0].nudges");
  });

  it("попутная задача без текста или с лишним полем, попыток меньше одной", () => {
    const errors = errorsOf(
      parseFlow({
        ...minimal(),
        sideTasks: [{ id: "a" }, { id: "b", text: "Отзыв", colour: "red" }, { id: "c", text: "Канал", maxAttempts: 0 }],
      }),
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("sideTasks[0].text");
    expect(paths).toContain("sideTasks[1].colour");
    expect(paths).toContain("sideTasks[2].maxAttempts");
  });

  it("«нода длится» — целое число дней", () => {
    const flow = { ...minimal(), states: [{ id: "s1", title: "", exits: [{ id: "x1", when: { type: "timer", from: "state_days", days: 1.5 } }] }] };
    expect(errorsOf(parseFlow(flow))[0]!.path).toBe("states[0].exits[0].when.days");
  });

  it("«≠» — только для поля «да/нет» (проверка графа), а в форме разрешено вместе со значением", () => {
    const errors = errorsOf(
      parseFlow({ ...minimal(), states: [{ id: "s1", title: "", exits: [{ id: "x1", when: { type: "data", field: "paid", op: "ne" } }] }] }),
    );
    expect(errors[0]!.path).toBe("states[0].exits[0].when.value");
  });
});
