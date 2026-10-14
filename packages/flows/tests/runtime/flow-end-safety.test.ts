import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SERVER_TURNS_IN_ROW } from "@ykurilov/agent-chat-core";
import { FLOW_CHAIN_LIMIT } from "../../src/engine/flow-run";
import { stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, OWNER, tick, timerChat, type TimerChat, type TimerChatSetup } from "./timer-chat";
import { iso, msk } from "./days-chat";

// Конец разговора не зависит от того, начался ли ход «пишет первым»: потолок ходов сервера подряд, ворота приложения,
// `canWriteNow` — касание переносится, а «срок вышел» и «не завершил» наступают в свой срок.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const NUDGES = {
  afterSilence: [
    { amount: 15, unit: "min" },
    { amount: 1, unit: "h" },
    { amount: 2, unit: "h" },
  ],
  dailyAt: ["13:00", "19:00"],
};

/** Трёхдневка: нода «Знакомство» 1 день, касания по тишине и по часам, утреннее, срок 3 дня. */
const threeDaysWithNudges = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 3, deadlineState: "soft", nudges: NUDGES, firstMessages: { maxPerDay: 10 } };
  stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" });
};

/** Продукт без дней: касания каждые 15 минут и «не завершил» через сутки тишины. */
const silentProduct = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  const every15 = Array.from({ length: 10 }, () => ({ amount: 15, unit: "min" }));
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: { afterSilence: every15, giveUpAfter: { amount: 1, unit: "d" } } };
};

async function started(setup: TimerChatSetup, at = msk(13, 15)) {
  const chat = timerChat(setup);
  clockAt(at);
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return { chat, id };
}

/** Часы идут шагами до `until`, как обход таймеров работника. */
async function walk(chat: TimerChat, id: string, until: number, stepMs = 15 * 60_000) {
  let at = Date.now();
  while (at < until) {
    at = Math.min(at + stepMs, until);
    clockAt(at);
    await tick(chat, id);
  }
}

const firstTurns = async (chat: TimerChat, id: string) => (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer" && notice.wakeAgent);

describe("потолок ходов сервера подряд и конец разговора", () => {
  it("молчун трёхдневки: касаний сценария больше потолка ядра — все с ходом, «срок вышел» наступает", async () => {
    const { chat, id } = await started({ edit: threeDaysWithNudges });
    await walk(chat, id, msk(16, 10));

    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "deadline", endedAt: iso(msk(16, 9)), dueAt: null });
    expect(chat.finished).toEqual([expect.objectContaining({ chatId: id, reason: "deadline" })]);
    // Ходы сценария идут по расписанию: потолок ядра против петли их не режет.
    const turns = chat.model.doStreamCalls.length - 1;
    expect(turns).toBeGreaterThan(MAX_SERVER_TURNS_IN_ROW);
    expect((await firstTurns(chat, id)).length).toBe(turns);
  });

  it("молчун продукта: больше 5 касаний подряд, через сутки тишины — «не завершил»", async () => {
    const { chat, id } = await started({ edit: silentProduct, firstMessages: false }, msk(13, 10));
    await walk(chat, id, msk(14, 11));

    expect(chat.model.doStreamCalls.length - 1).toBeGreaterThan(MAX_SERVER_TURNS_IN_ROW);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "abandoned", dueAt: null });
    expect(chat.finished).toEqual([expect.objectContaining({ chatId: id, reason: "abandoned" })]);
  });

  it("ход «пишет первым» не начался (ворота приложения): касание ждёт, «срок вышел» наступает без хода", async () => {
    const { chat, id } = await started({
      edit: threeDaysWithNudges,
      beforeTurn: ({ action }) => (action === "notice" ? { hold: true } : undefined),
    });
    await walk(chat, id, msk(16, 10));

    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "deadline", endedAt: iso(msk(16, 9)), dueAt: null });
    // Касание повторяется тем же служебным сообщением, а не новым на каждый обход.
    expect((await firstTurns(chat, id)).length).toBeLessThanOrEqual(3);
  });
});

describe("canWriteNow: «не сейчас» не снимает сроки", () => {
  it("«нельзя» (аварийная остановка) — касание через час; остановку сняли — касание уходит", async () => {
    let stopped = true;
    const canWriteNow = vi.fn(() => !stopped);
    const { chat, id } = await started({ edit: threeDaysWithNudges, firstMessages: { canWriteNow } });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(13, 15, 15)) });

    clockAt(msk(13, 15, 15));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(13, 16, 15)), dueExitId: "@first" });

    stopped = false;
    clockAt(msk(13, 16, 15));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect((await firstTurns(chat, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 1 }] } });
  });

  it("«нельзя» все три дня — без единого касания, «срок вышел» наступает в свой срок", async () => {
    const { chat, id } = await started({ edit: threeDaysWithNudges, firstMessages: { canWriteNow: () => false } });
    await walk(chat, id, msk(16, 10), 60 * 60_000);

    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "deadline", endedAt: iso(msk(16, 9)), dueAt: null });
  });

  it("{ retryAt } — касание в названный момент, но не позже перехода ноды и конца разговора", async () => {
    const { chat, id } = await started({ edit: threeDaysWithNudges, firstMessages: { canWriteNow: () => ({ retryAt: new Date(msk(13, 18)) }) } });
    clockAt(msk(13, 15, 15));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(13, 18)), dueExitId: "@first" });

    const far = timerChat({ edit: threeDaysWithNudges, firstMessages: { canWriteNow: () => ({ retryAt: new Date(msk(20, 9)) }) } });
    clockAt(msk(13, 15));
    const { id: farId } = await far.service.createChat(OWNER);
    await human(far, farId, "Курс по акварели");
    clockAt(msk(13, 15, 15));
    await tick(far, farId);
    // Отложенное касание не задерживает ни переход ноды по дню, ни «срок вышел».
    expect(await far.store.getChat(farId)).toMatchObject({ dueAt: iso(msk(14, 9)), dueExitId: "intro_day" });
    clockAt(msk(14, 9));
    await tick(far, farId);
    expect(await far.store.getChat(farId)).toMatchObject({ dueAt: iso(msk(16, 9)) });
    clockAt(msk(16, 9));
    await tick(far, farId);
    expect(await far.store.getChat(farId)).toMatchObject({ endReason: "deadline", dueAt: null });
  });

  it("\"never\" — молчать до сообщения человека: касаний нет, переход ноды и «срок вышел» в свой срок; человек написал — касания снова", async () => {
    const canWriteNow = vi.fn((): "never" => "never");
    const { chat, id } = await started({ edit: threeDaysWithNudges, firstMessages: { canWriteNow } });
    clockAt(msk(13, 15, 15));
    await tick(chat, id);
    // Не «через час»: ближайший срок — переход ноды по дню.
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 9)), dueExitId: "intro_day" });
    await walk(chat, id, msk(16, 10), 60 * 60_000);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "deadline", endedAt: iso(msk(16, 9)) });

    // Сценарий без срока конца: срок снимается совсем, а сообщение человека возвращает касания.
    const { chat: product, id: productId } = await started({ edit: (json) => (silentProduct(json), delete json.schedule.nudges.giveUpAfter), firstMessages: { canWriteNow } }, msk(13, 10));
    clockAt(msk(13, 10, 15));
    await tick(product, productId);
    expect(await product.store.getChat(productId)).toMatchObject({ dueAt: null });
    const asked = canWriteNow.mock.calls.length;
    await human(product, productId, "Я тут");
    clockAt(msk(13, 10, 30));
    await tick(product, productId);
    expect(canWriteNow.mock.calls.length).toBe(asked + 1);
  });

  it("{ retryAt } с негодной датой — как false (через час), без сбоя обхода; дата в прошлом — повтор не раньше чем через минуту", async () => {
    const broken = await started({ edit: threeDaysWithNudges, firstMessages: { canWriteNow: () => ({ retryAt: new Date("не дата") }) } });
    clockAt(msk(13, 15, 15));
    await tick(broken.chat, broken.id);
    expect(await broken.chat.store.getChat(broken.id)).toMatchObject({ dueAt: iso(msk(13, 16, 15)), dueExitId: "@first" });
    expect(broken.chat.logError).not.toHaveBeenCalledWith(expect.stringContaining("таймер не сработал"));

    const past = await started({ edit: threeDaysWithNudges, firstMessages: { canWriteNow: () => ({ retryAt: new Date(msk(13, 10)) }) } });
    clockAt(msk(13, 15, 15));
    await tick(past.chat, past.id);
    expect(await past.chat.store.getChat(past.id)).toMatchObject({ dueAt: iso(msk(13, 15, 16)), dueExitId: "@first" });
  });
});

describe("срок наступил, а писать не о чем (предел переходов подряд)", () => {
  /** Место чата упёрлось в предел переходов подряд: выход по тишине наступил, но перехода не будет. */
  function chainStuck(chat: TimerChat) {
    const read = chat.service.getChatState.bind(chat.service);
    vi.spyOn(chat.service, "getChatState").mockImplementation(async (...args) => {
      const state = await read(...args);
      return { ...state, values: { ...state.values, flow: { ...(state.values.flow as object), chain: FLOW_CHAIN_LIMIT } } };
    });
  }
  const chainLines = (chat: TimerChat) => chat.logError.mock.calls.filter(([line]) => line.includes("переходов подряд")).length;

  it("ни срока конца, ни касаний впереди — срок снимается, а не повторяется каждый час", async () => {
    const { chat, id } = await started({ edit: () => {} });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(13, 18)), dueExitId: "any_silence" });
    chainStuck(chat);
    clockAt(msk(13, 18));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null });
    clockAt(msk(13, 19));
    await tick(chat, id);
    expect(chainLines(chat)).toBe(1);
    expect(chat.model.doStreamCalls).toHaveLength(1);
  });

  it("впереди касание или конец — срок на ближайший из них", async () => {
    const { chat, id } = await started({ edit: (json) => (json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 3 }) });
    chainStuck(chat);
    clockAt(msk(13, 18));
    await tick(chat, id);
    // Утреннее касание — ближайший настоящий срок, а не «через час».
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 9)), dueExitId: "@first" });
  });
});

describe("мягкий потолок ходов сервера подряд у сценария", () => {
  /** Петля переходов по коротким таймерам: «Знакомство» ⇄ «Поиск затыка» каждую минуту. */
  const loop = (json: Record<string, any>) => {
    withoutSilenceTimers(json);
    stateOf(json, "intro").exits.push({ id: "to_block", when: { type: "timer", from: "in_state", amount: 1, unit: "min" }, to: "block" });
    stateOf(json, "block").exits.push({ id: "to_intro", when: { type: "timer", from: "in_state", amount: 1, unit: "min" }, to: "intro" });
  };
  const capLines = (chat: TimerChat) => chat.logError.mock.calls.filter(([line]) => line.includes("ходов сервера подряд")).length;

  it("без правил «писать первым» петля останавливается на 50 ходах: строка в журнал, срок снят до сообщения человека", async () => {
    const { chat, id } = await started({ edit: loop, firstMessages: false });
    await walk(chat, id, msk(13, 17, 30), 60_000);
    // Ход перехода с точным первым текстом идёт без модели: ходы считаются по служебным сообщениям.
    expect(await firstTurns(chat, id)).toHaveLength(50);
    expect(capLines(chat)).toBe(1);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null });
    // 150 шагов по минуте: под общей нагрузкой прогона дольше 5 с.
  }, 30_000);

  it("свой потолок; сообщение человека снимает остановку; «срок вышел» остаётся", async () => {
    const { chat, id } = await started({
      edit: (json) => (loop(json), (json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 3, firstMessages: { morning: false } })),
      firstMessages: false,
      timers: { maxServerTurnsInRow: 3 },
    });
    await walk(chat, id, msk(13, 15, 10), 60_000);
    expect(await firstTurns(chat, id)).toHaveLength(3);
    expect(capLines(chat)).toBe(1);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(16, 9)), dueExitId: "@deadline" });

    await human(chat, id, "Я здесь");
    await walk(chat, id, msk(13, 15, 20), 60_000);
    expect(await firstTurns(chat, id)).toHaveLength(6);
  });
});
