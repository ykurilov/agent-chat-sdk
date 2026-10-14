import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, OWNER, tick, timerChat, type TimerChat, type TimerChatSetup } from "./timer-chat";
import { msk } from "./days-chat";

// 0.53: правило «человек писал меньше 3 ч назад — утром не писать» — для любого касания в начале дня, а не только для
// утреннего: касание тишины или по часам, перенесённое ночью на утро, ждёт, пока пройдут 3 ч. Переход ноды по сроку и
// ответ на ночные сообщения человека — не касание «без нужды»: они уходят в свой срок.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

/** Касание через 15 минут тишины; ночь 21:00–09:00. */
const silenceOnly = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: { afterSilence: [{ amount: 15, unit: "min" }, { amount: 15, unit: "min" }] } };
};

/** Трёхдневка: нода «Знакомство» — 1 день, касание через 15 минут тишины. */
const threeDays = (json: Record<string, any>) => {
  silenceOnly(json);
  json.schedule.lengthDays = 3;
  stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" });
};

async function started(setup: TimerChatSetup) {
  const chat = timerChat(setup);
  clockAt(msk(13, 15));
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return { chat, id };
}

async function walk(chat: TimerChat, id: string, until: number, stepMs = 5 * 60_000) {
  let at = Date.now();
  while (at < until) {
    at = Math.min(at + stepMs, until);
    clockAt(at);
    await tick(chat, id);
  }
}

const firstTurns = async (chat: TimerChat, id: string) => (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer" && notice.wakeAgent);

describe("начало дня: человек писал меньше 3 ч назад — первым не писать", () => {
  it("касание тишины, перенесённое ночью на 09:00, ждёт 3 ч от сообщения человека в 07:00", async () => {
    const { chat, id } = await started({ edit: silenceOnly });
    await walk(chat, id, msk(14, 6, 55), 60 * 60_000);
    const before = (await firstTurns(chat, id)).length;
    clockAt(msk(14, 7));
    await human(chat, id, "Рано встал, вот идея");

    await walk(chat, id, msk(14, 9, 55));
    expect(await firstTurns(chat, id)).toHaveLength(before);
    await walk(chat, id, msk(14, 10, 5));
    expect(await firstTurns(chat, id)).toHaveLength(before + 1);
    expect((await firstTurns(chat, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 1 }] } });
  });

  it("переход ноды по сроку уходит в 09:00, а касание тишины после него ждёт до 10:00", async () => {
    const { chat, id } = await started({ edit: threeDays });
    await walk(chat, id, msk(14, 6, 55), 60 * 60_000);
    const before = (await firstTurns(chat, id)).length;
    clockAt(msk(14, 7));
    await human(chat, id, "Рано встал, вот идея");

    await walk(chat, id, msk(14, 9, 55));
    expect((await firstTurns(chat, id)).slice(before)).toEqual([expect.objectContaining({ data: expect.objectContaining({ exitId: "intro_day" }) })]);
    await walk(chat, id, msk(14, 10, 5));
    expect((await firstTurns(chat, id)).slice(before + 1)).toEqual([expect.objectContaining({ data: expect.objectContaining({ reasons: [{ kind: "silence", step: 1 }] }) })]);
  });

  /** Человек пишет после жёсткой рамки дня в 07:00: первое получает её текст, следующие ждут утра без ответа. */
  async function heldUntilMorning(edit: (json: Record<string, any>) => void) {
    const { chat, id } = await started({ edit: (json) => (edit(json), Object.assign(json.schedule, { dayFrame: { hardAt: 2, hardText: "Утром отвечу!" } })) });
    // Второе сообщение дня — жёсткая рамка: дальше до утра агент молчит.
    await human(chat, id, "Ещё вопрос");
    await walk(chat, id, msk(14, 6, 55), 60 * 60_000);
    const before = (await firstTurns(chat, id)).length;
    clockAt(msk(14, 7));
    await human(chat, id, "Ещё идея");
    await human(chat, id, "И ещё одна");
    await walk(chat, id, msk(14, 9, 5));
    return { chat, id, before };
  }

  const nightReply = expect.objectContaining({ data: expect.objectContaining({ reasons: [{ kind: "night_messages", count: 2 }] }) });

  it.each([
    ["касания кончились", silenceOnly],
    ["касаний нет", (json: Record<string, any>) => (silenceOnly(json), delete json.schedule.nudges)],
  ])("ответ на отложенное до утра уходит в 09:00 при любых касаниях: %s", async (_name, edit) => {
    const { chat, id, before } = await heldUntilMorning(edit);
    expect((await firstTurns(chat, id)).slice(before)).toEqual([nightReply]);
  });

  it("отложенные сообщения — тоже «человек писал недавно»: в 09:00 только ответ на них, утреннего нет", async () => {
    const { chat, id, before } = await heldUntilMorning((json) => (silenceOnly(json), (json.schedule.firstMessages = { morning: true })));
    expect((await firstTurns(chat, id)).slice(before)).toEqual([nightReply]);
    await walk(chat, id, msk(14, 12, 5));
    expect((await firstTurns(chat, id)).slice(before).flatMap((notice) => (notice.data as { reasons: Array<{ kind: string }> }).reasons.map((reason) => reason.kind))).not.toContain("morning");
  });

  it("«не завершил» считает молчание от отложенного сообщения, а не от последнего отвеченного", async () => {
    const { chat, id } = await heldUntilMorning((json) => (silenceOnly(json), (json.schedule.nudges.giveUpAfter = { amount: 1, unit: "d" })));
    // Отвеченное — 13-го в 15:00, отложенное — 14-го в 07:00: сутки молчания кончаются 15-го в 07:00.
    await walk(chat, id, msk(14, 15, 5));
    expect(await chat.store.getChat(id)).toMatchObject({ endedAt: null });
    await walk(chat, id, msk(15, 7, 5));
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "abandoned" });
  });

  it("переход ноды «человек молчит» не срабатывает, если человек писал после агента, пусть и без ответа", async () => {
    // Агент писал последним 13-го в 15:30 (второе касание): 16 ч тишины кончились бы 14-го в 07:30, но в 07:00 человек писал.
    const { chat, id, before } = await heldUntilMorning((json) => {
      silenceOnly(json);
      stateOf(json, "intro").exits.push({ id: "intro_silent", when: { type: "timer", from: "silence", amount: 16, unit: "h" }, to: "block" });
    });
    expect((await firstTurns(chat, id)).slice(before)).toEqual([nightReply]);
  });
});
