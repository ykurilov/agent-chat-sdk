import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitTurn } from "../../../core/tests/unit/support/notice-chat";
import type { FlowOutgoing } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import { withoutSilenceTimers } from "../flow-fixtures";
import { msk } from "./days-chat";
import { clockAt, human, OWNER, timerChat, type TimerChat } from "./timer-chat";

// Ревью 061: обход таймеров дольше аренды. Пачка из 50 касаний, каждое — ход модели; аренда минута. Другая копия сервера
// не должна взять то, что первая ещё разбирает: человеку — ровно одно касание.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const nudging = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: { afterSilence: [{ amount: 15, unit: "min" }] } };
};

/** Ход модели «идёт» 5 секунд: часы двигаются при каждом вызове. */
function slowModel(copy: TimerChat, onCall?: (calls: number) => void) {
  const original = copy.model.doStream;
  let calls = 0;
  copy.model.doStream = async (options) => {
    calls += 1;
    vi.setSystemTime(Date.now() + 5_000);
    onCall?.(calls);
    return original(options);
  };
}

describe("таймеры: обход дольше аренды", () => {
  it("50 касаний, медленный ход, вторая копия тикает посреди обхода — каждому человеку ровно одно касание", async () => {
    const store = memoryFlowStore();
    const storage = createInMemoryChatStorage();
    const sent: FlowOutgoing[] = [];
    const deliver = async (message: FlowOutgoing) => {
      sent.push(message);
      return { status: "delivered" as const };
    };
    // Все чаты у одного человека: предел его одновременных ходов не должен мешать (у разных людей он свой).
    const chatOptions = { maxConcurrentTurnsPerUser: 10 };
    const copies = [0, 1].map(() => timerChat({ edit: nudging, store, storage, firstMessages: false, chatOptions }));
    for (const copy of copies) copy.flow.attach({ portFor: () => copy.service, deliver });
    const [first, second] = copies as [TimerChat, TimerChat];

    const ids: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      const { id } = await first.service.createChat(OWNER);
      await human(first, id, `Курс ${index}`);
      ids.push(id);
    }

    clockAt(msk(14, 10, 15));
    let secondTick: Promise<void> | undefined;
    slowModel(first, (calls) => {
      // Прошло 100 секунд: аренда пачки первой копии кончилась бы.
      if (calls === 20) secondTick = second.flow.tick();
    });
    slowModel(second);
    await first.flow.tick();
    await secondTick;
    for (const copy of copies) {
      for (const id of ids) await waitTurn(copy.service, id);
      await copy.flow.settled();
    }

    const touches = new Map<string, number>();
    for (const message of sent) touches.set(message.chatId, (touches.get(message.chatId) ?? 0) + 1);
    expect([...touches.entries()].filter(([, count]) => count !== 1)).toEqual([]);
    expect(touches.size).toBe(50);
    // Вторая копия действительно тикала посреди обхода и забрала то, до чего первая не дошла.
    expect(secondTick).toBeDefined();
    expect(second.model.doStreamCalls.length).toBeGreaterThan(0);
  });
});

describe("таймеры: копия потеряла аренду посреди срабатывания (аудит kimi-3)", () => {
  it("зависла перед касанием дольше аренды — касание и следующий срок за другой копией; устаревшая не пишет и не шлёт", async () => {
    const store = memoryFlowStore();
    const storage = createInMemoryChatStorage();
    const sent: FlowOutgoing[] = [];
    const deliver = async (message: FlowOutgoing) => {
      sent.push(message);
      return { status: "delivered" as const };
    };
    const [stale, fresh] = [0, 1].map(() => timerChat({ edit: nudging, store, storage, firstMessages: false })) as [TimerChat, TimerChat];
    // Устаревшая копия зависает на проверке лимита — последней перед касанием.
    let release!: () => void;
    let markStalled!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const stalled = new Promise<void>((resolve) => (markStalled = resolve));
    const stallingPort = new Proxy(stale.service, {
      get(target, key, receiver) {
        if (key !== "assertWithinLimit") return Reflect.get(target, key, receiver);
        return async (...args: Parameters<typeof target.assertWithinLimit>) => {
          markStalled();
          await released;
          return target.assertWithinLimit(...args);
        };
      },
    });
    stale.flow.attach({ portFor: () => stallingPort, deliver });
    fresh.flow.attach({ portFor: () => fresh.service, deliver });

    const { id } = await stale.service.createChat(OWNER);
    await human(stale, id, "Курс");
    const humanTurns = stale.model.doStreamCalls.length;
    clockAt(msk(14, 10, 15));
    const staleTick = stale.flow.tick();
    await stalled;

    // Прошло больше минуты аренды: таймер берёт другая копия и касается сама.
    clockAt(msk(14, 10, 17));
    await fresh.flow.tick();
    await waitTurn(fresh.service, id);
    await fresh.flow.settled();
    expect(sent.filter((message) => message.chatId === id)).toHaveLength(1);
    const afterFresh = await store.getChat(id);

    release();
    await staleTick;
    await stale.flow.settled();
    expect(sent.filter((message) => message.chatId === id)).toHaveLength(1);
    expect(stale.model.doStreamCalls).toHaveLength(humanTurns);
    expect((await store.getChat(id))?.dueAt).toBe(afterFresh?.dueAt);
    expect((await store.getChat(id))?.dueExitId).toBe(afterFresh?.dueExitId);
  });
});
