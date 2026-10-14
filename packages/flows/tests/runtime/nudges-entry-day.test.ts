import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, OWNER, tick, timerChat, type TimerChat } from "./timer-chat";
import { iso, msk } from "./days-chat";

// Свой ряд касаний ноды на N дней (`nudges.days`): в день входа — частый ряд ноды, со следующего дня — утреннее и
// общий ряд сценария с начала, под ночью, правилом трёх часов и дневным потолком. Без `days` — как раньше.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const MIN = 60_000;

/** «Знакомство» — свой ряд 15 мин · 1 ч · 4 ч; общий — 3 ч · 3 ч · 3 ч; потолок 3 в день; ночь 21:00–09:00. */
const entryDayNudges =
  (days: number | undefined) =>
  (json: Record<string, any>) => {
    withoutSilenceTimers(json);
    json.schedule = {
      dayStart: "09:00",
      nightFrom: "21:00",
      lengthDays: 5,
      firstMessages: { maxPerDay: 3, morning: true },
      nudges: { afterSilence: [{ amount: 3, unit: "h" }, { amount: 3, unit: "h" }, { amount: 3, unit: "h" }] },
    };
    stateOf(json, "intro").nudges = {
      afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }, { amount: 4, unit: "h" }],
      ...(days !== undefined && { days }),
    };
  };

/** Ходы «пишет первым» по пути часов: когда каждый случился (шаг 5 минут) и с какими причинами. */
async function firstTurnsUntil(chat: TimerChat, id: string, until: number) {
  const turns = async () => (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer" && notice.wakeAgent);
  const seen: Array<{ at: number; reasons: unknown }> = [];
  let count = (await turns()).length;
  let at = Date.now();
  while (at < until) {
    at = Math.min(at + 5 * MIN, until);
    clockAt(at);
    await tick(chat, id);
    const now = await turns();
    for (const turn of now.slice(count)) seen.push({ at, reasons: (turn.data as { reasons: unknown }).reasons });
    count = now.length;
  }
  return seen;
}

async function started(days: number | undefined) {
  const chat = timerChat({ edit: entryDayNudges(days) });
  clockAt(msk(13, 10));
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return { chat, id };
}

describe("свой ряд касаний ноды на день входа", () => {
  it("день входа — 10:15, 11:15, 15:15; день 2 — утреннее 09:00 и общий ряд 12:00, 15:00, дальше потолок", async () => {
    const { chat, id } = await started(1);
    const turns = await firstTurnsUntil(chat, id, msk(14, 23));
    expect(turns).toEqual([
      { at: msk(13, 10, 15), reasons: [{ kind: "silence", step: 1 }] },
      { at: msk(13, 11, 15), reasons: [{ kind: "silence", step: 2 }] },
      { at: msk(13, 15, 15), reasons: [{ kind: "silence", step: 3 }] },
      { at: msk(14, 9), reasons: [{ kind: "morning" }] },
      { at: msk(14, 12), reasons: [{ kind: "silence", step: 1 }] },
      { at: msk(14, 15), reasons: [{ kind: "silence", step: 2 }] },
    ]);
  });

  it("человек ответил на день 2 — ряд с начала уже общий, а не ряд ноды", async () => {
    const { chat, id } = await started(1);
    await firstTurnsUntil(chat, id, msk(14, 10));
    clockAt(msk(14, 10));
    await human(chat, id, "Я тут");
    const turns = await firstTurnsUntil(chat, id, msk(14, 14));
    expect(turns).toEqual([{ at: msk(14, 13), reasons: [{ kind: "silence", step: 1 }] }]);
  });

  it("ночь: шаг ряда ноды, попавший на ночь, утреннее заменяет; дальше общий ряд", async () => {
    const chat = timerChat({ edit: entryDayNudges(1) });
    clockAt(msk(13, 18));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Поздно вечером");
    const turns = await firstTurnsUntil(chat, id, msk(14, 12, 30));
    expect(turns.map((turn) => turn.at)).toEqual([msk(13, 18, 15), msk(13, 19, 15), msk(14, 9), msk(14, 12)]);
    expect(turns[2]!.reasons).toEqual([{ kind: "morning" }]);
  });

  it("каждый следующий день молчуна — утреннее и общий ряд заново: день 3 и день 4 — 09:00, 12:00, 15:00", async () => {
    const { chat, id } = await started(1);
    const turns = await firstTurnsUntil(chat, id, msk(16, 23));
    const day = (n: number) => turns.filter((turn) => turn.at >= msk(n, 0) && turn.at < msk(n + 1, 0));
    for (const n of [15, 16]) {
      // Шаг вчерашнего ряда, отложенный потолком дня, утреннее заменяет: модель видит только «доброе утро».
      expect(day(n)).toEqual([
        { at: msk(n, 9), reasons: [{ kind: "morning" }] },
        { at: msk(n, 12), reasons: [{ kind: "silence", step: 1 }] },
        { at: msk(n, 15), reasons: [{ kind: "silence", step: 2 }] },
      ]);
    }
  });

  it("«не завершил» по-прежнему от последних слов человека: ряд каждое утро заново его не отодвигает", async () => {
    const chat = timerChat({
      edit: (json) => {
        entryDayNudges(1)(json);
        json.schedule.nudges.giveUpAfter = { amount: 2, unit: "d" };
      },
    });
    clockAt(msk(13, 10));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели");
    const turns = await firstTurnsUntil(chat, id, msk(17, 23));
    expect(turns.filter((turn) => turn.at >= msk(15, 0)).map((turn) => turn.at)).toEqual([msk(15, 9)]);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "abandoned", endedAt: iso(msk(15, 10)), dueAt: null });
  });

  it("без `days` — ряд ноды на все дни: каждое утро он заново после утреннего", async () => {
    const { chat, id } = await started(undefined);
    const turns = await firstTurnsUntil(chat, id, msk(14, 23));
    expect(turns.map((turn) => turn.at)).toEqual([msk(13, 10, 15), msk(13, 11, 15), msk(13, 15, 15), msk(14, 9), msk(14, 9, 15), msk(14, 10, 15)]);
  });

  it("утреннее выключено — ряд заново не начинается, как раньше: общий ряд один раз, на день 3 касаний нет", async () => {
    const chat = timerChat({
      edit: (json) => {
        entryDayNudges(1)(json);
        json.schedule.firstMessages.morning = false;
      },
    });
    clockAt(msk(13, 10));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели");
    const turns = await firstTurnsUntil(chat, id, msk(15, 23));
    expect(turns.filter((turn) => turn.at >= msk(14, 0)).map((turn) => turn.at)).toEqual([msk(14, 12), msk(14, 15), msk(14, 18)]);
  });

  it("на 2 дня — день 2 ещё ряд ноды (заново после утреннего), день 3 — общий", async () => {
    const { chat, id } = await started(2);
    const turns = await firstTurnsUntil(chat, id, msk(15, 13));
    expect(turns.filter((turn) => turn.at >= msk(14, 0)).map((turn) => turn.at)).toEqual([msk(14, 9), msk(14, 9, 15), msk(14, 10, 15), msk(15, 9), msk(15, 12)]);
  });
});
