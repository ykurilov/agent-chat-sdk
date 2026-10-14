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
