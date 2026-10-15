import { tool, type ToolSet } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callTool, saying, userMessage, waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { readAll } from "../../../core/tests/unit/support/mock-model";
import { HOUR } from "../flow-fixtures";
import { memoryFlowStore } from "../../src/store/memory";
import type { FlowStore } from "../../src/store/flow-store";
import { flowChat, newChat, OWNER, runOf, say, stateOf, systemOf, toolOutput, userTexts } from "./flow-chat";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

const claim = (exit: number, id = "x1") => callTool("flow_exit", id, { exit, why: "человек всё рассказал" });

describe("T041 withChat: подключение сценария к службе чата", () => {
  it("первый ход закрепляет чат за версией; дальше сценарий не загружается", async () => {
    const chat = flowChat();
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();
    await say(chat.service, id, "ещё");
    await chat.flow.settled();

    expect(chat.loadFlow).toHaveBeenCalledTimes(1);
    expect(await chat.store.getChat(id)).toMatchObject({ ownerId: OWNER, flowId: "sales-review", versionId: "v1", stateId: "intro" });
    expect(await chat.store.getVersion("sales-review", "v1")).toMatchObject({ flow: { id: "sales-review" } });
    expect(await runOf(chat.service, id)).toMatchObject({ state: "intro", path: [{ state: "intro", decidedBy: "start" }] });
  });

  it("инструкция приложения чата + правила сценария + «Общее»; блок flow:state с целью и пронумерованными условиями", async () => {
    const chat = flowChat({ chatInstructions: async () => "Ты помощник школы." });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    const [call] = chat.model.doStreamCalls;
    expect(systemOf(call!)).toContain("Ты помощник школы.");
    expect(systemOf(call!)).toContain("Ты — помощник Анны Петровой");
    expect(userTexts(call!)).toContain("Понять тему курса, аудиторию и текущие продажи.");
    expect(userTexts(call!)).toContain("1. Понятны тема курса и продажи");
  });

  it("чат без сценария идёт как раньше: инструкция приложения, без блока состояния", async () => {
    const chat = flowChat({ flowJson: null, scripts: [claim(1)] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    const [first, second] = chat.model.doStreamCalls;
    expect(systemOf(first!)).toContain("Ты помощник.");
    expect(systemOf(first!)).not.toContain("flow_exit");
    expect(userTexts(first!)).not.toContain("flow:state");
    expect(toolOutput(second!, "x1")).toContain("нет сценария");
    expect(await chat.store.getChat(id)).toBeNull();
    expect(await runOf(chat.service, id)).toBeUndefined();
  });

  it("сценарий с ошибками не запускается: строка в журнал, чат без сценария", async () => {
    const chat = flowChat({ edit: (json) => (json.start = null) });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    expect(await chat.store.getChat(id)).toBeNull();
    expect(chat.logError).toHaveBeenCalledWith(expect.stringContaining("sales-review"));
  });
});

describe("T042 flow_exit: заявка агента и судья", () => {
  it("подтверждено — переход, в результате карточка нового состояния и точный первый текст", async () => {
    const chat = flowChat({
      yes: ["intro_clear"],
      edit: (json) => (stateOf(json, "block").firstMessage = "Давайте найдём, что мешает продажам."),
      scripts: [claim(1), saying("Давайте найдём, что мешает продажам.")],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel, продаж нет");
    await chat.flow.settled();

    const output = toolOutput(chat.model.doStreamCalls[1]!, "x1");
    expect(output).toContain("Поиск затыка");
    expect(output).toContain("скажи ровно это: «Давайте найдём, что мешает продажам.»");
    expect(chat.judge.checkClaim).toHaveBeenCalledWith(
      expect.objectContaining({ exitId: "intro_clear", condition: "Понятны тема курса и продажи", why: "человек всё рассказал" }),
    );
    const run = await runOf(chat.service, id);
    expect(run?.state).toBe("block");
    expect(run?.path.at(-1)).toMatchObject({ state: "block", decidedBy: "claim", probability: 0.9 });
    expect(await chat.store.getChat(id)).toMatchObject({ stateId: "block" });
    // Переход был в ответе — судья после хода не зовётся.
    expect(chat.judge.checkAll).not.toHaveBeenCalled();
  });

  it("номер не из карточки — «нет такого условия», судья не зовётся", async () => {
    const chat = flowChat({ scripts: [claim(7)] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    expect(toolOutput(chat.model.doStreamCalls[1]!, "x1")).toContain("Нет такого условия");
    expect(chat.judge.checkClaim).not.toHaveBeenCalled();
    expect((await runOf(chat.service, id))?.state).toBe("intro");
  });

  it("не подтверждено — «продолжай разговор»; повторная заявка до ответа человека — «уже проверяли»", async () => {
    const chat = flowChat({ scripts: [claim(1, "x1"), claim(1, "x2")] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    expect(toolOutput(chat.model.doStreamCalls[1]!, "x1")).toContain("не подтвердил");
    expect(toolOutput(chat.model.doStreamCalls[2]!, "x2")).toContain("уже проверяли");
    expect(chat.judge.checkClaim).toHaveBeenCalledTimes(1);
    expect((await runOf(chat.service, id))?.state).toBe("intro");
  });

  it("судья не ответил — переход не сделан, агент продолжает", async () => {
    const chat = flowChat({ scripts: [claim(1)] });
    chat.judge.checkClaim.mockResolvedValue(null);
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    expect(toolOutput(chat.model.doStreamCalls[1]!, "x1")).toContain("Проверка не удалась");
    expect((await runOf(chat.service, id))?.state).toBe("intro");
  });
});

describe("T043 судья после хода", () => {
  it("переход без первого текста ждёт в pending с веткой и применяется в начале следующего хода", async () => {
    const chat = flowChat({ yes: ["intro_clear"] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel, продаж нет");
    await chat.flow.settled();

    expect(chat.judge.checkAll).toHaveBeenCalledWith(
      expect.objectContaining({ conditions: [{ exitId: "intro_clear", text: "Понятны тема курса и продажи" }], goal: "Понять тему курса, аудиторию и текущие продажи." }),
    );
    const record = await chat.store.getChat(id);
    expect(record?.pending).toEqual([expect.objectContaining({ kind: "transition", transition: expect.objectContaining({ to: "block", decidedBy: "judge" }) })]);
    const head = (await chat.service.getChatState(OWNER, id)).atMessageId;
    expect(record?.pending[0]).toMatchObject({ branchHead: head });
    // Чтение не снимает ожидание.
    expect((await chat.flow.readRun(OWNER, id))?.state).toBe("block");
    expect((await chat.store.getChat(id))?.pending).toHaveLength(1);

    chat.yes.clear();
    await say(chat.service, id, "да");
    const run = await runOf(chat.service, id);
    expect(run?.state).toBe("block");
    expect(run?.path.at(-1)).toMatchObject({ decidedBy: "judge", probability: 0.9 });
    expect(userTexts(chat.model.doStreamCalls[1]!)).toContain("Сработало");
    expect((await chat.store.getChat(id))?.pending).toEqual([]);
  });

  it("у цели есть точный первый текст — он приходит сразу через deliverNotices без вызова модели", async () => {
    const chat = flowChat({ yes: ["intro_clear"], edit: (json) => (stateOf(json, "block").firstMessage = "Давайте найдём затык.") });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel, продаж нет");
    await chat.flow.settled();
    await waitTurn(chat.service, id);

    expect(chat.model.doStreamCalls).toHaveLength(1);
    const { messages } = await chat.service.getHistory(OWNER, id);
    expect(JSON.stringify(messages.at(-1)?.parts)).toContain("Давайте найдём затык.");
    expect((await runOf(chat.service, id))?.state).toBe("block");
  });

  it("правка старого сообщения снимает ожидающий переход", async () => {
    const chat = flowChat({ yes: ["intro_clear"] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel, продаж нет");
    await chat.flow.settled();
    expect((await chat.store.getChat(id))?.pending).toHaveLength(1);

    chat.yes.clear();
    const { messages } = await chat.service.getHistory(OWNER, id);
    const first = messages.find((message) => message.role === "user")!;
    await readAll(await chat.service.editMessage(OWNER, id, first.id, { id: "m-edit", role: "user", parts: [{ type: "text", text: "просто смотрю" }] }));

    expect((await runOf(chat.service, id))?.state).toBe("intro");
    expect((await chat.store.getChat(id))?.pending).toEqual([]);
  });
});

describe("092 судья после хода видит реплики только с входа в состояние", () => {
  it("вопрос из прошлого состояния не уходит судье нового: только реплики после входа и реплика агента перед ними", async () => {
    const chat = flowChat({ yes: ["intro_clear"] });
    const { id } = await newChat(chat.service);
    // «Публикация» Ольги: вопрос про адрес задан до входа в следующее состояние.
    await say(chat.service, id, "а адрес обязательно латиницей?");
    await chat.flow.settled();
    chat.yes.clear();
    // Переход судьи применяется в начале этого хода: сообщение — уже в новом состоянии.
    await say(chat.service, id, "тоже не открывается");
    await chat.flow.settled();
    await say(chat.service, id, "открылось, спасибо");
    await chat.flow.settled();

    expect((await runOf(chat.service, id))?.state).toBe("block");
    const asked = chat.judge.checkAll.mock.calls.at(-1)![0];
    expect(asked.conditions.map(({ exitId }) => exitId)).toEqual(["block_not_ready", "block_found"]);
    expect(asked.messages).toEqual([
      { role: "agent", text: "ответ 1" },
      { role: "human", text: "тоже не открывается" },
      { role: "agent", text: "ответ 2" },
      { role: "human", text: "открылось, спасибо" },
      { role: "agent", text: "ответ 3" },
    ]);
  });

  it("гонка: человек уже написал дальше, пока судья читал историю, — окно кончается ответом этого хода", async () => {
    const chat = flowChat({ yes: ["intro_clear"] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "а адрес обязательно латиницей?");
    await chat.flow.settled();
    chat.yes.clear();
    await say(chat.service, id, "тоже не открывается");
    await chat.flow.settled();
    // Ход кончился, человек уже написал следующее и пошёл новый ответ, а судья прошлого хода читает историю только сейчас.
    const peek = chat.service.peekHistory;
    chat.service.peekHistory = async (owner, chatId) => {
      const history = await peek(owner, chatId);
      const answerId = ((await chat.service.getChatState(owner, chatId)).values.flow as { answerId: string }).answerId;
      const shown = history.messages.some((message) => message.id === answerId)
        ? history.messages
        : [...history.messages, { id: answerId, role: "assistant" as const, parts: [{ type: "text" as const, text: "ответ 3" }] }];
      const later = [
        { id: "later-human", role: "user" as const, parts: [{ type: "text" as const, text: "уже следующее" }] },
        { id: "later-answer", role: "assistant" as const, parts: [{ type: "text" as const, text: "ответ 4" }] },
      ];
      return { ...history, messages: [...shown, ...later] };
    };
    await say(chat.service, id, "открылось, спасибо");
    await chat.flow.settled();

    expect(chat.judge.checkAll.mock.calls.at(-1)![0].messages.map(({ text }) => text)).toEqual(["ответ 1", "тоже не открывается", "ответ 2", "открылось, спасибо", "ответ 3"]);
  });

  it("сообщение человека, принятое мимо хода, — в окне: окно считается по истории ветки, а не по счётчику ходов", async () => {
    const chat = flowChat({ yes: ["intro_clear"] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "а адрес обязательно латиницей?");
    await chat.flow.settled();
    chat.yes.clear();
    await say(chat.service, id, "тоже не открывается");
    await chat.flow.settled();
    // Сообщение легло в ветку без хода (счётчик сообщений человека его не видел).
    const { messages } = await chat.service.getHistory(OWNER, id);
    await chat.storage.insertMessage({ id: "aside", chatId: id, parentId: messages.at(-1)!.id, role: "user", parts: [{ type: "text", text: "написала ещё в мессенджере" }], createdAt: new Date().toISOString() } as never);
    await say(chat.service, id, "открылось, спасибо");
    await chat.flow.settled();

    expect(chat.judge.checkAll.mock.calls.at(-1)![0].messages.map(({ text }) => text)).toEqual([
      "ответ 1",
      "тоже не открывается",
      "ответ 2",
      "написала ещё в мессенджере",
      "открылось, спасибо",
      "ответ 3",
    ]);
  });

  it("переходов ещё не было (или место записано до 0.62) — последние реплики, как раньше; ответ этого хода есть, хотя история его ещё прячет", async () => {
    // Судья после хода идёт в фоне: в стенде он читает историю, пока ход не закрыт, — ответа хода в ней ещё нет.
    const chat = flowChat();
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();
    await say(chat.service, id, "ещё");
    await chat.flow.settled();

    expect(chat.judge.checkAll.mock.calls.at(-1)![0].messages.map(({ text }) => text)).toEqual(["привет", "ответ 1", "ещё", "ответ 2"]);
  });
});

describe("T044 события и охрана инструментов", () => {
  it("тишина → «Напоминание», сообщение человека → «назад» в последнее основное состояние", async () => {
    const chat = flowChat();
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();

    vi.setSystemTime(new Date(Date.now() + 3 * HOUR + 1000));
    const delivered = await chat.service.deliverNotices({
      ownerId: OWNER,
      chatId: id,
      notices: [{ kind: "app", name: "flow_timer", title: "Сработал таймер", data: { exitId: "any_silence" } }],
      wakeAgent: true,
      deliveryKey: "timer-1",
    });
    expect(delivered.turnStarted).toBe(true);
    await waitTurn(chat.service, id);
    await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("remind");

    await say(chat.service, id, "я тут");
    const run = await runOf(chat.service, id);
    expect(run?.state).toBe("intro");
    expect(run?.path.map((entry) => entry.state)).toEqual(["intro", "remind", "intro"]);
  });

  it("инструмент не из состояния — «в этом состоянии недоступно», не исполняется", async () => {
    const execute = vi.fn(async () => "https://booking");
    const chat = flowChat({
      tools: { give_booking_link: tool({ description: "Ссылка на запись", inputSchema: z.object({}), execute }) },
      scripts: [callTool("give_booking_link", "t1")],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "дайте ссылку");

    expect(toolOutput(chat.model.doStreamCalls[1]!, "t1")).toContain("в этом состоянии недоступно");
    expect(execute).not.toHaveBeenCalled();
  });

  it("инструмента состояния нет в наборе модели хода — карточка его не называет", async () => {
    const chat = flowChat({
      withCatalog: true,
      edit: (json) => {
        json.tools.push("call_expert", "give_booking_link");
        stateOf(json, "intro").tools = ["call_expert", "give_booking_link"];
      },
      // Как `person_link_view` у модели, которая не может им пользоваться: набор без инструмента
      tools: (model): ToolSet => (model.providerId === "nowhere" ? { call_expert: tool({ description: "Позвать Анну", inputSchema: z.object({}), execute: async () => "ok" }) } : {}),
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    const texts = userTexts(chat.model.doStreamCalls[0]!);
    expect(texts).toContain("Понять тему курса");
    expect(texts).not.toContain("call_expert");
    expect(texts).not.toContain("give_booking_link");
  });

  it("инструмент состояния есть в наборе модели хода — карточка его называет", async () => {
    const chat = flowChat({
      withCatalog: true,
      edit: (json) => {
        json.tools.push("call_expert");
        stateOf(json, "intro").tools = ["call_expert"];
      },
      tools: (model) => ({ call_expert: tool({ description: `Позвать Анну (${model.providerId})`, inputSchema: z.object({}), execute: async () => "ok" }) }),
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");

    expect(userTexts(chat.model.doStreamCalls[0]!)).toContain("Инструменты этого состояния: call_expert.");
  });

  it("вызван инструмент — переход, в результате карточка нового состояния", async () => {
    const execute = vi.fn(async () => "Анна напишет вам");
    const chat = flowChat({
      edit: (json) => {
        const intro = stateOf(json, "intro");
        intro.tools = ["call_expert"];
        intro.exits.push({ id: "intro_expert", when: { type: "event", event: "tool", name: "call_expert" }, to: "soft" });
      },
      tools: { call_expert: tool({ description: "Позвать Анну", inputSchema: z.object({}), execute }) },
      scripts: [callTool("call_expert", "t1")],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "позовите Анну");

    const output = toolOutput(chat.model.doStreamCalls[1]!, "t1");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(output).toContain("Анна напишет вам");
    expect(output).toContain("Полезный совет и прощание");
    expect(await runOf(chat.service, id)).toMatchObject({ state: "soft", path: [{}, { decidedBy: "event" }] });
  });

  it("нажата кнопка виджета — переход в состоянии ответа", async () => {
    const chat = flowChat({
      agent: { widgets: { basic: ["ask_choice"] } },
      edit: (json) => stateOf(json, "intro").exits.push({ id: "intro_choice", when: { type: "event", event: "button", name: "ask_choice" }, to: "booked" }),
      scripts: [callTool("ask_choice", "w1", { question: "Записать?", options: ["Да", "Нет"] })],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.service.answerWidget({ chatId: id, ownerId: OWNER, toolCallId: "w1", answer: { выбрано: "Да" } });
    await waitTurn(chat.service, id);
    await chat.flow.settled();

    expect(await runOf(chat.service, id)).toMatchObject({ state: "booked", path: [{}, { decidedBy: "event" }] });
  });
});

describe("T045 onTransition, история, readRun, signal", () => {
  it("onTransition получает переход с метками; ошибка приложения не ломает ход", async () => {
    const onTransition = vi.fn(async () => {
      throw new Error("почта упала");
    });
    const chat = flowChat({
      yes: ["intro_clear"],
      onTransition,
      edit: (json) => (stateOf(json, "block").tags = ["воронка"]),
      scripts: [claim(1), saying("Ищем затык.")],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel");
    await chat.flow.settled();

    expect(onTransition).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER, chatId: id, flowId: "sales-review", versionId: "v1", from: "intro", to: "block", tags: ["воронка"], decidedBy: "claim" }),
    );
    expect(chat.logError).toHaveBeenCalledWith(expect.stringContaining("почта упала"));
    expect((await runOf(chat.service, id))?.path.at(-1)).toMatchObject({ state: "block", tags: ["воронка"] });
  });

  it("readRun: null у чата без сценария", async () => {
    const chat = flowChat({ flowJson: null });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    expect(await chat.flow.readRun(OWNER, id)).toBeNull();
  });

  it("signal без «будить»: агент не просыпается, переход — в начале следующего хода", async () => {
    const chat = flowChat({
      edit: (json) => stateOf(json, "intro").exits.push({ id: "intro_paid", when: { type: "event", event: "app", name: "paid" }, to: "booked" }),
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();

    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid" });
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect((await chat.flow.readRun(OWNER, id))?.state).toBe("booked");

    await say(chat.service, id, "оплатил");
    expect(await runOf(chat.service, id)).toMatchObject({ state: "booked", path: [{}, { exitId: "intro_paid", decidedBy: "event" }] });
  });
});

type RunCounters = { humanMessages: number; lastHumanAt: number | null; state: string; path: Array<{ state: string }> };
const countersOf = async (service: Parameters<typeof runOf>[0], chatId: string) => (await runOf(service, chatId)) as unknown as RunCounters;
const lastAnswerId = async (service: Parameters<typeof runOf>[0], chatId: string) => {
  const { messages } = await service.peekHistory(OWNER, chatId);
  return messages.findLast((message) => message.role === "assistant")!.id;
};

describe("ревью Б1: «Перегенерировать» и «Повторить» учитывают сообщение человека", () => {
  it("перегенерация не меняет счётчик сообщений человека и время его последнего сообщения", async () => {
    const chat = flowChat();
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();
    const before = await countersOf(chat.service, id);
    expect(before).toMatchObject({ humanMessages: 1, lastHumanAt: Date.now() });

    await readAll(await chat.service.regenerate(OWNER, id, await lastAnswerId(chat.service, id)));
    await chat.flow.settled();
    expect(await countersOf(chat.service, id)).toMatchObject({ humanMessages: 1, lastHumanAt: before.lastHumanAt });
  });

  it("перегенерация ответа на «я тут» после напоминания — снова «назад» в основное состояние", async () => {
    const chat = flowChat();
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();
    vi.setSystemTime(new Date(Date.now() + 3 * HOUR + 1000));
    await chat.service.deliverNotices({
      ownerId: OWNER,
      chatId: id,
      notices: [{ kind: "app", name: "flow_timer", title: "Сработал таймер", data: { exitId: "any_silence" } }],
      wakeAgent: true,
      deliveryKey: "timer-1",
    });
    await waitTurn(chat.service, id);
    await chat.flow.settled();
    await say(chat.service, id, "я тут");
    await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro");

    await readAll(await chat.service.regenerate(OWNER, id, await lastAnswerId(chat.service, id)));
    await chat.flow.settled();
    const run = await countersOf(chat.service, id);
    expect(run.state).toBe("intro");
    expect(run.path.map((entry) => entry.state)).toEqual(["intro", "remind", "intro"]);
    expect(run.humanMessages).toBe(2);
  });

  it("«Повторить» пустой ответ — сообщение человека учтено один раз", async () => {
    const empty = [{ type: "stream-start" as const, warnings: [] }, { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } }];
    const chat = flowChat({ scripts: [empty] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();

    await readAll(await chat.service.retry(OWNER, id));
    await chat.flow.settled();
    expect(await countersOf(chat.service, id)).toMatchObject({ humanMessages: 1, state: "intro" });
  });
});

const appStateKeys = (parts: ReadonlyArray<{ type: string; data?: unknown }>) =>
  parts.flatMap((part) => (part.type === "data-app-state" ? Object.keys(((part.data ?? {}) as { set?: object }).set ?? {}) : []));

describe("ревью Б2: состояние сценария посетителю не видно", () => {
  it("ни в потоке хода, ни в истории нет ключа flow; сервер и readRun его видят", async () => {
    const chat = flowChat();
    const { id } = await newChat(chat.service);
    const chunks = (await say(chat.service, id, "привет")) as Array<{ type: string; data?: unknown }>;
    await chat.flow.settled();

    expect(appStateKeys(chunks)).not.toContain("flow");
    const { messages } = await chat.service.getHistory(OWNER, id);
    expect(messages.flatMap((message) => appStateKeys(message.parts as never))).not.toContain("flow");
    expect((await runOf(chat.service, id))?.state).toBe("intro");
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ state: "intro" });
  });

  it("закрытые ключи приложения остаются закрытыми рядом с ключом сценария", async () => {
    const chat = flowChat({
      chatOptions: { privateStateKeys: ["booking"] },
      agent: { prepareTurn: async () => ({ set: { booking: 42, visible: 1 } }) },
    });
    const { id } = await newChat(chat.service);
    const chunks = (await say(chat.service, id, "привет")) as Array<{ type: string; data?: unknown }>;
    expect(appStateKeys(chunks)).toEqual(["visible"]);
  });
});

describe("ревью С3: в групповых чатах сценарий выключен", () => {
  it("групповой ход: чат не закреплён, нет блока состояния, правил сценария и его инструментов", async () => {
    const chat = flowChat();
    const { id } = await newChat(chat.service);
    await readAll(await chat.service.sendMessage(OWNER, id, userMessage("g1", "всем привет"), { group: { allowedTools: [], author: "Борис" } }));
    await chat.flow.settled();

    const [call] = chat.model.doStreamCalls;
    expect(userTexts(call!)).not.toContain("flow:state");
    expect(systemOf(call!)).not.toContain("flow_exit");
    expect((call!.tools ?? []).map((item) => item.name)).not.toContain("flow_exit");
    expect(await chat.store.getChat(id)).toBeNull();
    expect(await runOf(chat.service, id)).toBeUndefined();
    expect(chat.loadFlow).not.toHaveBeenCalled();
  });
});

describe("ревью С4: ожидающие переходы не теряются при сбое подготовки хода", () => {
  it("подготовка упала после того, как взяла ожидающее, — оно возвращается и применяется следующим ходом", async () => {
    const store = memoryFlowStore();
    let failCard = false;
    const failing: FlowStore = {
      ...store,
      readCard: async (ownerId) => {
        if (failCard) {
          failCard = false;
          throw new Error("база карточек недоступна");
        }
        return store.readCard(ownerId);
      },
    };
    const chat = flowChat({
      store: failing,
      edit: (json) => stateOf(json, "intro").exits.push({ id: "intro_paid", when: { type: "event", event: "app", name: "paid" }, to: "booked" }),
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();
    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid" });

    failCard = true;
    await say(chat.service, id, "оплатил");
    await chat.flow.settled();
    expect((await chat.store.getChat(id))?.pending).toEqual([expect.objectContaining({ kind: "event", name: "paid" })]);

    await say(chat.service, id, "ну что?");
    expect(await runOf(chat.service, id)).toMatchObject({ state: "booked", path: [{}, { exitId: "intro_paid" }] });
  });

  it("подготовку отменили (срок, «Стоп») — ожидающее возвращается", async () => {
    const store = memoryFlowStore();
    let release: () => void = () => {};
    let hold = false;
    const slow: FlowStore = {
      ...store,
      readCard: async (ownerId) => {
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        return store.readCard(ownerId);
      },
    };
    const chat = flowChat({
      store: slow,
      edit: (json) => stateOf(json, "intro").exits.push({ id: "intro_paid", when: { type: "event", event: "app", name: "paid" }, to: "booked" }),
    });
    const target = await newChat(chat.service);
    const { id } = target;
    await say(chat.service, id, "привет");
    await chat.flow.settled();
    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid" });

    hold = true;
    const controller = new AbortController();
    const { values } = await chat.service.getChatState(OWNER, id);
    const preparing = chat.options.agent.prepareTurn!({
      ownerId: OWNER,
      chatId: id,
      messageId: "a-next",
      chat: target,
      state: values,
      action: "send",
      notices: [],
      timeZone: "Europe/Moscow",
      audience: "private",
      resumed: false,
      abortSignal: controller.signal,
      now: new Date(),
    });
    await vi.waitFor(async () => expect((await chat.store.getChat(id))?.pending).toEqual([]));
    controller.abort(new Error("срок"));
    await vi.waitFor(async () => expect((await chat.store.getChat(id))?.pending).toHaveLength(1));
    hold = false;
    release();
    await preparing;
    expect((await chat.store.getChat(id))?.pending).toEqual([expect.objectContaining({ kind: "event", name: "paid" })]);
  });
});

describe("ревью М4: слияние подготовки приложения и сценария", () => {
  it("unset приложения не теряется, записи приложения и сценария ложатся вместе", async () => {
    const chat = flowChat({
      agent: {
        prepareTurn: async ({ state }) => (state.draft === undefined ? { set: { draft: "черновик" } } : { set: { seen: true }, unset: ["draft"] }),
      },
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    expect((await chat.service.getChatState(OWNER, id)).values).toMatchObject({ draft: "черновик", flow: { state: "intro" } });

    await say(chat.service, id, "ещё");
    const { values } = await chat.service.getChatState(OWNER, id);
    expect(values.draft).toBeUndefined();
    expect(values).toMatchObject({ seen: true, flow: { state: "intro", humanMessages: 2 } });
  });

  it("приложение стирает ключ сценария — запись сценария всё равно ложится", async () => {
    const chat = flowChat({ agent: { prepareTurn: async () => ({ unset: ["flow"] }) } });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await say(chat.service, id, "ещё");
    expect(await runOf(chat.service, id)).toMatchObject({ state: "intro", humanMessages: 2 });
  });
});
