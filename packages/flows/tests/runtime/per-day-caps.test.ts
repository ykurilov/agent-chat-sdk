import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, OWNER, tick, timerChat, type TimerChat } from "./timer-chat";
import { msk } from "./days-chat";

// 104: потолок «пишет первым» по дням программы (`firstMessages.maxPerDayByDay`) и частый ряд ноды до N-го дня
// программы (`nudges.untilProgramDay`). Счёт — по дням программы, ответ человека его не обнуляет.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const MIN = 60_000;
const THREE_HOURS = { amount: 3, unit: "h" };

/** Ходы «пишет первым» по пути часов (шаг минута): когда каждый случился и с какими причинами. */
async function firstTurnsUntil(chat: TimerChat, id: string, until: number) {
  const turns = async () => (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer" && notice.wakeAgent);
  const seen: Array<{ at: number; reasons: unknown }> = [];
  let count = (await turns()).length;
  let at = Date.now();
  while (at < until) {
    at = Math.min(at + MIN, until);
    clockAt(at);
    await tick(chat, id);
    const now = await turns();
    for (const turn of now.slice(count)) seen.push({ at, reasons: (turn.data as { reasons: unknown }).reasons });
    count = now.length;
  }
  return seen;
}

/** Молчун: общий ряд 3 ч · 3 ч · 3 ч, утреннее, ночь 21:00–09:00, программа 5 дней. */
const silentSchedule = (firstMessages: Record<string, unknown>) => (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = {
    dayStart: "09:00",
    nightFrom: "21:00",
    lengthDays: 5,
    firstMessages: { morning: true, ...firstMessages },
    nudges: { afterSilence: [THREE_HOURS, THREE_HOURS, THREE_HOURS] },
  };
};

async function started(chat: TimerChat) {
  clockAt(msk(13, 10));
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return id;
}

describe("потолок по дням программы (maxPerDayByDay)", () => {
  it("сценарий Игоря: [3, 2] — день 1 три касания; день 2 утро и 12:00, ответ в 13:01 счёт не обнуляет, 16:01 не уходит", async () => {
    const chat = timerChat({ edit: silentSchedule({ maxPerDayByDay: [3, 2] }) });
    const id = await started(chat);
    const dayOne = await firstTurnsUntil(chat, id, msk(14, 13, 1));
    expect(dayOne.map((turn) => turn.at)).toEqual([msk(13, 13), msk(13, 16), msk(13, 19), msk(14, 9), msk(14, 12)]);

    clockAt(msk(14, 13, 1));
    await human(chat, id, "Да, смотрю");
    const after = await firstTurnsUntil(chat, id, msk(15, 9, 30));
    // 16:01 — третье за день 2: потолок 2 его не пускает; дальше — утро дня 3.
    expect(after).toEqual([{ at: msk(15, 9), reasons: [{ kind: "morning" }] }]);
  });

  it("последнее значение — на все следующие дни: день 3 тоже не больше двух", async () => {
    const chat = timerChat({ edit: silentSchedule({ maxPerDayByDay: [3, 2] }) });
    const id = await started(chat);
    const turns = await firstTurnsUntil(chat, id, msk(15, 23));
    expect(turns.filter((turn) => turn.at >= msk(15, 0)).map((turn) => turn.at)).toEqual([msk(15, 9), msk(15, 12)]);
  });

  it("главнее maxPerDay; без него — maxPerDay на все дни, как раньше: при 3 в день 16:01 после ответа уходит", async () => {
    const chat = timerChat({ edit: silentSchedule({ maxPerDay: 3 }) });
    const id = await started(chat);
    await firstTurnsUntil(chat, id, msk(14, 13, 1));
    clockAt(msk(14, 13, 1));
    await human(chat, id, "Да, смотрю");
    const after = await firstTurnsUntil(chat, id, msk(14, 17));
    expect(after.map((turn) => turn.at)).toEqual([msk(14, 16, 1)]);

    const both = timerChat({ edit: silentSchedule({ maxPerDay: 5, maxPerDayByDay: [1] }) });
    const other = await started(both);
    expect((await firstTurnsUntil(both, other, msk(13, 23))).map((turn) => turn.at)).toEqual([msk(13, 13)]);
  });
});

/**
 * «Знакомство» 1 день (общий ряд) → «Поиск затыка» со своим частым рядом 15 мин · 1 ч · 4 ч; потолок 3 в день. Человек
 * дошёл до «Поиска затыка» на день 2 программы.
 */
const blockOnDayTwo = (own: Record<string, unknown>) => (json: Record<string, any>) => {
  silentSchedule({ maxPerDay: 3 })(json);
  stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" });
  stateOf(json, "block").nudges = { afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }, { amount: 4, unit: "h" }], ...own };
};

describe("частый ряд ноды до N-го дня программы (nudges.untilProgramDay)", () => {
  it("до дня 1, а нода началась на день 2 — частого ряда нет, сразу общий: 12:00, 15:00", async () => {
    const chat = timerChat({ edit: blockOnDayTwo({ untilProgramDay: 1 }) });
    const id = await started(chat);
    const turns = await firstTurnsUntil(chat, id, msk(14, 21));
    expect(turns.filter((turn) => turn.at >= msk(14, 0)).map((turn) => turn.at)).toEqual([msk(14, 9), msk(14, 12), msk(14, 15)]);
  });

  it("до дня 2 — на день 2 частый ряд ноды: 09:15, 10:15 (дальше потолок)", async () => {
    const chat = timerChat({ edit: blockOnDayTwo({ untilProgramDay: 2 }) });
    const id = await started(chat);
    const turns = await firstTurnsUntil(chat, id, msk(14, 21));
    expect(turns.filter((turn) => turn.at >= msk(14, 0)).map((turn) => turn.at)).toEqual([msk(14, 9), msk(14, 9, 15), msk(14, 10, 15)]);
  });

  it("до дня 2 — на день 3 уже общий ряд с начала", async () => {
    const chat = timerChat({ edit: blockOnDayTwo({ untilProgramDay: 2 }) });
    const id = await started(chat);
    const turns = await firstTurnsUntil(chat, id, msk(15, 21));
    expect(turns.filter((turn) => turn.at >= msk(15, 0)).map((turn) => turn.at)).toEqual([msk(15, 9), msk(15, 12), msk(15, 15)]);
  });
});
