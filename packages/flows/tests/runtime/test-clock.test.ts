import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { flowTestChatData, testChatOffset } from "../../src/runtime/test-clock";
import { HOUR } from "../flow-fixtures";
import { agentTexts, human, OWNER, stateOfChat, T0, timerChat, type TimerChat } from "./timer-chat";

// T100: перемотка часов тестового чата. Часы сервера стоят на T0 — время чата идёт только перемоткой.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const REMIND = "Вы ещё здесь? Можем продолжить, когда будет удобно.";
/** 13.10.2026 по Москве, ЧЧ:ММ. */
const msk = (hours: number, minutes = 0, day = 13) => Date.UTC(2026, 9, day, hours - 3, minutes);
const iso = (at: number) => new Date(at).toISOString();

async function runOf(chat: TimerChat, chatId: string) {
  const { values } = await chat.service.getChatState(OWNER, chatId);
  return values.flow as { state: string; timeOffset?: number; lastHumanAt: number | null };
}

async function advance(chat: TimerChat, chatId: string, ms: number) {
  const result = await chat.flow.advanceTestClock({ ownerId: OWNER, chatId, ms });
  await waitTurn(chat.service, chatId);
  await chat.flow.settled();
  return result;
}

async function testChat(chat: TimerChat) {
  const { id } = await chat.service.createChat(OWNER, { data: flowTestChatData() });
  await human(chat, id, "Курс по акварели, продал 5 штук");
  return id;
}

describe("T100 данные тестового чата", () => {
  it("сдвиг есть только у чата, созданного с пометкой теста", () => {
    expect(testChatOffset(flowTestChatData())).toBe(0);
    expect(testChatOffset(undefined)).toBeNull();
    expect(testChatOffset({ source: "landing" })).toBeNull();
  });
});

describe("T100 перемотка часов", () => {
  it("рабочий чат не перематывается и сдвига в месте не получает", async () => {
    const chat = timerChat();
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");

    await expect(chat.flow.advanceTestClock({ ownerId: OWNER, chatId: id, ms: 3 * HOUR })).rejects.toThrow(/тестов/);
    expect((await runOf(chat, id)).timeOffset).toBeUndefined();
    expect(await stateOfChat(chat.service, id)).toBe("intro");
  });

  it("«+3 ч» — тишина 3 ч наступает сразу: напоминание без ожидания, следующий срок по сдвинутым часам", async () => {
    const chat = timerChat();
    const id = await testChat(chat);
    expect((await runOf(chat, id)).timeOffset).toBe(0);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(T0 + 3 * HOUR) });

    expect(await advance(chat, id, 3 * HOUR)).toEqual({ timeOffset: 3 * HOUR });

    expect(await stateOfChat(chat.service, id)).toBe("remind");
    expect((await agentTexts(chat.service, id)).at(-1)).toBe(REMIND);
    // Утро 14-го по часам чата — на часах сервера на 3 ч раньше.
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(10, 0, 14) - 3 * HOUR), dueExitId: "remind_morning" });

    // Ход человека идёт по часам чата: сдвиг попал в место, время сообщения — сдвинутое.
    await human(chat, id, "Да, я тут");
    expect(await runOf(chat, id)).toMatchObject({ timeOffset: 3 * HOUR, lastHumanAt: T0 + 3 * HOUR });
    expect(chat.logError).not.toHaveBeenCalled();
  });

  it("правила «писать первым» по сдвинутым часам: в тихие часы чата молчит, утром чата пишет", async () => {
    const chat = timerChat();
    const id = await testChat(chat);

    // 15:00 + 7 ч = 22:00 по часам чата: тихие часы, срок переносится на 09:00 чата.
    await advance(chat, id, 7 * HOUR);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(9, 0, 14) - 7 * HOUR), dueExitId: "any_silence" });

    // Ещё 11 ч — 09:00 следующего дня по часам чата.
    await advance(chat, id, 11 * HOUR);
    expect(await stateOfChat(chat.service, id)).toBe("remind");
    expect((await agentTexts(chat.service, id)).at(-1)).toBe(REMIND);
  });

  it("чат без хода: сдвиг записан, таймеров ещё нет", async () => {
    const chat = timerChat();
    const { id } = await chat.service.createChat(OWNER, { data: flowTestChatData() });
    expect(await advance(chat, id, HOUR)).toEqual({ timeOffset: HOUR });
    expect(testChatOffset(await chat.service.getChatData(OWNER, id))).toBe(HOUR);
  });
});

