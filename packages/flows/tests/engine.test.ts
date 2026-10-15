import { describe, expect, it } from "vitest";
import {
  FLOW_CHAIN_LIMIT,
  FLOW_PATH_LIMIT,
  applyTransition,
  claimAllowed,
  dataConditionHolds,
  nextDue,
  nextTransition,
  noteAgentAnswer,
  noteHumanMessage,
  noteRejectedClaim,
  noteSideQuestion,
  startRun,
  type AgentFlow,
  type FlowEvent,
  type FlowRun,
  type Transition,
} from "../src/format";
import { DAY, HOUR, MIN, fixtureFlow, stateOf } from "./flow-fixtures";

const TZ = "Europe/Moscow";
/** 13.10.2026 09:00 по Москве. */
const T0 = Date.UTC(2026, 9, 13, 6, 0);

const message: FlowEvent = { type: "event", event: "message" };
const verdict = (exitId: string, probability = 0.98): FlowEvent => ({ type: "verdict", exitId, probability, decidedBy: "claim" });
const timer = (exitId: string): FlowEvent => ({ type: "timer", exitId, timeZone: TZ });

/** Находит переход и сразу применяет его; падает, если движок решил остаться. */
function go(flow: AgentFlow, run: FlowRun, event: FlowEvent, at: number): FlowRun {
  const transition = nextTransition(flow, run, event, at);
  if (!transition) throw new Error(`перехода нет: ${JSON.stringify(event)} в «${run.state}»`);
  return applyTransition(flow, run, transition);
}

/** Чат, вошедший в `state` обычным переходом в момент `at`. */
function runIn(flow: AgentFlow, state: string, at: number): FlowRun {
  const run = startRun(flow, at);
  if (run.state === state) return run;
  const target = flow.states.find((candidate) => candidate.id === state)!;
  return noteAgentAnswer(
    applyTransition(flow, run, { from: run.state, to: state, exitId: "test", decidedBy: "event", tags: target.tags, at }),
    at,
  );
}

describe("старт и «остаться»", () => {
  const sales = fixtureFlow("sales-review");

  it("чат начинается в стартовом состоянии, путь — одна запись «старт»", () => {
    const run = startRun(sales, T0);
    expect(run).toMatchObject({ state: "intro", enteredAt: T0, startedAt: T0, pausedClocks: {}, notes: {}, chain: 0 });
    expect(run.path).toEqual([{ state: "intro", at: T0, tags: [], from: null, exitId: null, decidedBy: "start" }]);
  });

  it("без старта сценарий не запускается", () => {
    const flow = fixtureFlow("sales-review", (json) => delete json.start);
    expect(() => startRun(flow, T0)).toThrow(/старт/);
  });

  it("ничего не сработало — агент остаётся (В2)", () => {
    const run = startRun(sales, T0);
    expect(nextTransition(sales, run, { type: "event", event: "button", name: "booking_link" }, T0)).toBeNull();
    expect(nextTransition(sales, run, message, T0)).toBeNull();
    // Вердикт по условию другого состояния ничего не меняет.
    expect(nextTransition(sales, run, verdict("block_found"), T0)).toBeNull();
  });

  it("вердикт по условию не словами не принимается", () => {
    const run = runIn(sales, "offer", T0);
    expect(nextTransition(sales, run, verdict("offer_link"), T0)).toBeNull();
  });
});

describe("порядок условий", () => {
  it("судья подтвердил второе условие — переход по второму", () => {
    const sales = fixtureFlow("sales-review");
    const transition = nextTransition(sales, runIn(sales, "block", T0), verdict("block_found", 0.91), T0 + MIN);
    expect(transition).toEqual<Transition>({
      from: "block",
      to: "offer",
      exitId: "block_found",
      decidedBy: "claim",
      probability: 0.91,
      tags: ["продажа"],
      at: T0 + MIN,
      reason: { kind: "claim", text: "Согласился, что затык найден" },
    });
  });

  it("свои условия раньше общих", () => {
    const flow = fixtureFlow("sales-review", (json) => {
      json.anyState.exits.push({ id: "any_message", when: { type: "event", event: "message" }, to: "bye" });
      stateOf(json, "block").exits.push({ id: "block_message", when: { type: "event", event: "message" }, to: "offer" });
    });
    expect(nextTransition(flow, runIn(flow, "block", T0), message, T0)?.exitId).toBe("block_message");
    expect(nextTransition(flow, runIn(flow, "intro", T0), message, T0)?.exitId).toBe("any_message");
  });

  it("общий переход в то же состояние не срабатывает", () => {
    const sales = fixtureFlow("sales-review");
    const run = { ...runIn(sales, "remind", T0), lastAgentAt: T0 };
    expect(nextTransition(sales, run, timer("any_silence"), T0 + 4 * HOUR)).toBeNull();
  });

  it("по данным: сработало несколько — первое по порядку", () => {
    const lesson = fixtureFlow("sheets-lesson");
    const task = runIn(lesson, "task", T0);
    const both = { ...task, notes: { correct: "да", tries: 3 } };
    expect(nextTransition(lesson, both, { type: "data" }, T0)?.to).toBe("done");
    const wrong = { ...task, notes: { correct: "нет", tries: 3 } };
    expect(nextTransition(lesson, wrong, { type: "data" }, T0)?.exitId).toBe("task_many_tries");
    // Изменилось только поле «Верно»: смотрим условия по нему.
    expect(nextTransition(lesson, wrong, { type: "data", field: "correct" }, T0)?.exitId).toBe("task_wrong");
    expect(nextTransition(lesson, { ...task, notes: { correct: "нет" } }, { type: "data" }, T0)).toMatchObject({
      to: "hint",
      decidedBy: "data",
    });
  });

  it("по данным: поле карточки клиента приходит в событии, значение не по типу — неизвестно", () => {
    const flow = fixtureFlow("sales-review", (json) => {
      stateOf(json, "intro").exits.unshift({
        id: "intro_big",
        when: { type: "data", field: "sales", op: "eq", value: "больше 10 продаж" },
        to: "offer",
      });
    });
    const run = startRun(flow, T0);
    expect(nextTransition(flow, run, { type: "data", card: { sales: "больше 10 продаж" } }, T0)?.to).toBe("offer");
    expect(nextTransition(flow, run, { type: "data", card: { sales: 15 } }, T0)).toBeNull();
    expect(nextTransition(flow, run, { type: "data" }, T0)).toBeNull();
  });

  it("событие: вызван инструмент и нажата кнопка — по имени", () => {
    const shop = fixtureFlow("shop-support");
    const order = runIn(shop, "order", T0);
    expect(nextTransition(shop, order, { type: "event", event: "tool", name: "find_order" }, T0)).toMatchObject({
      to: "status",
      decidedBy: "event",
    });
    expect(nextTransition(shop, order, { type: "event", event: "tool", name: "call_operator" }, T0)).toBeNull();
    const refund = runIn(shop, "refund", T0);
    expect(nextTransition(shop, refund, { type: "event", event: "button", name: "start_refund" }, T0)?.to).toBe("rate");
  });

  it("условие без цели пропускается", () => {
    const flow = fixtureFlow("sales-review", (json) => {
      stateOf(json, "block").exits[1].to = null;
    });
    expect(nextTransition(flow, runIn(flow, "block", T0), verdict("block_found"), T0)).toBeNull();
  });
});

describe("таймеры", () => {
  const sales = fixtureFlow("sales-review");

  it("время в состоянии", () => {
    expect(nextDue(sales, runIn(sales, "doubts", T0), T0, TZ)).toEqual({ at: T0 + 20 * MIN, exitId: "doubts_timeout" });
  });

  it("наступивший раньше побеждает: общий таймер раньше своего", () => {
    const flow = fixtureFlow("sales-review", (json) => {
      stateOf(json, "doubts").exits[2].when = { type: "timer", from: "in_state", amount: 4, unit: "h" };
    });
    expect(nextDue(flow, runIn(flow, "doubts", T0), T0, TZ)).toEqual({ at: T0 + 3 * HOUR, exitId: "any_silence" });
  });

  it("при равенстве — таймер состояния (В3)", () => {
    const flow = fixtureFlow("sales-review", (json) => {
      stateOf(json, "doubts").exits[2].when = { type: "timer", from: "in_state", amount: 180, unit: "min" };
    });
    expect(nextDue(flow, runIn(flow, "doubts", T0), T0, TZ)).toEqual({ at: T0 + 3 * HOUR, exitId: "doubts_timeout" });
  });

  it("тишина — от последнего ответа агента; человек ответил — тишины нет", () => {
    const block = runIn(sales, "block", T0);
    expect(nextDue(sales, block, T0, TZ)).toEqual({ at: T0 + 3 * HOUR, exitId: "any_silence" });
    const human = noteHumanMessage(block, T0 + 3 * HOUR - MIN);
    expect(nextDue(sales, human, T0 + 3 * HOUR - MIN, TZ)).toBeNull();
    const answered = noteAgentAnswer(human, T0 + 3 * HOUR);
    expect(nextDue(sales, answered, T0 + 3 * HOUR, TZ)).toEqual({ at: T0 + 6 * HOUR, exitId: "any_silence" });
  });

  it("с начала сценария", () => {
    const run = { ...runIn(sales, "morning", T0 + DAY), startedAt: T0 };
    expect(nextDue(sales, run, T0 + DAY, TZ)).toEqual({ at: T0 + 3 * DAY, exitId: "morning_bye" });
  });

  it("время суток — в поясе человека, ближайшее после входа", () => {
    const at8 = Date.UTC(2026, 9, 13, 5, 0); // 08:00 Москва
    expect(nextDue(sales, { ...runIn(sales, "remind", at8), lastAgentAt: null }, at8, TZ)).toEqual({
      at: Date.UTC(2026, 9, 13, 7, 0),
      exitId: "remind_morning",
    });
    const at11 = Date.UTC(2026, 9, 13, 8, 0); // 11:00 Москва — уже после 10:00
    expect(nextDue(sales, { ...runIn(sales, "remind", at11), lastAgentAt: null }, at11, TZ)).toEqual({
      at: Date.UTC(2026, 9, 14, 7, 0),
      exitId: "remind_morning",
    });
    // Те же 08:00 по Москве — это 13:00 на Бали: утро там завтра.
    expect(nextDue(sales, { ...runIn(sales, "remind", at8), lastAgentAt: null }, at8, "Asia/Makassar")).toEqual({
      at: Date.UTC(2026, 9, 14, 2, 0),
      exitId: "remind_morning",
    });
  });

  it("сработал наступивший таймер; не наступивший или устаревший — нет", () => {
    const block = runIn(sales, "block", T0);
    expect(nextTransition(sales, block, timer("any_silence"), T0 + 3 * HOUR)).toMatchObject({
      to: "remind",
      decidedBy: "timer",
      tags: ["касание"],
    });
    expect(nextTransition(sales, block, timer("any_silence"), T0 + 2 * HOUR)).toBeNull();
    // Человек успел ответить — тишины уже нет.
    expect(nextTransition(sales, noteHumanMessage(block, T0 + HOUR), timer("any_silence"), T0 + 3 * HOUR)).toBeNull();
  });
});

describe("«назад» (В1) и часы состояния (В5)", () => {
  const sales = fixtureFlow("sales-review");

  it("«назад» пропускает касания: Поиск затыка → Напоминание → Утро → Поиск затыка", () => {
    let run = runIn(sales, "block", T0);
    run = noteAgentAnswer(go(sales, run, timer("any_silence"), T0 + 3 * HOUR), T0 + 3 * HOUR);
    expect(run.state).toBe("remind");
    const morningAt = Date.UTC(2026, 9, 14, 7, 0);
    run = noteAgentAnswer(go(sales, run, timer("remind_morning"), morningAt), morningAt);
    expect(run.state).toBe("morning");
    run = noteHumanMessage(run, morningAt + HOUR);
    const back = nextTransition(sales, run, message, morningAt + HOUR);
    expect(back).toMatchObject({ from: "morning", to: "block", exitId: "morning_message", returned: true });
  });

  it("основного в пути нет — «назад» ведёт в старт", () => {
    const run = runIn(sales, "morning", T0);
    const onlyTouches: FlowRun = {
      ...run,
      path: [
        { state: "remind", at: T0 - HOUR, tags: ["касание"], from: null, exitId: null, decidedBy: "timer" },
        { state: "morning", at: T0, tags: ["касание"], from: "remind", exitId: "remind_morning", decidedBy: "timer" },
      ],
    };
    expect(nextTransition(sales, onlyTouches, message, T0 + MIN)?.to).toBe("intro");
  });

  it("часы стоят в касании и продолжаются после «назад»", () => {
    let run = runIn(sales, "doubts", T0);
    const remind = sales.states.find((state) => state.id === "remind")!;
    // На 15-й минуте — в напоминание.
    run = applyTransition(sales, run, {
      from: "doubts",
      to: "remind",
      exitId: "any_silence",
      decidedBy: "timer",
      tags: remind.tags,
      at: T0 + 15 * MIN,
    });
    expect(run.pausedClocks).toEqual({ doubts: 15 * MIN });
    run = noteAgentAnswer(run, T0 + 15 * MIN);
    // Касание → касание: часы всё ещё стоят.
    run = noteAgentAnswer(
      applyTransition(sales, run, { from: "remind", to: "morning", exitId: "remind_morning", decidedBy: "timer", tags: [], at: T0 + 30 * MIN }),
      T0 + 30 * MIN,
    );
    expect(run.pausedClocks).toEqual({ doubts: 15 * MIN });
    run = go(sales, noteHumanMessage(run, T0 + 40 * MIN), message, T0 + 40 * MIN);
    expect(run.state).toBe("doubts");
    expect(run.enteredAt).toBe(T0 + 25 * MIN);
    expect(run.pausedClocks).toEqual({});
    // До прощания по «20 минут в состоянии» остаётся 5 минут.
    expect(nextDue(sales, noteAgentAnswer(run, T0 + 41 * MIN), T0 + 41 * MIN, TZ)).toEqual({
      at: T0 + 45 * MIN,
      exitId: "doubts_timeout",
    });
  });

  it("обычный вход — отсчёт с нуля", () => {
    let run = runIn(sales, "doubts", T0);
    run = go(sales, run, verdict("doubts_ready"), T0 + 10 * MIN);
    run = go(sales, run, verdict("offer_doubts"), T0 + 12 * MIN);
    expect(run).toMatchObject({ state: "doubts", enteredAt: T0 + 12 * MIN, pausedClocks: {} });
  });
});

describe("путь и метки (В6)", () => {
  it("запись пути несёт метки нового состояния, условие, кто решил и уверенность", () => {
    const sales = fixtureFlow("sales-review");
    const run = go(sales, runIn(sales, "block", T0), verdict("block_found", 0.93), T0 + MIN);
    expect(run.state).toBe("offer");
    expect(run.path.at(-1)).toEqual({
      state: "offer",
      at: T0 + MIN,
      tags: ["продажа"],
      from: "block",
      exitId: "block_found",
      decidedBy: "claim",
      probability: 0.93,
      reason: { kind: "claim", text: "Согласился, что затык найден" },
    });
    expect(run.lastRejected).toBeNull();
  });

  it("переход помнит ответ агента, на котором вошли в состояние: судья после хода смотрит реплики с него", () => {
    const sales = fixtureFlow("sales-review");
    let run = go(sales, { ...runIn(sales, "intro", T0), answerId: "a1" }, verdict("intro_clear"), T0 + MIN);
    expect(run.enteredAfterAnswer).toBe("a1");
    run = go(sales, { ...noteHumanMessage(run, T0 + 2 * MIN), answerId: "a2" }, verdict("block_found"), T0 + 3 * MIN);
    expect(run.enteredAfterAnswer).toBe("a2");
    // Симуляция редактора без ответов: отметки нет.
    expect(go(sales, runIn(sales, "intro", T0), verdict("intro_clear"), T0 + MIN).enteredAfterAnswer).toBeUndefined();
  });

  it(`в пути не больше ${FLOW_PATH_LIMIT} записей`, () => {
    const flow = fixtureFlow("sheets-lesson");
    let run = runIn(flow, "hint", T0);
    for (let step = 0; step < 60; step += 1) {
      const exitId = run.state === "hint" ? "hint_given" : "explain_got_it";
      run = noteAgentAnswer(run.state === "task" ? go(flow, { ...run, notes: { correct: "нет" } }, { type: "data" }, T0) : go(flow, run, verdict(exitId), T0), T0);
    }
    expect(run.path).toHaveLength(FLOW_PATH_LIMIT);
  });
});

describe("конец и исключения общих", () => {
  it("в конечном состоянии ничего не срабатывает и таймеры не идут", () => {
    const sales = fixtureFlow("sales-review");
    const bye = runIn(sales, "bye", T0);
    expect(nextDue(sales, bye, T0, TZ)).toBeNull();
    expect(nextTransition(sales, bye, message, T0)).toBeNull();
    expect(nextTransition(sales, bye, timer("any_silence"), T0 + DAY)).toBeNull();
  });

  it("общие переходы не действуют в исключённых состояниях", () => {
    const shop = fixtureFlow("shop-support");
    expect(nextTransition(shop, runIn(shop, "status", T0), verdict("any_angry"), T0)?.to).toBe("operator");
    expect(nextTransition(shop, runIn(shop, "rate", T0), verdict("any_angry"), T0)).toBeNull();
    const sales = fixtureFlow("sales-review");
    // «Утреннее касание» исключено: общей тишины нет, только свой таймер.
    expect(nextDue(sales, runIn(sales, "morning", T0), T0, TZ)).toEqual({ at: T0 + 3 * DAY, exitId: "morning_bye" });
  });
});

describe(`зацикливание: не больше ${FLOW_CHAIN_LIMIT} переходов подряд`, () => {
  it("шестой переход без ответа агента не делается; ответ агента или человека снимает остановку", () => {
    const flow = fixtureFlow("sheets-lesson");
    let run = noteAgentAnswer(runIn(flow, "task", T0), T0);
    for (let step = 0; step < FLOW_CHAIN_LIMIT; step += 1) {
      const event: FlowEvent = run.state === "task" ? { type: "data" } : verdict("hint_given");
      run = go(flow, run.state === "task" ? { ...run, notes: { correct: "нет" } } : run, event, T0);
    }
    expect(run.chain).toBe(FLOW_CHAIN_LIMIT);
    expect(run.state).toBe("hint");
    expect(nextTransition(flow, run, verdict("hint_given"), T0)).toBeNull();
    expect(nextTransition(flow, noteAgentAnswer(run, T0), verdict("hint_given"), T0)?.to).toBe("task");
    expect(nextTransition(flow, noteHumanMessage(run, T0), verdict("hint_given"), T0)?.to).toBe("task");
  });
});

describe("заявки агента и вопросы между делом", () => {
  it("отклонённый выход можно заявить снова только после сообщения человека", () => {
    const sales = fixtureFlow("sales-review");
    const rejected = noteRejectedClaim(runIn(sales, "block", T0), "block_found");
    expect(claimAllowed(rejected, "block_found")).toBe(false);
    expect(claimAllowed(rejected, "block_not_ready")).toBe(true);
    expect(claimAllowed(noteHumanMessage(rejected, T0 + MIN), "block_found")).toBe(true);
  });

  it("вопрос между делом запоминает номер сообщения человека", () => {
    const sales = fixtureFlow("sales-review");
    const run = noteHumanMessage(noteHumanMessage(startRun(sales, T0), T0), T0);
    expect(noteSideQuestion(run).sideQuestionAt).toBe(2);
  });
});

describe("условия по данным", () => {
  const holds = dataConditionHolds;

  it("«заполнено» по типу поля", () => {
    expect(holds({ type: "data", field: "f", op: "filled" }, "text", "Инстаграм")).toBe(true);
    expect(holds({ type: "data", field: "f", op: "filled" }, "text", "  ")).toBe(false);
    expect(holds({ type: "data", field: "f", op: "filled" }, "text", undefined)).toBe(false);
    expect(holds({ type: "data", field: "f", op: "filled" }, "number", 0)).toBe(true);
    expect(holds({ type: "data", field: "f", op: "filled" }, "number", Number.NaN)).toBe(false);
    expect(holds({ type: "data", field: "f", op: "filled" }, "number", "5")).toBe(false);
    expect(holds({ type: "data", field: "f", op: "filled" }, "choice", "да")).toBe(true);
  });

  it("равно, больше, меньше, содержит", () => {
    expect(holds({ type: "data", field: "f", op: "eq", value: "да" }, "choice", "Да")).toBe(true);
    expect(holds({ type: "data", field: "f", op: "eq", value: "да" }, "choice", "нет")).toBe(false);
    expect(holds({ type: "data", field: "f", op: "eq", value: 3 }, "number", 3)).toBe(true);
    expect(holds({ type: "data", field: "f", op: "gt", value: 2 }, "number", 3)).toBe(true);
    expect(holds({ type: "data", field: "f", op: "gt", value: "2" }, "number", 2)).toBe(false);
    expect(holds({ type: "data", field: "f", op: "lt", value: 2 }, "number", 1)).toBe(true);
    expect(holds({ type: "data", field: "f", op: "contains", value: "инста" }, "text", "В основном Инстаграм")).toBe(true);
    expect(holds({ type: "data", field: "f", op: "contains", value: "тикток" }, "text", "Инстаграм")).toBe(false);
  });

  it("сравнение не по типу поля не срабатывает", () => {
    expect(holds({ type: "data", field: "f", op: "gt", value: 2 }, "text", "5")).toBe(false);
    expect(holds({ type: "data", field: "f", op: "contains", value: "а" }, "choice", "да")).toBe(false);
  });
});
