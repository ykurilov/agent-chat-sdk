import { describe, expect, it } from "vitest";
import type { FlowSchedule } from "../../src/format/flow-format";
import type { FlowRun } from "../../src/engine/flow-run";
import { dayAnchor, dayInProgress, dayOf, dayStartAt, deadlineAt, flowDay, stateDaysDue } from "../../src/engine/flow-days";
import { nextDue, timerDueAt, FLOW_DEADLINE_EXIT } from "../../src/engine/timers";
import { startRun } from "../../src/engine/run-updates";
import { fixtureFlow } from "../flow-fixtures";

// T401: дни сценария по часам человека. 14.10.2026 — среда. Москва — UTC+3 круглый год; Берлин переводит часы
// 25.10.2026 в 3:00 на 2:00; Новосибирск — UTC+7.

const MSK = "Europe/Moscow";
const BERLIN = "Europe/Berlin";
const NSK = "Asia/Novosibirsk";

/** Момент по Москве: день октября 2026 и часы. */
const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);
const nsk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 7, minute);

const schedule = (extra: Partial<FlowSchedule> = {}): FlowSchedule => ({
  dayStart: "09:00",
  nightFrom: "21:00",
  lateStartHours: 3,
  farewellOnDeadline: false,
  ...extra,
});

const run = (startedAt: number, extra: Partial<FlowRun> = {}): FlowRun => ({
  ...startRun(fixtureFlow("sales-review"), startedAt),
  ...extra,
});

describe("dayOf: день, к которому относится момент", () => {
  it("днём — сегодняшний; ночью после начала ночи — завтрашний; до начала дня — сегодняшний с 9:00", () => {
    expect(dayOf(msk(14, 15), MSK, schedule())).toBe("2026-10-14");
    expect(dayOf(msk(14, 1), MSK, schedule())).toBe("2026-10-14");
    expect(dayOf(msk(14, 8, 59), MSK, schedule())).toBe("2026-10-14");
    expect(dayOf(msk(14, 9), MSK, schedule())).toBe("2026-10-14");
    expect(dayOf(msk(14, 20, 59), MSK, schedule())).toBe("2026-10-14");
    expect(dayOf(msk(14, 21), MSK, schedule())).toBe("2026-10-15");
    expect(dayOf(msk(14, 22), MSK, schedule())).toBe("2026-10-15");
  });

  it("ночь не задана — с 21:00, как тихие часы по умолчанию", () => {
    const { nightFrom: _night, ...noNight } = schedule();
    expect(dayOf(msk(14, 21, 30), MSK, noNight)).toBe("2026-10-15");
    expect(dayOf(msk(14, 20, 30), MSK, noNight)).toBe("2026-10-14");
  });

  it("день по поясу человека: 18:00 по Москве в Новосибирске уже ночь", () => {
    expect(dayOf(msk(14, 18), NSK, schedule())).toBe("2026-10-15");
  });
});

describe("dayInProgress: какой день идёт сейчас", () => {
  it("день длится от начала дня до начала следующего: ночь — ещё вчерашний", () => {
    expect(dayInProgress(msk(14, 15), MSK, schedule())).toBe("2026-10-14");
    expect(dayInProgress(msk(14, 23), MSK, schedule())).toBe("2026-10-14");
    expect(dayInProgress(msk(15, 8, 59), MSK, schedule())).toBe("2026-10-14");
    expect(dayInProgress(msk(15, 9), MSK, schedule())).toBe("2026-10-15");
  });
});

describe("dayStartAt: начало дня с учётом перевода часов", () => {
  it("9:00 по Москве и по Берлину до и после перехода на зимнее время", () => {
    expect(dayStartAt("2026-10-15", MSK, schedule())).toBe(msk(15, 9));
    expect(dayStartAt("2026-10-24", BERLIN, schedule())).toBe(Date.UTC(2026, 9, 24, 7));
    expect(dayStartAt("2026-10-25", BERLIN, schedule())).toBe(Date.UTC(2026, 9, 25, 8));
  });
});

describe("stateDaysDue: «нода длится N дней»", () => {
  const entered = (at: number, startedAt = msk(14, 10)) => run(startedAt, { enteredAt: at });

  it("ср 15:00 + 1 день → чт 9:00; 2 дня → пт 9:00", () => {
    expect(stateDaysDue(entered(msk(14, 15)), 1, MSK, schedule())).toBe(msk(15, 9));
    expect(stateDaysDue(entered(msk(14, 15)), 2, MSK, schedule())).toBe(msk(16, 9));
  });

  it("вход в 1:00 и 8:59 — первый день сегодняшний с 9:00; вход в 22:00 — первый день завтра", () => {
    expect(stateDaysDue(entered(msk(14, 1), msk(13, 15)), 1, MSK, schedule())).toBe(msk(15, 9));
    expect(stateDaysDue(entered(msk(14, 8, 59), msk(13, 15)), 1, MSK, schedule())).toBe(msk(15, 9));
    expect(stateDaysDue(entered(msk(14, 22)), 1, MSK, schedule())).toBe(msk(16, 9));
  });

  it("переход на зимнее время: выход в 9:00 по новым часам", () => {
    const berlin = run(Date.UTC(2026, 9, 24, 13), { enteredAt: Date.UTC(2026, 9, 24, 13) });
    expect(stateDaysDue(berlin, 1, BERLIN, schedule())).toBe(Date.UTC(2026, 9, 25, 8));
  });

  it("нода началась в бонусный вечер позднего старта — её первый день — первый день сценария", () => {
    const late = run(msk(14, 20, 30));
    expect(stateDaysDue(late, 1, MSK, schedule())).toBe(msk(16, 9));
  });
});

describe("первый день и поздний старт (→ В1)", () => {
  it("пришёл днём — первый день сегодня", () => {
    expect(dayAnchor(run(msk(14, 15)), MSK, schedule())).toBe(msk(14, 9));
    expect(dayAnchor(run(msk(14, 18)), MSK, schedule())).toBe(msk(14, 9));
  });

  it("до ночи меньше 3 часов — первый день завтра; порог 0 — день старта всегда первый", () => {
    expect(dayAnchor(run(msk(14, 18, 1)), MSK, schedule())).toBe(msk(15, 9));
    expect(dayAnchor(run(msk(14, 20, 30)), MSK, schedule())).toBe(msk(15, 9));
    expect(dayAnchor(run(msk(14, 20, 30)), MSK, schedule({ lateStartHours: 0 }))).toBe(msk(14, 9));
  });

  it("пришёл ночью — первый день ближайшее утро", () => {
    expect(dayAnchor(run(msk(14, 22)), MSK, schedule({ lateStartHours: 0 }))).toBe(msk(15, 9));
    expect(dayAnchor(run(msk(14, 1)), MSK, schedule())).toBe(msk(14, 9));
  });

  it("записанный якорь в том же поясе не пересчитывается", () => {
    expect(dayAnchor(run(msk(14, 15), { dayAnchorAt: msk(13, 9) }), MSK, schedule())).toBe(msk(13, 9));
  });
});

describe("flowDay: номер дня, последний день", () => {
  const three = schedule({ lengthDays: 3 });
  const started = run(msk(14, 15));

  it("день 1 до начала завтрашнего дня, ночью — тоже день 1", () => {
    expect(flowDay(started, msk(14, 16), MSK, three)).toEqual({
      day: 1,
      totalDays: 3,
      isLastDay: false,
      dayStartedAt: msk(14, 9),
      nextDayStartAt: msk(15, 9),
    });
    expect(flowDay(started, msk(15, 1), MSK, three).day).toBe(1);
  });

  it("чт 9:00 — день 2; пт — день 3, последний", () => {
    expect(flowDay(started, msk(15, 9), MSK, three)).toMatchObject({ day: 2, isLastDay: false });
    expect(flowDay(started, msk(16, 10), MSK, three)).toMatchObject({ day: 3, isLastDay: true, nextDayStartAt: msk(17, 9) });
  });

  it("без общего срока — ни всего дней, ни последнего дня", () => {
    const info = flowDay(started, msk(20, 12), MSK, schedule());
    expect(info).toMatchObject({ day: 7, isLastDay: false });
    expect(info).not.toHaveProperty("totalDays");
  });

  it("бонусный вечер позднего старта — день 0", () => {
    expect(flowDay(run(msk(14, 20, 30)), msk(14, 20, 40), MSK, three)).toMatchObject({ day: 0, isLastDay: false, nextDayStartAt: msk(15, 9) });
  });
});

describe("deadlineAt: «срок вышел»", () => {
  it("начало дня N+1; без срока — нет", () => {
    expect(deadlineAt(run(msk(14, 15)), MSK, schedule({ lengthDays: 3 }))).toBe(msk(17, 9));
    expect(deadlineAt(run(msk(14, 20, 30)), MSK, schedule({ lengthDays: 3 }))).toBe(msk(18, 9));
    expect(deadlineAt(run(msk(14, 15)), MSK, schedule())).toBeNull();
  });
});

describe("пояс человека сменился (FR-207)", () => {
  it("в первый день — первый день и сроки по новому поясу", () => {
    // Якорь посчитан по Москве: ср 9:00 МСК. Человек в Новосибирске сказал это в ср 10:00 МСК (14:00 у него).
    const moved = run(msk(14, 10), { dayAnchorAt: msk(14, 9), lastHumanAt: msk(14, 10) });
    expect(dayAnchor(moved, NSK, schedule())).toBe(nsk(14, 9));
    expect(stateDaysDue(moved, 1, NSK, schedule())).toBe(nsk(15, 9));
  });

  it("в третий день — номер дня тот же, новые сроки по новому поясу", () => {
    const moved = run(msk(14, 10), { dayAnchorAt: msk(14, 9), lastHumanAt: msk(16, 12) });
    expect(flowDay(moved, msk(16, 12), NSK, schedule({ lengthDays: 3 })).day).toBe(3);
    expect(deadlineAt(moved, NSK, schedule({ lengthDays: 3 }))).toBe(nsk(17, 9));
  });
});

describe("таймеры: продолжительность ноды и срок сценария", () => {
  const daysFlow = (lengthDays?: number) =>
    fixtureFlow("sales-review", (json) => {
      json.schedule = { dayStart: "09:00", nightFrom: "21:00", ...(lengthDays && { lengthDays }) };
      json.states.find((state: { id: string }) => state.id === "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" });
    });

  it("timerDueAt считает «длится N дней» по «Дням и времени»", () => {
    const flow = daysFlow();
    const when = { type: "timer", from: "state_days", days: 1 } as const;
    expect(timerDueAt(when, run(msk(14, 15)), MSK, flow.schedule)).toBe(msk(15, 9));
    expect(timerDueAt(when, run(msk(14, 15)), MSK)).toBeNull();
  });

  it("nextDue: выход ноды по дням; срок сценария побеждает при равенстве; законченный — без сроков", () => {
    expect(nextDue(daysFlow(), run(msk(14, 15)), msk(14, 15), MSK)).toEqual({ at: msk(15, 9), exitId: "intro_day" });
    expect(nextDue(daysFlow(1), run(msk(14, 15)), msk(14, 15), MSK)).toEqual({ at: msk(15, 9), exitId: FLOW_DEADLINE_EXIT });
    expect(nextDue(daysFlow(1), run(msk(14, 15), { endedAt: msk(14, 16), endReason: "deadline" }), msk(14, 16), MSK)).toBeNull();
  });
});
