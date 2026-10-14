import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, userMessage, waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { readAll } from "../../../core/tests/unit/support/mock-model";
import { localDay } from "../../src/format";
import { HOUR, MIN, stateOf } from "../flow-fixtures";
import { agentTexts, appNotices, clockAt, human, MSK, OWNER, stateOfChat, T0, tick, timerChat } from "./timer-chat";

// T070–T073 на модели-заглушке и подменённых часах: таймеры сценария, правила «писать первым», сигналы с «будить».

beforeEach(() => {
  // Пояс сервера — UTC, не пояс страницы: так тест не зависит от машины.
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const REMIND = "Вы ещё здесь? Можем продолжить, когда будет удобно.";
const MORNING = "Доброе утро! Вчера мы остановились на вашем курсе. Продолжим?";
/** 13.10.2026 по Москве, ЧЧ:ММ. */
const msk = (hours: number, minutes = 0, day = 13) => Date.UTC(2026, 9, day, hours - 3, minutes);
const iso = (at: number) => new Date(at).toISOString();

async function started() {
  const chat = timerChat();
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели, продал 5 штук");
  return { chat, id };
}

describe("T070/T071 срез: напоминание → утреннее касание → «назад»", () => {
  it("тишина 3 ч — «Напоминание» точным текстом без модели; утром — «Утреннее касание»; человек ответил — назад", async () => {
    const { chat, id } = await started();
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(T0 + 3 * HOUR), dueExitId: "any_silence", timeZone: MSK });

    clockAt(T0 + 3 * HOUR - MIN);
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect(await appNotices(chat.storage, id)).toEqual([]);

    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("remind");
    expect((await agentTexts(chat.service, id)).at(-1)).toBe(REMIND);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await appNotices(chat.storage, id)).toMatchObject([{ name: "flow_timer", data: { exitId: "any_silence" }, wakeAgent: true }]);
    // Следующий — утро по часам человека; таймер забирает ровно один, пачкой не догоняется.
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(10, 0, 14)), dueExitId: "remind_morning" });

    clockAt(msk(10, 0, 14));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("morning");
    expect((await agentTexts(chat.service, id)).at(-1)).toBe(MORNING);
    expect(chat.model.doStreamCalls).toHaveLength(1);

    clockAt(msk(10, 30, 14));
    await human(chat, id, "Да, я тут");
    const { values } = await chat.service.getChatState(OWNER, id);
    expect(values.flow).toMatchObject({ state: "intro" });
    expect((values.flow as { path: unknown[] }).path.at(-1)).toMatchObject({ from: "morning", exitId: "morning_message", decidedBy: "event" });
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(await chat.store.countFirstMessages(OWNER, localDay(msk(10, 0, 14), MSK))).toBe(1);
    expect(chat.logError).not.toHaveBeenCalled();
  });

  it("у нового состояния нет точного текста — ход модели по служебному сообщению «Сработало: …»", async () => {
    const chat = timerChat({ edit: (json) => delete stateOf(json, "remind").firstMessage });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);

    expect(await stateOfChat(chat.service, id)).toBe("remind");
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(chat.model.doStreamCalls[1]!.prompt)).toContain("Сработало: тишина 3 ч");
  });

  it("человек ответил до срока — отсчёт тишины заново от нового ответа агента", async () => {
    const { chat, id } = await started();
    clockAt(T0 + 3 * HOUR - MIN);
    await human(chat, id, "ещё вопрос");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(T0 + 6 * HOUR - MIN), dueExitId: "any_silence" });

    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect(chat.model.doStreamCalls).toHaveLength(2);
  });

  it("нажата кнопка — переход в конечное состояние: таймеров больше нет", async () => {
    const chat = timerChat({
      agent: { widgets: { basic: ["ask_choice"] } },
      edit: (json) => stateOf(json, "intro").exits.push({ id: "intro_choice", when: { type: "event", event: "button", name: "ask_choice" }, to: "booked" }),
      scripts: [callTool("ask_choice", "w1", { question: "Записать?", options: ["Да", "Нет"] })],
    });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");
    expect((await chat.store.getChat(id))?.dueAt).not.toBeNull();

    await chat.service.answerWidget({ chatId: id, ownerId: OWNER, toolCallId: "w1", answer: { выбрано: "Да" } });
    await waitTurn(chat.service, id);
    await chat.flow.settled();
    expect(await stateOfChat(chat.service, id)).toBe("booked");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null, dueExitId: null });
  });

  it("смена ветки — таймер по месту новой ветки", async () => {
    const { chat, id } = await started();
    clockAt(T0 + HOUR);
    const second = await human(chat, id, "второе");
    expect((await chat.store.getChat(id))?.dueAt).toBe(iso(T0 + 4 * HOUR));

    clockAt(T0 + 2 * HOUR);
    await readAll(await chat.service.editMessage(OWNER, id, second, userMessage("h-edit", "второе, исправил"), { page: { timeZone: MSK } }));
    await chat.flow.settled();
    expect((await chat.store.getChat(id))?.dueAt).toBe(iso(T0 + 5 * HOUR));

    await chat.service.selectBranch(OWNER, id, second);
    await chat.flow.settled();
    expect((await chat.store.getChat(id))?.dueAt).toBe(iso(T0 + 4 * HOUR));
  });
});

describe("T071 тик: занятый чат, удалённый чат, повтор", () => {
  it("чат занят — срок остаётся, следующий тик доставляет", async () => {
    const { chat, id } = await started();
    const deliver = vi.spyOn(chat.service, "deliverNotices").mockResolvedValueOnce({ status: "busy", turnStarted: false });
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(T0 + 3 * HOUR), dueExitId: "any_silence" });

    await tick(chat, id);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(await stateOfChat(chat.service, id)).toBe("remind");
  });

  it("чат удалён — строка сценария удаляется, ничего не шлётся", async () => {
    const { chat, id } = await started();
    await chat.service.deleteChat(OWNER, id);
    clockAt(T0 + 3 * HOUR);
    await chat.flow.tick();
    expect(await chat.store.getChat(id)).toBeNull();
    expect(chat.logError).not.toHaveBeenCalled();
  });

  it("ход не начался (5 ходов сервера подряд, лимит) — переход записан ожидающим и применится в начале хода человека", async () => {
    const { chat, id } = await started();
    vi.spyOn(chat.service, "deliverNotices").mockImplementationOnce(async () => ({ status: "delivered", messageId: "n1", turnStarted: false }));
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect((await chat.store.getChat(id))?.dueAt).toBeNull();
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ state: "remind" });

    clockAt(T0 + 4 * HOUR);
    await human(chat, id, "я вернулся");
    const { values } = await chat.service.getChatState(OWNER, id);
    // Таймер перевёл в «Напоминание», сообщение человека вернуло назад.
    expect((values.flow as { path: Array<{ state: string; decidedBy: string }> }).path.slice(-2)).toMatchObject([
      { state: "remind", decidedBy: "timer" },
      { state: "intro", decidedBy: "event" },
    ]);
  });
});

describe("T072 правила «писать первым» в тике", () => {
  it("срок в тихие часы — перенос на 09:00 по времени человека; в 09:00 — сообщение", async () => {
    const chat = timerChat();
    const { id } = await chat.service.createChat(OWNER);
    clockAt(msk(19));
    await human(chat, id, "вечер");
    clockAt(msk(22));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(9, 0, 14)), dueExitId: "any_silence" });

    clockAt(msk(9, 0, 14));
    await tick(chat, id);
    expect((await agentTexts(chat.service, id)).at(-1)).toBe(REMIND);
  });

  it("потолок в день исчерпан — следующее завтра", async () => {
    const chat = timerChat({ firstMessages: { maxPerDay: 1, quietHours: { from: "00:00", to: "00:00" } } });
    const { id } = await chat.service.createChat(OWNER);
    clockAt(msk(3));
    await human(chat, id, "ночью");
    clockAt(msk(6));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("remind");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(10)), dueExitId: "remind_morning" });

    clockAt(msk(10));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("remind");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(0, 0, 14)), dueExitId: "remind_morning" });

    clockAt(msk(0, 0, 14));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("morning");
  });

  it("правила выключены (false) — пишет без тихих часов и потолка, счётчик не ведётся", async () => {
    const chat = timerChat({ firstMessages: false });
    const { id } = await chat.service.createChat(OWNER);
    clockAt(msk(19));
    await human(chat, id, "вечер");
    clockAt(msk(22));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("remind");
    expect((await agentTexts(chat.service, id)).at(-1)).toBe(REMIND);
    expect(await chat.store.countFirstMessages(OWNER, localDay(msk(22), MSK))).toBe(0);
  });

  it("canWriteNow вернул false — агент первым не пишет, таймер только переводит состояние к следующему ходу", async () => {
    const chat = timerChat({ firstMessages: { canWriteNow: () => false } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    expect(await appNotices(chat.storage, id)).toEqual([]);
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ state: "remind" });
    expect((await chat.store.getChat(id))?.dueAt).toBeNull();
  });

  it("человек ответил, пока таймер проверял правила, — точный текст не уходит, срок по новому ответу", async () => {
    let chat: ReturnType<typeof timerChat>;
    let id = "";
    let raced = false;
    chat = timerChat({
      firstMessages: {
        canWriteNow: async () => {
          if (!raced) {
            raced = true;
            await readAll(await chat.service.sendMessage(OWNER, id, userMessage("h-race", "я тут"), { page: { timeZone: MSK } }));
          }
          return true;
        },
      },
    });
    ({ id } = await chat.service.createChat(OWNER));
    await human(chat, id, "привет");
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);

    expect(raced).toBe(true);
    expect(await appNotices(chat.storage, id)).toEqual([]);
    expect(await agentTexts(chat.service, id)).not.toContain(REMIND);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(T0 + 6 * HOUR), dueExitId: "any_silence" });
  });

  it("пояс со страницы не затирается ходом из мессенджера; без пояса страницы — пояс приложения", async () => {
    const chat = timerChat({ agent: { timeZone: "Asia/Makassar" } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "со страницы", MSK);
    expect((await chat.store.getChat(id))?.timeZone).toBe(MSK);
    await human(chat, id, "из мессенджера", null);
    expect((await chat.store.getChat(id))?.timeZone).toBe(MSK);

    // Пояс человека общий для всех его разговоров (этап 4): пояс приложения — у человека, чей пояс неизвестен.
    const fresh = timerChat({ agent: { timeZone: "Asia/Makassar" } });
    const other = await fresh.service.createChat(OWNER);
    clockAt(msk(19));
    await human(fresh, other.id, "только мессенджер", null);
    // 22:00 по Москве — 03:00 по Макассару: тихие часы по поясу приложения, перенос на 09:00 Макассара.
    clockAt(msk(22));
    await tick(fresh, other.id);
    expect((await fresh.store.getChat(other.id))?.dueAt).toBe(iso(Date.UTC(2026, 9, 14, 1, 0)));
    expect(chat.logError).not.toHaveBeenCalled();
    expect(fresh.logError).not.toHaveBeenCalled();
  });

  it("пояса нет ни со страницы, ни у приложения — пояс сервера и предупреждение в журнал один раз на чат", async () => {
    const chat = timerChat();
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "из мессенджера", null);
    await human(chat, id, "ещё", null);
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    const warnings = chat.logError.mock.calls.filter(([message]) => message.includes("пояс"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toContain(id);
  });
});

describe("T073 flow.signal с «будить»", () => {
  const paid = (json: Record<string, any>) => stateOf(json, "intro").exits.push({ id: "intro_paid", when: { type: "event", event: "app", name: "paid" }, to: "booked" });

  it("агент переходит и пишет первым сразу; точный текст — без модели; ожидающего не остаётся", async () => {
    const chat = timerChat({ edit: paid });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");
    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid", data: { sum: 990 }, wakeAgent: true });
    await waitTurn(chat.service, id);
    await chat.flow.settled();

    expect(await stateOfChat(chat.service, id)).toBe("booked");
    expect((await agentTexts(chat.service, id)).at(-1)).toBe("Спасибо за разговор! Анна посмотрит ваши ответы перед разбором. До встречи!");
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await appNotices(chat.storage, id)).toMatchObject([{ name: "flow_event", data: { name: "paid", data: { sum: 990 } } }]);
    expect((await chat.store.getChat(id))?.pending).toEqual([]);

    // Следующий ход человека событие второй раз не применяет.
    await human(chat, id, "спасибо");
    const { values } = await chat.service.getChatState(OWNER, id);
    expect((values.flow as { path: unknown[] }).path).toHaveLength(2);
  });

  it("срочный сигнал проходит мимо тихих часов и потолка; счётчик «писал первым» не растёт", async () => {
    const chat = timerChat({ edit: paid, firstMessages: { maxPerDay: 0 } });
    const { id } = await chat.service.createChat(OWNER);
    clockAt(msk(20));
    await human(chat, id, "привет");
    clockAt(msk(23, 30));
    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid", wakeAgent: true });
    await waitTurn(chat.service, id);
    await chat.flow.settled();
    expect(await stateOfChat(chat.service, id)).toBe("booked");
    expect(await chat.store.countFirstMessages(OWNER, localDay(msk(23, 30), MSK))).toBe(0);
  });

  it("чат занят — событие ждёт начала следующего хода", async () => {
    const chat = timerChat({ edit: paid });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");
    vi.spyOn(chat.service, "deliverNotices").mockResolvedValueOnce({ status: "busy", turnStarted: false });
    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid", wakeAgent: true });
    expect((await chat.store.getChat(id))?.pending).toMatchObject([{ kind: "event", name: "paid" }]);

    await human(chat, id, "оплатил");
    expect(await stateOfChat(chat.service, id)).toBe("booked");
  });
});
