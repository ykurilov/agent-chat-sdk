import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, saying } from "../../../core/tests/unit/support/notice-chat";
import { flowTestChatData } from "../../src/runtime/test-clock";
import { stateOf } from "../flow-fixtures";
import { agentTexts, clockAt, human, MSK, OWNER, stateOfChat, tick } from "./timer-chat";
import { daysChat, iso, msk, NSK, nsk, promptText, systemOf, threeDays } from "./days-chat";

// T403–T406 на модели-заглушке и подменённых часах: дни сценария, конец разговора, пояс человека, хвост, перемотка.

beforeEach(() => {
  // Пояс сервера — UTC: тест не зависит от машины.
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

type DaysChat = ReturnType<typeof daysChat>;

async function startedAt(at: number, chat: DaysChat = daysChat(), timeZone: string | null = MSK) {
  clockAt(at);
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели", timeZone);
  return { chat, id };
}

async function runOf(chat: DaysChat, id: string) {
  return (await chat.service.getChatState(OWNER, id)).values.flow as Record<string, any>;
}

describe("T403: три дня по нодам, «срок вышел», конечная нода", () => {
  // Агент заявил «знакомство пройдено», судья подтвердил — переход в этом же ходе.
  const claimed = [callTool("flow_exit", "x1", { exit: 1, why: "человек рассказал о курсе" }), saying("Отлично, записываю.")];

  it("нода длится 1 день — переход в 9:00 следующего дня; срок — конец «deadline» в deadlineState, без хода модели", async () => {
    const { chat, id } = await startedAt(msk(13, 15));
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 9)), dueExitId: "intro_day" });

    clockAt(msk(14, 9));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("block");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)), dueExitId: "block_day" });

    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(16, 9)), dueExitId: "@deadline" });
    const calls = chat.model.doStreamCalls.length;

    clockAt(msk(16, 9));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ stateId: "soft", endReason: "deadline", endedAt: iso(msk(16, 9)), dueAt: null });
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(chat.finished).toEqual([
      expect.objectContaining({ ownerId: OWNER, chatId: id, flowId: "sales-review", versionId: "v1", reason: "deadline", day: 3, state: "soft", at: new Date(msk(16, 9)) }),
    ]);
    // Для передачи человека дальше: место в сценарии с заметками чата; карточка — по `ownerId`.
    expect(chat.finished[0]!.run).toMatchObject({ state: "soft", notes: {} });
    expect(chat.transitions.at(-1)).toMatchObject({ from: "offer", to: "soft", reason: { kind: "timer", text: "срок вышел" } });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "ended", reason: "deadline", afterEnd: "reply" });
  });

  it("после конца (reply): агент отвечает по инструкции «после конца», переходов и сроков нет", async () => {
    const { chat, id } = await startedAt(msk(13, 15));
    const rulesBefore = systemOf(chat.model.doStreamCalls[0]!);
    for (const at of [msk(14, 9), msk(15, 9), msk(16, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    clockAt(msk(18, 12));
    await human(chat, id, "А можно ещё вопрос?");
    const last = chat.model.doStreamCalls.at(-1)!;
    expect(systemOf(last)).toContain("Программа закончилась");
    expect(systemOf(last)).not.toBe(rulesBefore);
    expect(await runOf(chat, id)).toMatchObject({ state: "soft", endReason: "deadline", endedAt: msk(16, 9) });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null });
    expect(chat.finished).toHaveLength(1);
  });

  it("silent: после конца сообщение человека записывается, агент молчит", async () => {
    const { chat, id } = await startedAt(msk(13, 15), daysChat({ edit: (json) => (threeDays(json), (json.afterEnd = "silent")) }));
    for (const at of [msk(14, 9), msk(15, 9), msk(16, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    const calls = chat.model.doStreamCalls.length;
    clockAt(msk(18, 12));
    await human(chat, id, "А можно ещё вопрос?");
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "ended", reason: "deadline", afterEnd: "silent" });
  });

  it("прощание при сроке с готовым текстом — слово в слово, без модели", async () => {
    const farewell = "Программа закончилась. Спасибо, что были с нами!";
    const chat = daysChat({ edit: (json) => threeDays(json, { farewellOnDeadline: true, farewellText: farewell }) });
    const { id } = await startedAt(msk(13, 15), chat);
    for (const at of [msk(14, 9), msk(15, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    const calls = chat.model.doStreamCalls.length;
    clockAt(msk(16, 9));
    await tick(chat, id);
    expect((await agentTexts(chat.service, id)).at(-1)).toBe(farewell);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(chat.finished).toHaveLength(1);
  });

  it("прощание без текста — один ход модели по служебному сообщению и инструкции «после конца»", async () => {
    const chat = daysChat({ edit: (json) => threeDays(json, { farewellOnDeadline: true }) });
    const { id } = await startedAt(msk(13, 15), chat);
    for (const at of [msk(14, 9), msk(15, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    const calls = chat.model.doStreamCalls.length;
    clockAt(msk(16, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(calls + 1);
    const last = chat.model.doStreamCalls.at(-1)!;
    expect(promptText(last)).toContain("Срок программы вышел");
    expect(systemOf(last)).toContain("Программа закончилась");
  });

  it("таймер не сработал (сервер стоял) — срок закрывает разговор на первом сообщении человека, одно событие", async () => {
    const { chat, id } = await startedAt(msk(13, 15));
    clockAt(msk(17, 10));
    await human(chat, id, "Я вернулся");
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "deadline", stateId: "soft" });
    expect(await runOf(chat, id)).toMatchObject({ state: "soft", endReason: "deadline" });
    expect(chat.finished).toEqual([expect.objectContaining({ reason: "deadline", day: 3 })]);
  });

  it("перенос чата со сроком в прошлом — разговор закончен сразу, первый же ответ «после конца»", async () => {
    const chat = daysChat({
      loadFlow: (json) => async () => ({ flowId: "sales-review", versionId: "v1", flow: json, stateId: "block", startedAt: new Date(msk(3, 12)) }),
    });
    const { id } = await startedAt(msk(13, 15), chat);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "deadline", stateId: "soft" });
    expect(chat.finished).toEqual([expect.objectContaining({ reason: "deadline", state: "soft" })]);
    expect(systemOf(chat.model.doStreamCalls[0]!)).toContain("Программа закончилась");
  });

  it("конечная нода закрывает разговор «final» у сценария с днями; событие одно", async () => {
    const chat = daysChat({ yes: ["intro_clear"], scripts: claimed, edit: (json) => (threeDays(json), (stateOf(json, "intro").exits[0].to = "booked")) });
    const { id } = await startedAt(msk(13, 15), chat);
    expect(await stateOfChat(chat.service, id)).toBe("booked");
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "final", stateId: "booked" });
    expect(chat.finished).toEqual([expect.objectContaining({ reason: "final", state: "booked", day: 1 })]);
    clockAt(msk(13, 16));
    await human(chat, id, "Спасибо!");
    expect(systemOf(chat.model.doStreamCalls.at(-1)!)).toContain("Программа закончилась");
    expect(chat.finished).toHaveLength(1);
  });

  it("сценарий без дней и без afterEnd: конечная нода — только событие, поведение 0.48", async () => {
    const chat = daysChat({
      yes: ["intro_clear"],
      scripts: claimed,
      edit: (json) => {
        const intro = stateOf(json, "intro");
        intro.exits[0].to = "booked";
        // «Поиск затыка» остаётся достижимым: долгая тишина в «Знакомстве».
        intro.exits.push({ id: "intro_quiet", when: { ...json.anyState.exits[0].when, amount: 1000 }, to: "block" });
      },
    });
    const { id } = await startedAt(msk(13, 15), chat);
    expect(await stateOfChat(chat.service, id)).toBe("booked");
    expect(await chat.store.getChat(id)).toMatchObject({ endedAt: null });
    expect(chat.finished).toEqual([expect.objectContaining({ reason: "final", state: "booked", day: null })]);
    clockAt(msk(13, 16));
    await human(chat, id, "Спасибо!");
    expect(systemOf(chat.model.doStreamCalls.at(-1)!)).not.toContain("Программа закончилась");
  });
});

describe("T404: пояс человека", () => {
  it("пояс со страницы пишется человеку через адаптер people; другой чат без страницы берёт его", async () => {
    const zones = new Map<string, string>();
    const people = {
      readTimeZone: vi.fn(async (ownerId: string) => zones.get(ownerId) ?? null),
      writeTimeZone: vi.fn(async (ownerId: string, timeZone: string) => void zones.set(ownerId, timeZone)),
    };
    const chat = daysChat({ people, agent: { timeZone: MSK } });
    await startedAt(msk(13, 15), chat, NSK);
    expect(people.writeTimeZone).toHaveBeenCalledWith(OWNER, NSK);

    const { id: second } = await chat.service.createChat(OWNER);
    await human(chat, second, "Привет из мессенджера", null);
    expect(await chat.store.getChat(second)).toMatchObject({ timeZone: NSK });
    // 15:00 по Москве — 19:00 у человека: до ночи меньше 3 ч, первый день — завтра по его часам.
    expect(await runOf(chat, second)).toMatchObject({ dayAnchorAt: nsk(14, 9) });
  });

  it("flow_time_zone: человек назвал город после позднего старта — первый день и сроки по его часам (→ В1)", async () => {
    // Пришёл из мессенджера в 20:30 по Москве (у него 00:30): пояс неизвестен, первый день — завтра по Москве.
    const chat = daysChat({
      agent: { timeZone: MSK },
      scripts: [saying("Здравствуйте!"), callTool("flow_time_zone", "z1", { timeZone: NSK }), saying("Буду писать по вашему времени.")],
    });
    const { id } = await startedAt(msk(13, 20, 30), chat, null);
    expect(await runOf(chat, id)).toMatchObject({ dayAnchorAt: msk(14, 9) });
    expect(JSON.stringify(chat.model.doStreamCalls[0]!.tools)).toContain("flow_time_zone");

    clockAt(msk(13, 20, 35));
    await human(chat, id, "Я из Новосибирска", null);
    expect(await chat.store.readTimeZone(OWNER)).toBe(NSK);
    // Ближайший срок — утреннее первого дня по его часам (этап 7: при сроке программы утреннее включено).
    expect(await chat.store.getChat(id)).toMatchObject({ timeZone: NSK, dueAt: iso(nsk(14, 9)), dueExitId: "@first" });
    expect(await runOf(chat, id)).toMatchObject({ dayAnchorAt: nsk(14, 9) });
  });

  it("flow_time_zone: неизвестный пояс — отказ словами, ничего не записано", async () => {
    const chat = daysChat({ agent: { timeZone: MSK }, scripts: [callTool("flow_time_zone", "z1", { timeZone: "Mars/Olympus" }), saying("Понял.")] });
    const { id } = await startedAt(msk(13, 15), chat, null);
    expect(promptText(chat.model.doStreamCalls[1]!)).toContain("Нет такого пояса");
    expect(await chat.store.readTimeZone(OWNER)).toBeNull();
    expect(await chat.store.getChat(id)).toMatchObject({ timeZone: "" });
  });

  it("на третий день смена пояса не меняет номер дня, сроки — по новым часам", async () => {
    const chat = daysChat({ agent: { timeZone: MSK } });
    const { id } = await startedAt(msk(13, 15), chat, MSK);
    for (const at of [msk(14, 9), msk(15, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    clockAt(msk(15, 12));
    await human(chat, id, "Я переехал", NSK);
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ day: { day: 3, totalDays: 3, isLastDay: true } });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(nsk(16, 9)), dueExitId: "@deadline" });
  });
});

describe("T405: день в хвосте запроса, постоянная инструкция одна", () => {
  it("«День 1 из 3», «День 3 из 3 — сегодня последний день»; инструкция одинакова во все дни", async () => {
    const { chat, id } = await startedAt(msk(13, 15));
    const first = chat.model.doStreamCalls[0]!;
    expect(promptText(first)).toContain("День 1 из 3. Сейчас 15:00 (Москва).");
    expect(systemOf(first)).not.toContain("День 1");

    clockAt(msk(14, 9));
    await tick(chat, id);
    clockAt(msk(15, 9));
    await tick(chat, id);
    clockAt(msk(15, 14, 20));
    await human(chat, id, "Готов");
    const last = chat.model.doStreamCalls.at(-1)!;
    expect(promptText(last)).toContain("День 3 из 3 — сегодня последний день. Сейчас 14:20 (Москва).");
    expect(systemOf(last)).toBe(systemOf(first));
  });

  it("вечер позднего старта: первый день завтра; без срока — «День N.»", async () => {
    const { chat } = await startedAt(msk(13, 20, 30));
    expect(promptText(chat.model.doStreamCalls[0]!)).toContain("Первый день начнётся завтра в 09:00. Сейчас 20:30 (Москва).");

    const open = daysChat({ edit: (json) => (threeDays(json), delete json.schedule.lengthDays, delete json.schedule.deadlineState) });
    await startedAt(msk(13, 15), open);
    expect(promptText(open.model.doStreamCalls[0]!)).toContain("День 1. Сейчас 15:00 (Москва).");
  });

  it("readRun и onTransition отдают день сценария", async () => {
    const { chat, id } = await startedAt(msk(13, 15));
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ day: { day: 1, totalDays: 3, isLastDay: false, nextDayStartAt: msk(14, 9) } });
    clockAt(msk(14, 9));
    await tick(chat, id);
    expect(chat.transitions.at(-1)).toMatchObject({ to: "block", day: { day: 2, totalDays: 3 } });
  });
});

describe("T406: перемотка тестового чата до начала следующего дня", () => {
  it("to: next_day_start — часы чата на 9:00 завтра, таймер срабатывает, ответ уже записан", async () => {
    const chat = daysChat();
    clockAt(msk(13, 15));
    const { id } = await chat.service.createChat(OWNER, { data: flowTestChatData() });
    await human(chat, id, "Курс по акварели");

    const result = await chat.flow.advanceTestClock({ ownerId: OWNER, chatId: id, to: "next_day_start" });
    expect(result).toEqual({ timeOffset: msk(14, 9) - msk(13, 15) });
    expect(await stateOfChat(chat.service, id)).toBe("block");
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(await agentTexts(chat.service, id)).toHaveLength(2);
  });

  it("сценарий без «Дней и времени» — ошибка", async () => {
    const chat = daysChat({ edit: () => {} });
    const { id } = await chat.service.createChat(OWNER, { data: flowTestChatData() });
    await human(chat, id, "привет");
    await expect(chat.flow.advanceTestClock({ ownerId: OWNER, chatId: id, to: "next_day_start" })).rejects.toThrow(/Дни и время/);
  });
});
