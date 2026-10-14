import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, saying, waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { readAll } from "../../../core/tests/unit/support/mock-model";
import { flowTestChatData } from "../../src/runtime/test-clock";
import { stateOf } from "../flow-fixtures";
import { agentTexts, appNotices, clockAt, human, OWNER, stateOfChat, tick, timerChat, type TimerChat, type TimerChatSetup } from "./timer-chat";
import { iso, msk } from "./days-chat";

// Таймер «наступил день N программы» на модели-заглушке и подменённых часах. «Поиск затыка» → «Предложение» в начале
// дня 3, сколько бы клиент ни пробыл в «Поиске затыка». Тишина — 1000 ч: дни видно без касаний.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const programDays =
  (lengthDays = 5) =>
  (json: Record<string, any>) => {
    json.anyState.exits[0].when.amount = 1000;
    json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays, deadlineState: "soft" };
    stateOf(json, "block").exits.push({ id: "block_day3", when: { type: "timer", from: "program_day", day: 3 }, to: "offer" });
  };

/** Агент заявил «знакомство пройдено», судья подтвердил — «Поиск затыка» в этом же ходе. */
const claim = [callTool("flow_exit", "x1", { exit: 1, why: "человек рассказал о курсе" }), saying("Отлично, записываю.")];

async function started(setup: TimerChatSetup, data?: Record<string, unknown>) {
  const chat = timerChat({ yes: ["intro_clear"], ...setup });
  clockAt(msk(13, 15));
  const { id } = await chat.service.createChat(OWNER, data ? { data } : undefined);
  await human(chat, id, "Курс по акварели, продал 5 штук");
  return { chat, id };
}

/** «Предложение» → «Сомнения» в начале дня 5. */
const withDay5 = (json: Record<string, any>) => {
  programDays()(json);
  stateOf(json, "offer").exits.push({ id: "offer_day5", when: { type: "timer", from: "program_day", day: 5 }, to: "doubts" });
};

const lastAnswerId = async (chat: TimerChat, chatId: string) => {
  const { messages } = await chat.service.peekHistory(OWNER, chatId);
  return messages.findLast((message) => message.role === "assistant")!.id;
};

const timerTurns = async (chat: TimerChat, id: string) => (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer" && notice.wakeAgent);
const placeOf = async (chat: TimerChat, id: string) => (await chat.flow.readRun(OWNER, id))!;

describe("«наступил день N программы»", () => {
  it("быстрый клиент вошёл в ноду в день 1 — переход в начале дня 3, а не дня 2; с утренним — одним ходом", async () => {
    const { chat, id } = await started({ edit: programDays(), scripts: claim });
    expect(await stateOfChat(chat.service, id)).toBe("block");

    for (const at of [msk(14, 9), msk(14, 15), msk(15, 8, 59)]) {
      clockAt(at);
      await tick(chat, id);
    }
    expect(await stateOfChat(chat.service, id)).toBe("block");
    // День 2 — только утреннее.
    expect((await timerTurns(chat, id)).map((turn) => turn.data)).toEqual([expect.objectContaining({ reasons: [{ kind: "morning" }] })]);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)), dueExitId: "block_day3" });

    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect((await timerTurns(chat, id)).slice(1)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ exitId: "block_day3", reasons: [{ kind: "transition", stateId: "offer" }, { kind: "morning" }] }) }),
    ]);
    expect((await placeOf(chat, id)).day).toMatchObject({ day: 3 });
  });

  it("вошёл в ноду в день 4 — переход в том же ходе: один ответ уже из новой ноды, без второго сообщения", async () => {
    const { chat, id } = await started({ edit: programDays(), scripts: [saying("Расскажите подробнее."), ...claim] });
    expect(await stateOfChat(chat.service, id)).toBe("intro");

    clockAt(msk(16, 12));
    await human(chat, id, "Вот подробности");
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect(await agentTexts(chat.service, id)).toEqual(["Расскажите подробнее.", "Отлично, записываю."]);
    // Инструмент вернул модели карточку уже «Предложения».
    expect(JSON.stringify(chat.model.doStreamCalls.at(-1)!.prompt)).toContain("наступил день 3");

    clockAt(msk(16, 12) + 15_000);
    await tick(chat, id);
    expect(await timerTurns(chat, id)).toEqual([]);
    expect(await agentTexts(chat.service, id)).toHaveLength(2);
  });

  it("писать первым нельзя («never»): переход в срок без хода — запись, событие с днём 3, таймеры новой ноды; ход человека его не повторяет", async () => {
    const canWriteNow = vi.fn((): "never" => "never");
    const onTransition = vi.fn();
    const { chat, id } = await started({ edit: withDay5, scripts: claim, firstMessages: { canWriteNow }, onTransition });
    const calls = chat.model.doStreamCalls.length;
    onTransition.mockClear();

    for (const at of [msk(14, 9), msk(15, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    // В срок, без хода: запись чата, событие с днём, место и путь.
    expect(await chat.store.getChat(id)).toMatchObject({ stateId: "offer" });
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0]![0]).toMatchObject({ exitId: "block_day3", from: "block", to: "offer", at: msk(15, 9), day: { day: 3 } });
    const place = await placeOf(chat, id);
    expect(place).toMatchObject({ state: "offer", day: { day: 3 } });
    expect(place.path.map((entry) => entry.state)).toContain("offer");
    // Следующий срок — уже по новой ноде: «с дня 5».
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(17, 9)), dueExitId: "offer_day5" });

    // Ход человека догоняет место, событие не повторяется.
    clockAt(msk(15, 12));
    await human(chat, id, "Я тут");
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chat.model.doStreamCalls.at(-1)!.prompt)).toContain("наступил день 3");
  });

  it("«Переделать» после перехода, применённого в срок: нода новая, onTransition один раз, таймер не повторяет переход", async () => {
    const canWriteNow = vi.fn((): "never" => "never");
    const onTransition = vi.fn();
    const { chat, id } = await started({ edit: withDay5, scripts: claim, firstMessages: { canWriteNow }, onTransition });
    onTransition.mockClear();
    clockAt(msk(15, 9));
    await tick(chat, id);
    clockAt(msk(15, 12));
    await human(chat, id, "Я тут");
    expect(await stateOfChat(chat.service, id)).toBe("offer");

    await readAll(await chat.service.regenerate(OWNER, id, await lastAnswerId(chat, id)));
    await chat.flow.settled();
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    // Ближайший срок — утреннее завтра, а не переход «с дня 3» в прошлом.
    expect(await chat.store.getChat(id)).toMatchObject({ stateId: "offer", dueAt: iso(msk(16, 9)), dueExitId: "@first" });
    clockAt(msk(15, 12, 5));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect(onTransition).toHaveBeenCalledTimes(1);
  });

  it("ночью «позже», утром «never»: ожидающий получает appliedAt — ход человека не повторяет onTransition, таймеры от новой ноды", async () => {
    let answer: false | "never" = false;
    const canWriteNow = vi.fn(() => answer);
    const onTransition = vi.fn();
    const { chat, id } = await started({ edit: withDay5, scripts: claim, firstMessages: { canWriteNow }, onTransition });
    onTransition.mockClear();
    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(onTransition).not.toHaveBeenCalled();
    answer = "never";
    clockAt(msk(15, 10));
    await tick(chat, id);
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(await chat.store.getChat(id)).toMatchObject({ stateId: "offer", dueAt: iso(msk(17, 9)), dueExitId: "offer_day5" });

    clockAt(msk(15, 12));
    await human(chat, id, "Я тут");
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect(onTransition).toHaveBeenCalledTimes(1);
  });

  it("ход дотянул цепочку поверх применённого в срок перехода — onTransition для дотянутого", async () => {
    const canWriteNow = vi.fn((): "never" => "never");
    const onTransition = vi.fn();
    const { chat, id } = await started({ edit: withDay5, scripts: claim, firstMessages: { canWriteNow }, onTransition });
    onTransition.mockClear();
    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(onTransition).toHaveBeenCalledTimes(1);
    // День 5 без тика: ход человека дотягивает «Предложение» → «Сомнения».
    clockAt(msk(17, 12));
    await human(chat, id, "Я тут");
    expect(await stateOfChat(chat.service, id)).toBe("doubts");
    expect(onTransition.mock.calls.map(([event]) => event.exitId)).toEqual(["block_day3", "offer_day5"]);
  });

  it("тестовый чат: «к началу следующего дня» дважды — день 2 ещё в ноде, день 3 — переход", async () => {
    const { chat, id } = await started({ edit: programDays(), scripts: claim }, flowTestChatData());
    const nextDay = async () => {
      await chat.flow.advanceTestClock({ ownerId: OWNER, chatId: id, to: "next_day_start" });
      await waitTurn(chat.service, id);
      await chat.flow.settled();
    };

    await nextDay();
    expect(await stateOfChat(chat.service, id)).toBe("block");
    await nextDay();
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect((await placeOf(chat, id)).day).toMatchObject({ day: 3 });
  });
});
