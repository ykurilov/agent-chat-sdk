import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowTestClockError } from "../../src/runtime";
import { flowTestChatData } from "../../src/runtime/test-clock";
import { stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { daysChat, msk } from "./days-chat";
import { agentTexts, clockAt, human, OWNER, stateOfChat, timerChat } from "./timer-chat";

// 099: перемотка тестового чата ровно к моменту, когда сценарий напишет первым. Часы сервера стоят — время чата идёт
// только перемоткой.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const MINUTE = 60_000;

/** Продукт без дней: касания по тишине 15 мин и 1 ч, ночь с 21:00 до 9:00. */
const product = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = {
    dayStart: "09:00",
    nightFrom: "21:00",
    nudges: { afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }], giveUpAfter: { amount: 3, unit: "d" } },
  };
};

type AnyChat = Pick<ReturnType<typeof timerChat>, "service" | "flow">;

async function testChat(chat: AnyChat, at: number) {
  clockAt(at);
  const { id } = await chat.service.createChat(OWNER, { data: flowTestChatData() });
  await human(chat, id, "Курс по акварели");
  return id;
}

async function toNext(chat: AnyChat, chatId: string) {
  const result = await chat.flow.advanceTestClock({ ownerId: OWNER, chatId, to: "next_first_message" });
  await chat.flow.settled();
  return result;
}

describe("099 перемотка к следующему сообщению сценария", () => {
  it("касание по тишине: ровно через 15 мин, потом следующее касание ряда", async () => {
    const chat = timerChat({ edit: product });
    const id = await testChat(chat, msk(14, 10));

    expect(await toNext(chat, id)).toEqual({ timeOffset: 15 * MINUTE, reason: { kind: "silence", stateId: "intro", reasons: [{ kind: "silence", step: 1 }] } });
    expect(await agentTexts(chat.service, id)).toHaveLength(2);

    // Следующее касание — через 1 ч после первого.
    expect(await toNext(chat, id)).toMatchObject({ timeOffset: 75 * MINUTE, reason: { kind: "silence", reasons: [{ kind: "silence", step: 2 }] } });
    expect(await agentTexts(chat.service, id)).toHaveLength(3);
  });

  it("срок касания попал на ночь — к фактической отправке утром, а не к сырому сроку", async () => {
    const chat = timerChat({ edit: product });
    const id = await testChat(chat, msk(14, 20, 50));

    const result = await toNext(chat, id);
    expect(result.timeOffset).toBe(msk(15, 9) - msk(14, 20, 50));
    expect(result.reason).toMatchObject({ stateId: "intro" });
    expect(await agentTexts(chat.service, id)).toHaveLength(2);
  });

  it("утреннее через ночь: в 9:00 следующего дня", async () => {
    const chat = timerChat({
      edit: (json) => {
        withoutSilenceTimers(json);
        json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 3, firstMessages: { morning: true } };
      },
    });
    const id = await testChat(chat, msk(13, 15));

    expect(await toNext(chat, id)).toEqual({ timeOffset: msk(14, 9) - msk(13, 15), reason: { kind: "morning", stateId: "intro", reasons: [{ kind: "morning" }] } });
    expect(await agentTexts(chat.service, id)).toHaveLength(2);
  });

  it("выход ноды по сроку, затем «срок вышел»; дальше ничего — ошибка с кодом", async () => {
    const chat = daysChat();
    const id = await testChat(chat, msk(13, 15));

    expect(await toNext(chat, id)).toMatchObject({ timeOffset: msk(14, 9) - msk(13, 15), reason: { kind: "transition", stateId: "block", exitId: "intro_day" } });
    expect(await stateOfChat(chat.service, id)).toBe("block");
    expect(await toNext(chat, id)).toMatchObject({ timeOffset: msk(15, 9) - msk(13, 15), reason: { kind: "transition", stateId: "offer", exitId: "block_day" } });
    expect(await toNext(chat, id)).toMatchObject({ timeOffset: msk(16, 9) - msk(13, 15), reason: { kind: "deadline", stateId: "soft" } });
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "deadline" });

    const ended = chat.flow.advanceTestClock({ ownerId: OWNER, chatId: id, to: "next_first_message" });
    await expect(ended).rejects.toBeInstanceOf(FlowTestClockError);
    await expect(ended).rejects.toMatchObject({ code: "nothing_scheduled" });
  });

  it("касаний нет вовсе или ходов ещё не было — `nothing_scheduled`, часы не тронуты", async () => {
    const chat = timerChat({
      edit: (json) => {
        product(json);
        stateOf(json, "intro").nudges = "off";
        delete json.schedule.nudges.giveUpAfter;
      },
    });
    const id = await testChat(chat, msk(14, 10));
    await expect(toNext(chat, id)).rejects.toMatchObject({ code: "nothing_scheduled" });

    const { id: fresh } = await chat.service.createChat(OWNER, { data: flowTestChatData() });
    await expect(toNext(chat, fresh)).rejects.toMatchObject({ code: "nothing_scheduled" });
    expect(await chat.service.getChatData(OWNER, id)).toEqual(flowTestChatData());
  });

  it("рабочий чат не перематывается", async () => {
    const chat = timerChat({ edit: product });
    clockAt(msk(14, 10));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");
    await expect(toNext(chat, id)).rejects.toThrow(/тестов/);
  });
});
