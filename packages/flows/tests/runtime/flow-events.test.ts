import { describe, expect, it, vi } from "vitest";
import { FLOW_CHAIN_LIMIT, startRun, type Transition } from "../../src/engine";
import { advance, personTimeZone, transitionNotice, type FlowRuntime } from "../../src/runtime/flow-events";
import { fixtureFlow, HOUR, stateOf } from "../flow-fixtures";

describe("шаг сценария в ходе", () => {
  const flow = fixtureFlow("sales-review");

  it("предел переходов подряд: перехода нет, строка в журнал", () => {
    const run = { ...startRun(flow, 0), state: "remind", chain: FLOW_CHAIN_LIMIT };
    const onChainLimit = vi.fn();
    const out: Transition[] = [];
    const next = advance(flow, run, { type: "event", event: "message" }, { now: HOUR, card: {}, out, onChainLimit, timeZone: "UTC" });
    expect(next).toBe(run);
    expect(out).toEqual([]);
    expect(onChainLimit).toHaveBeenCalledWith(run);
  });

  it("служебное сообщение: условие словами и точный первый текст цели", () => {
    const notice = transitionNotice(flow, [{ from: "intro", to: "remind", exitId: "any_silence", decidedBy: "timer", tags: [], at: 0 }]);
    expect(notice).toMatchObject({ kind: "app", name: "flow_transition" });
    expect(notice.title).toContain("Сработало: тишина 3 ч → «Напоминание».");
    expect(notice.title).toContain("скажи ровно это: «Вы ещё здесь? Можем продолжить, когда будет удобно.»");
  });
});

describe("вход в состояние: наступивший таймер, чей срок не зависит от входа, — сразу, в этом же шаге", () => {
  const MSK = "Europe/Moscow";
  const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);
  /** «Знакомство» → «Поиск затыка» словами; у «Поиска затыка» — свой таймер. Дни с 09:00, программа 5 дней. */
  const flowWith = (when: Record<string, unknown>) =>
    fixtureFlow("sales-review", (json) => {
      json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 5 };
      stateOf(json, "block").exits.unshift({ id: "block_timer", when, to: "offer" });
    });
  const claimed = { type: "verdict", exitId: "intro_clear", probability: 1, decidedBy: "claim" } as const;
  /** Человек начал 13.10 в 15:00, агент писал 5 ч назад, человек молчит — тишина 3 ч тоже наступила бы. */
  const step = (when: Record<string, unknown>, at: number) => {
    const out: Transition[] = [];
    const run = { ...startRun(flowWith(when), msk(13, 15)), lastHumanAt: at - 6 * HOUR, lastAgentAt: at - 5 * HOUR };
    const next = advance(flowWith(when), run, claimed, { now: at, card: {}, out, onChainLimit: () => {}, timeZone: MSK });
    return { state: next.state, path: out.map((transition) => transition.to) };
  };

  it("вошёл в день 4 при «с дня 3» — сразу дальше; в день 1 — остаётся", () => {
    const programDay = { type: "timer", from: "program_day", day: 3 };
    expect(step(programDay, msk(16, 12))).toEqual({ state: "offer", path: ["block", "offer"] });
    expect(step(programDay, msk(13, 16))).toEqual({ state: "block", path: ["block"] });
  });

  it("наступили несколько — самый ранний срок, как у `nextDue`; при равенстве — порядок в ноде", () => {
    const twoDays = fixtureFlow("sales-review", (json) => {
      json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 5 };
      stateOf(json, "block").exits.unshift(
        { id: "block_day4", when: { type: "timer", from: "program_day", day: 4 }, to: "soft" },
        { id: "block_day3", when: { type: "timer", from: "program_day", day: 3 }, to: "offer" },
        { id: "block_day3_late", when: { type: "timer", from: "program_day", day: 3 }, to: "doubts" },
      );
    });
    const out: Transition[] = [];
    advance(twoDays, startRun(twoDays, msk(13, 15)), claimed, { now: msk(17, 12), card: {}, out, onChainLimit: () => {}, timeZone: MSK });
    expect(out.map((transition) => transition.exitId)).toEqual(["intro_clear", "block_day3"]);
  });

  it("«прошло N с начала разговора» — тоже от старта, а не от входа", () => {
    expect(step({ type: "timer", from: "since_start", amount: 1, unit: "d" }, msk(16, 12))).toEqual({ state: "offer", path: ["block", "offer"] });
  });

  it("тишина, время в состоянии, «длится N дней», время суток — считаются от входа или от разговора: не трогаются", () => {
    for (const when of [
      { type: "timer", from: "silence", amount: 3, unit: "h" },
      { type: "timer", from: "in_state", amount: 1, unit: "min" },
      { type: "timer", from: "state_days", days: 1 },
      { type: "timer", from: "time_of_day", at: "10:00" },
    ]) {
      expect(step(when, msk(16, 12))).toEqual({ state: "block", path: ["block"] });
    }
  });

  it("цикл по таким таймерам упирается в общий предел переходов подряд", () => {
    const loop = fixtureFlow("sales-review", (json) => {
      json.schedule = { dayStart: "09:00", nightFrom: "21:00" };
      stateOf(json, "block").exits.unshift({ id: "block_back", when: { type: "timer", from: "program_day", day: 2 }, to: "intro" });
      stateOf(json, "intro").exits.push({ id: "intro_back", when: { type: "timer", from: "program_day", day: 2 }, to: "block" });
    });
    const out: Transition[] = [];
    const onChainLimit = vi.fn();
    const run = startRun(loop, msk(13, 15));
    advance(loop, run, claimed, { now: msk(16, 12), card: {}, out, onChainLimit, timeZone: MSK });
    expect(out).toHaveLength(FLOW_CHAIN_LIMIT);
    expect(onChainLimit).toHaveBeenCalledTimes(1);
  });

  it("предел подряд, когда сработали бы и данные, и таймер при входе, — одна запись в журнал", () => {
    const loop = fixtureFlow("sales-review", (json) => {
      json.schedule = { dayStart: "09:00", nightFrom: "21:00" };
      const filled = { type: "data", field: "course_topic", op: "filled" };
      stateOf(json, "block").exits.unshift(
        { id: "block_data", when: filled, to: "intro" },
        { id: "block_day2", when: { type: "timer", from: "program_day", day: 2 }, to: "intro" },
      );
      stateOf(json, "intro").exits.push({ id: "intro_data", when: filled, to: "block" });
    });
    const out: Transition[] = [];
    const onChainLimit = vi.fn();
    const card = { course_topic: "акварель" };
    advance(loop, startRun(loop, msk(13, 15)), { type: "data", card }, { now: msk(16, 12), card, out, onChainLimit, timeZone: MSK });
    expect(out).toHaveLength(FLOW_CHAIN_LIMIT);
    expect(out.at(-1)!.to).toBe("block");
    expect(onChainLimit).toHaveBeenCalledTimes(1);
  });
});

describe("personTimeZone: пояс человека для шага вне хода", () => {
  const chat = { ownerId: "o", chatId: "c" };
  const storeWith = (timeZone: string) => ({ getChat: async () => ({ timeZone }) }) as unknown as FlowRuntime["store"];

  it("без поясов модуля — из записи чата, как `runOutsideTurn`; неизвестен — `defaultTimeZone`", async () => {
    expect(await personTimeZone({ store: storeWith("Asia/Novosibirsk"), defaultTimeZone: "Europe/Moscow" }, chat)).toBe("Asia/Novosibirsk");
    expect(await personTimeZone({ store: storeWith(""), defaultTimeZone: "Europe/Moscow" }, chat)).toBe("Europe/Moscow");
  });

  it("пояса модуля главнее записи чата", async () => {
    const timeZones = { of: async () => "Asia/Tokyo" } as unknown as FlowRuntime["timeZones"];
    expect(await personTimeZone({ store: storeWith("Asia/Novosibirsk"), timeZones }, chat)).toBe("Asia/Tokyo");
  });
});
