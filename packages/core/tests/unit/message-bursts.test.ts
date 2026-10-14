import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatBusyError, DEFAULT_BURST_QUIET_MS, isBurstMessage } from "../../src/index";
import type { BeforeTurnHandler, PrepareTurn, TurnNotStartedHandler } from "../../src/index";
import { UNANSWERED_NOTE } from "../../src/agent-run/unanswered-messages";
import { createChatEvents } from "../../src/chat-events/chat-events";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { generateResult, readAll, streamOf } from "./support/mock-model";
import { doneNotice, lastUserTexts, noticeService, saying, scriptedModel, textsOf, userMessage } from "./support/notice-chat";

// Склейка пачки: человек пишет несколько сообщений подряд — агент отвечает одним ходом, когда человек замолчал.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

const QUIET = DEFAULT_BURST_QUIET_MS;

/** Модель, чей первый ход ждёт `release()`: так видно, что приходит, пока агент отвечает. */
function heldModel() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const index = call++;
      if (index === 0) {
        await gate;
        return { stream: streamOf(saying("первый ответ")) };
      }
      return { stream: streamOf(saying(`ответ ${index + 1}`)) };
    },
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
  return { model, release };
}

/** Тексты всех сообщений запроса подряд — чтобы найти пометку «ответа нет». */
const promptTexts = (model: MockLanguageModelV4, index: number) =>
  model.doStreamCalls[index]!.prompt.flatMap((message) =>
    typeof message.content === "string" ? [message.content] : (message.content as Array<{ type: string; text?: string }>).map((part) => part.text ?? ""),
  );

describe("sendBurstMessage: пачка сообщений — один ход", () => {
  it("три сообщения за секунды: один ход после тишины; в истории три сообщения, модель видит одно", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");

    const first = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(1000);
    const second = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "у меня вопрос"));
    await vi.advanceTimersByTimeAsync(1000);
    const third = await service.sendBurstMessage("anna", chat.id, userMessage("u3", "вот ссылка"));
    expect([first.messageId, second.messageId, third.messageId]).toEqual(["u1", "u2", "u3"]);

    // Окно тишины считается от последнего сообщения.
    await vi.advanceTimersByTimeAsync(QUIET - 1);
    expect(model.doStreamCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(await first.turn).toBeNull();
    expect(await second.turn).toBeNull();
    const stream = await third.turn;
    expect(stream).not.toBeNull();
    await readAll(stream!);

    expect(model.doStreamCalls).toHaveLength(1);
    expect(lastUserTexts(model.doStreamCalls[0]!).join("")).toMatch(/^привет\n\nу меня вопрос\n\nвот ссылка/);
    expect(promptTexts(model, 0)).not.toContain(UNANSWERED_NOTE);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => [message.id, message.role])).toEqual([
      ["u1", "user"],
      ["u2", "user"],
      ["u3", "user"],
      [expect.any(String), "assistant"],
    ]);
    // Отметка пачки служебная: на экране — только текст человека.
    expect(messages.slice(0, 3).every((message) => isBurstMessage(message))).toBe(true);
  });

  it("вызовы без ожидания друг друга: сообщения ложатся в порядке вызовов", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const results = await Promise.all(["раз", "два", "три"].map((text, index) => service.sendBurstMessage("anna", chat.id, userMessage(`u${index + 1}`, text))));
    await vi.advanceTimersByTimeAsync(QUIET);
    const streams = await Promise.all(results.map((result) => result.turn));
    expect(streams.filter(Boolean)).toHaveLength(1);
    await readAll(streams[2]!);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.id).slice(0, 3)).toEqual(["u1", "u2", "u3"]);
    expect(lastUserTexts(model.doStreamCalls[0]!).join("")).toMatch(/^раз\n\nдва\n\nтри/);
  });

  it("окно задаётся вызовом: quietMs 0 — ход сразу", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), { quietMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await readAll((await sent.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("неверное окно — ошибка до записи", async () => {
    const { service, storage } = noticeService(scriptedModel());
    const chat = await service.createChat("anna");
    await expect(service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), { quietMs: -1 })).rejects.toThrow(TypeError);
    await expect(service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), { quietMs: 600_001 })).rejects.toThrow(TypeError);
    expect(await storage.listMessages(chat.id)).toEqual([]);
  });

  it("сообщения, пока агент отвечает: после хода — один ход на всё накопленное", async () => {
    const { model, release } = heldModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const firstTurn = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(QUIET);
    const firstStream = (await firstTurn.turn)!;
    expect(model.doStreamCalls).toHaveLength(1);

    // Пока идёт ответ, человек дописывает два сообщения: запись ждёт конца хода.
    const during = [service.sendBurstMessage("anna", chat.id, userMessage("u2", "ещё вопрос")), service.sendBurstMessage("anna", chat.id, userMessage("u3", "и ещё"))];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(model.doStreamCalls).toHaveLength(1);
    release();
    await readAll(firstStream);
    const [second, third] = await Promise.all(during);
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(await second!.turn).toBeNull();
    await readAll((await third!.turn)!);

    expect(model.doStreamCalls).toHaveLength(2);
    expect(lastUserTexts(model.doStreamCalls[1]!).join("")).toBe("ещё вопрос\n\nи ещё");
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "user", "assistant"]);
    // Прошлый ход остался как был: начало запроса то же — кэш модели цел.
    expect(model.doStreamCalls[1]!.prompt.slice(0, model.doStreamCalls[0]!.prompt.length - 1)).toEqual(model.doStreamCalls[0]!.prompt.slice(0, -1));
  });

  it("обычное сообщение посреди пачки отвечает само; пачка до него хода не начинает", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const burst = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "с сайта")));
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(await burst.turn).toBeNull();
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe("sendBurstMessage: ворота хода и сценарии", () => {
  it("beforeTurn и prepareTurn получают все сообщения пачки; turnNotStarted не зовётся", async () => {
    const beforeTurn = vi.fn<BeforeTurnHandler>();
    const turnNotStarted = vi.fn<TurnNotStartedHandler>();
    const prepareTurn = vi.fn<PrepareTurn>();
    const model = scriptedModel();
    const { service } = noticeService(model, { beforeTurn, turnNotStarted, agent: { prepareTurn } });
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    const last = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await last.turn)!);

    expect(beforeTurn).toHaveBeenCalledTimes(1);
    expect(beforeTurn.mock.calls[0]![0]).toMatchObject({ action: "send", messageId: "u2", text: "привет\n\nвопрос", burstMessageIds: ["u1", "u2"] });
    expect(prepareTurn.mock.calls[0]![0]).toMatchObject({ action: "send", burstMessageIds: ["u1", "u2"] });
    expect(turnNotStarted).not.toHaveBeenCalled();
  });

  it("пачка после прошлого ответа — только новые сообщения; старые в счёт не идут", async () => {
    const prepareTurn = vi.fn<PrepareTurn>();
    const { service } = noticeService(scriptedModel(), { agent: { prepareTurn } });
    const chat = await service.createChat("anna");
    const first = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await first.turn)!);
    const second = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "ещё"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await second.turn)!);
    expect(prepareTurn.mock.calls.map(([context]) => context.burstMessageIds)).toEqual([["u1"], ["u2"]]);
  });

  it("обычный ход (sendMessage) — без burstMessageIds", async () => {
    const prepareTurn = vi.fn<PrepareTurn>();
    const { service } = noticeService(scriptedModel(), { agent: { prepareTurn } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(prepareTurn.mock.calls[0]![0].burstMessageIds).toBeUndefined();
  });

  it("«записать и промолчать» на пачку: все сообщения записаны, модели нет, поток «ответ позже»", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model, { beforeTurn: () => ({ hold: true }) });
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    const last = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(await readAll((await last.turn)!)).toEqual([{ type: "data-turn-held", data: { messageId: "u2" }, transient: true }]);
    expect(model.doStreamCalls).toHaveLength(0);
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.id)).toEqual(["u1", "u2"]);
  });

  it("готовая фраза на пачку — один ответ без модели", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model, { beforeTurn: () => ({ reply: { text: "На сегодня всё" } }) });
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    const last = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await last.turn)!);
    expect(model.doStreamCalls).toHaveLength(0);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "user", "assistant"]);
  });

  it("отказ приложения — ошибка у хода последнего сообщения, сообщения записаны", async () => {
    const { service } = noticeService(scriptedModel(), { beforeTurn: () => ({ code: "nope", message: "Нельзя" }) });
    const chat = await service.createChat("anna");
    const last = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(last.turn).rejects.toMatchObject({ name: "TurnRefusedError" });
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it("служебное сообщение с ходом (касание сценария) не начинается, пока пачка ждёт; после хода — идёт", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    expect(await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Задача", "готово")], deliveryKey: "touch-0", wakeAgent: true })).toMatchObject({ status: "busy" });
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await sent.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Задача", "готово")], deliveryKey: "touch-1", wakeAgent: true })).toMatchObject({ status: "delivered", turnStarted: true });
  });

  it("служебное сообщение без хода (пауза сотрудника) ложится сразу; пачка всё равно отвечает", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    expect(await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Задача", "готово")], deliveryKey: "touch-2", wakeAgent: false })).toMatchObject({ status: "delivered" });
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await sent.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("другая копия сервера видит ждущую пачку в истории: касание тоже ждёт", async () => {
    const storage = createInMemoryChatStorage();
    const { service } = noticeService(scriptedModel(), { storage });
    const { service: other } = noticeService(scriptedModel(), { storage });
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    expect(await other.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Задача", "готово")], deliveryKey: "touch-3", wakeAgent: true })).toMatchObject({ status: "busy" });
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await sent.turn)!);
  });
});

describe("sendBurstMessage: долговечность", () => {
  it("сервер перезапустился посреди окна: повтор вызова с тем же id — ход будет, второй копии сообщения нет", async () => {
    const storage = createInMemoryChatStorage();
    const { service } = noticeService(scriptedModel(), { storage });
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    const dropped = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    // Остановка службы: ждущая пачка не отвечает здесь, вызывающий повторит.
    await service.flush();
    await expect(dropped.turn).rejects.toBeInstanceOf(ChatBusyError);

    const model = scriptedModel();
    const { service: restarted } = noticeService(model, { storage });
    const repeatedEarlier = await restarted.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    const repeatedLast = await restarted.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(await repeatedEarlier.turn).toBeNull();
    await readAll((await repeatedLast.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(lastUserTexts(model.doStreamCalls[0]!).join("")).toMatch(/^привет\n\nвопрос/);
    expect((await storage.listMessages(chat.id)).map((message) => message.id).slice(0, 2)).toEqual(["u1", "u2"]);
    expect(await storage.listMessages(chat.id)).toHaveLength(3);
  });

  it("повтор уже отвеченного сообщения — хода нет", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await sent.turn)!);
    const again = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(await again.turn).toBeNull();
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe("withBurstsJoined: модель видит пачку одним сообщением", () => {
  it("склеиваются только сообщения одной пачки: отложенное без ответа и новое через минуту — два сообщения, как и в счёте хода", async () => {
    const model = scriptedModel();
    const ids: (readonly string[] | undefined)[] = [];
    let held = false;
    const beforeTurn: BeforeTurnHandler = async (input) => {
      ids.push(input.burstMessageIds);
      if (held) return undefined;
      held = true;
      return { hold: true };
    };
    const { service } = noticeService(model, { beforeTurn });
    const chat = await service.createChat("anna");
    const first = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "ночное"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await first.turn;
    await vi.advanceTimersByTimeAsync(60_000);
    const second = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "утреннее"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await second.turn)!);
    expect(ids.at(-1)).toEqual(["u2"]);
    const userTexts = model.doStreamCalls[0]!.prompt.filter((message) => message.role === "user").map((message) => textsOf(message).join(""));
    expect(userTexts).toHaveLength(2);
    expect(userTexts[0]).toContain("ночное");
    expect(userTexts[0]).not.toContain("утреннее");
  });

  it("правка сообщения пачки сохраняет отметку: правленое остаётся в своей пачке", async () => {
    const model = scriptedModel();
    const { service, storage } = noticeService(model);
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(1000);
    const last = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await last.turn)!);
    await vi.advanceTimersByTimeAsync(60_000);
    await readAll(await service.editMessage("anna", chat.id, "u2", userMessage("u2-edit", "вопрос точнее")));
    expect(isBurstMessage((await storage.getMessage("u2-edit"))!)).toBe(true);
    expect(lastUserTexts(model.doStreamCalls.at(-1)!).join("")).toMatch(/^привет\n\nвопрос точнее/);
  });

  it("пачка без ответа после обрыва остаётся склеенной и на следующем ходе — байты прежние", async () => {
    const parts: LanguageModelV4StreamPart[][] = [];
    const model = scriptedModel(parts);
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    const last = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await last.turn)!);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "дальше")));
    const firstPrompt = model.doStreamCalls[0]!.prompt;
    const secondPrompt = model.doStreamCalls[1]!.prompt;
    expect(secondPrompt.slice(0, firstPrompt.length - 1)).toEqual(firstPrompt.slice(0, -1));
    expect(secondPrompt.filter((message) => message.role === "user")).toHaveLength(2);
  });
});

describe("sendBurstMessage: «Стоп» во время окна тишины", () => {
  it("«Стоп» отменяет ждущую пачку: хода нет, сообщения в истории, вызовы пачки — null сразу", async () => {
    const model = scriptedModel();
    const { service, storage } = noticeService(model);
    const chat = await service.createChat("anna");
    const first = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(1000);
    const second = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));

    expect(await service.stop("anna", chat.id)).toBe(true);
    expect(await second.turn).toBeNull();
    expect(await first.turn).toBeNull();
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(model.doStreamCalls).toHaveLength(0);
    const stored = await storage.listMessages(chat.id);
    expect(stored.map((message) => [message.id, message.role])).toEqual([
      ["u1", "user"],
      ["u2", "user"],
      [expect.any(String), "assistant"],
    ]);
    expect(stored.at(-1)).toMatchObject({ status: "stopped", parts: [] });
  });

  it("после «Стоп» человек пишет снова — ход на новое, модель видит и отменённые сообщения; повтор отменённого — без хода", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await service.stop("anna", chat.id);
    const repeated = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(await repeated.turn).toBeNull();

    const next = await service.sendBurstMessage("anna", chat.id, userMessage("u3", "передумал, вот вопрос"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await next.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(lastUserTexts(model.doStreamCalls[0]!).join("")).toMatch(/^привет\n\nпередумал, вот вопрос/);
  });

  it("«Повторить» после «Стоп» — ход на отменённую пачку целиком", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));
    await service.stop("anna", chat.id);
    await readAll(await service.retry("anna", chat.id));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(lastUserTexts(model.doStreamCalls[0]!).join("")).toMatch(/^привет\n\nвопрос/);
  });

  it("«Стоп» на другой копии сервера: по истории пачка не отвечает и там, где ждёт окно", async () => {
    const storage = createInMemoryChatStorage();
    const model = scriptedModel();
    const { service } = noticeService(model, { storage });
    const { service: other } = noticeService(scriptedModel(), { storage });
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    expect(await other.stop("anna", chat.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(await sent.turn).toBeNull();
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("без ждущей пачки «Стоп» — как раньше: false, ничего не пишется; отвеченная пачка не трогается", async () => {
    const { service, storage } = noticeService(scriptedModel());
    const chat = await service.createChat("anna");
    expect(await service.stop("anna", chat.id)).toBe(false);
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(QUIET);
    await readAll((await sent.turn)!);
    expect(await service.stop("anna", chat.id)).toBe(false);
    expect(await storage.listMessages(chat.id)).toHaveLength(2);
  });
});

describe("sendBurstMessage: событие для открытой вкладки", () => {
  it("записанное сообщение пачки — message-added сразу, до хода; повтор того же id — без события; «Стоп» — тоже событие", async () => {
    const chatEvents = createChatEvents();
    const events: ChatEvent[] = [];
    chatEvents.subscribe((event) => events.push(event));
    const { service } = noticeService(scriptedModel(), { chatEvents });
    const chat = await service.createChat("anna");
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    expect(events).toEqual([{ type: "message-added", ownerId: "anna", chatId: chat.id, messageId: "u1" }]);
    await service.stop("anna", chat.id);
    expect(events.at(-1)).toEqual({ type: "message-added", ownerId: "anna", chatId: chat.id, messageId: expect.any(String) });
    expect(events).toHaveLength(2);
  });
});
