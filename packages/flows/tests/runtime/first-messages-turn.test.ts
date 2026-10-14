import { createInMemoryChatStorage, SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { SpendingLimits, UsageRecord } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { memoryFlowStore } from "../../src/store/memory";
import { stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { agentTexts, appNotices, clockAt, human, OWNER, stateOfChat, tick, timerChat, type TimerChatSetup } from "./timer-chat";
import { iso, msk, promptText } from "./days-chat";

// T701, T704, T706 на модели-заглушке и подменённых часах: касания, утро, накопленное, один ход на все причины, лимит денег.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const REMINDERS = {
  afterSilence: [
    { amount: 15, unit: "min" },
    { amount: 1, unit: "h" },
  ],
  dailyAt: ["09:00", "19:00"],
  giveUpAfter: { amount: 3, unit: "d" },
};

/** Продукт без дней (SC-102): только касания, своих таймеров тишины у сценария нет. */
const product = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: REMINDERS };
};

/** Три дня с выходами нод по дням; утреннее включено сроком. */
const threeDays = (schedule: Record<string, unknown> = {}) => (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 3, ...schedule };
  stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" });
};

function usageChat(setup: TimerChatSetup = {}) {
  const storage = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    written.push(record);
    return insert(record);
  };
  return { ...timerChat({ ...setup, storage }), written };
}

async function started(chat: ReturnType<typeof timerChat>, at = msk(14, 10)) {
  clockAt(at);
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return id;
}

const timerNotices = async (chat: ReturnType<typeof timerChat>, id: string) =>
  (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer");

describe("T701: касания продукта без дней (SC-102)", () => {
  it("15 мин, 1 ч, вечер, утро — ходы «пишет первым» с причиной; через 3 дня тишины — «не завершил» без сообщения", async () => {
    const chat = usageChat({ edit: product });
    const id = await started(chat);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 15)), dueExitId: "@first" });

    clockAt(msk(14, 10, 15));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 1 }], nudgeStep: 1 }, wakeAgent: true });
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain("новое и полезное");
    expect(chat.written.map((record) => record.source)).toEqual(["answer", "first_message"]);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 11, 15)) });

    clockAt(msk(14, 11, 15));
    await tick(chat, id);
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 2 }], nudgeStep: 2 } });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 19)) });

    clockAt(msk(14, 19));
    await tick(chat, id);
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "daily", at: "19:00" }] } });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)) });
    expect(chat.model.doStreamCalls).toHaveLength(4);

    // Сервер стоял до 17-го: побеждает «не завершил» — разговор закрыт без хода модели.
    clockAt(msk(17, 10));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(4);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "abandoned", endedAt: iso(msk(17, 10)), dueAt: null });
    expect(chat.finished).toEqual([expect.objectContaining({ chatId: id, reason: "abandoned" })]);
  });

  it("сообщение человека начинает ряд сначала", async () => {
    const chat = timerChat({ edit: product });
    const id = await started(chat);
    clockAt(msk(14, 10, 15));
    await tick(chat, id);
    clockAt(msk(14, 10, 30));
    await human(chat, id, "Я тут");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 45)), dueExitId: "@first" });
    clockAt(msk(14, 10, 45));
    await tick(chat, id);
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 1 }] } });
  });

  it("свои касания ноды главнее общих, «off» выключает", async () => {
    const own = timerChat({
      edit: (json) => {
        product(json);
        stateOf(json, "intro").nudges = { afterSilence: [{ amount: 2, unit: "h" }] };
      },
    });
    const id = await started(own);
    expect(await own.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 12)), dueExitId: "@first" });

    const off = timerChat({
      edit: (json) => {
        product(json);
        stateOf(json, "intro").nudges = "off";
      },
    });
    const silent = await started(off);
    expect(await off.store.getChat(silent)).toMatchObject({ dueAt: null });
  });

  it("две копии сервера на одной базе — одно касание", async () => {
    const store = memoryFlowStore();
    const storage = createInMemoryChatStorage();
    const copies = [timerChat({ edit: product, store, storage }), timerChat({ edit: product, store, storage })];
    const id = await started(copies[0]!);
    clockAt(msk(14, 10, 15));
    await Promise.all(copies.map((copy) => copy.flow.tick()));
    for (const copy of copies) {
      await waitTurn(copy.service, id);
      await copy.flow.settled();
    }
    expect(copies[0]!.model.doStreamCalls.length + copies[1]!.model.doStreamCalls.length).toBe(2);
    expect(await agentTexts(copies[0]!.service, id)).toHaveLength(2);
  });
});

describe("T702/T704: в начале дня — одно сообщение на все причины", () => {
  it("переход ноды по дню и утреннее — один ход, обе причины в служебном сообщении", async () => {
    const chat = timerChat({ edit: threeDays() });
    const id = await started(chat, msk(13, 15));
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 9)), dueExitId: "intro_day" });
    clockAt(msk(14, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(await stateOfChat(chat.service, id)).toBe("block");
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({
      data: { exitId: "intro_day", reasons: [{ kind: "transition", stateId: "block" }, { kind: "morning" }] },
    });
    const prompt = promptText(chat.model.doStreamCalls.at(-1)!);
    expect(prompt).toContain("утро");
    expect(prompt).toContain("новое и полезное");
  });

  it("утреннее пропускается, если человек писал меньше чем за 3 ч до него", async () => {
    const chat = timerChat({ edit: threeDays({ firstMessages: { morning: true } }) });
    const id = await started(chat, msk(13, 15));
    clockAt(msk(14, 7));
    await human(chat, id, "Не спится");
    // Переход ноды остаётся на 9:00, утреннего в нём нет.
    clockAt(msk(14, 9));
    await tick(chat, id);
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({ data: { exitId: "intro_day", reasons: [{ kind: "transition", stateId: "block" }] } });
  });

  it("сообщения после жёсткой рамки — «ответь на накопленное» утром, вместе с утренним", async () => {
    const chat = timerChat({ edit: threeDays({ dayFrame: { hardAt: 2, hardText: "Утром отвечу!" } }) });
    const id = await started(chat, msk(13, 15));
    await human(chat, id, "второе");
    await human(chat, id, "третье");
    await human(chat, id, "четвёртое");
    expect(chat.model.doStreamCalls).toHaveLength(1);
    clockAt(msk(14, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({
      data: { reasons: [{ kind: "transition", stateId: "block" }, { kind: "morning" }, { kind: "night_messages", count: 2 }] },
    });
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain("накопил");
  });
});

describe("T706: лимит денег при ходе по таймеру (SC-105)", () => {
  it("лимит исчерпан — без хода, перенос на начало следующего дня; переход ноды применит следующий ход", async () => {
    let exhausted = false;
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {
        if (exhausted) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      }),
      status: vi.fn(async () => ({ state: "ok" as const })),
    };
    const chat = timerChat({ edit: threeDays(), chatOptions: { limits } });
    const id = await started(chat, msk(13, 15));
    exhausted = true;
    clockAt(msk(14, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)), dueExitId: "intro_day" });
    expect((await chat.store.getChat(id))!.pending).toEqual([expect.objectContaining({ kind: "transition" })]);

    exhausted = false;
    clockAt(msk(14, 12));
    await human(chat, id, "Я вернулся");
    expect(await stateOfChat(chat.service, id)).toBe("block");
  });
});
