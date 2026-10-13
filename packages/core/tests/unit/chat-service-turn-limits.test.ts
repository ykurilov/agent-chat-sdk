import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatService, ChatServiceOptions } from "../../src/chat-service";
import type { StoredMessage } from "../../src/conversation/types";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import { TooManyTurnsError } from "../../src/running-answers/turn-slots";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { AfterTurnHandler, BeforeTurnHandler, TurnNotStartedHandler } from "../../src/turn-hooks/turn-hooks";
import { doneNotice } from "./support/notice-chat";
import { controlledModel, finishPart, mockCatalog, mockEnv, mockModel, mockModelId, mockUsage, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const userMessage = (id: string, text = "Привет") => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const delta = (text: string): LanguageModelV4StreamPart => ({ type: "text-delta", id: "txt-0", delta: text });
const lengthFinish: LanguageModelV4StreamPart = { type: "finish", finishReason: { unified: "length", raw: "max_tokens" }, usage: mockUsage };
const answering = () => mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), finishPart()]));

/** Хранилище, которое можно закрыть, как базу при остановке сервера: после `close` любой вызов падает. */
function closableStorage(): ChatStorage & { close(): void } {
  const inner = createInMemoryChatStorage();
  let closed = false;
  const storage = new Proxy(inner, {
    get(target, key, receiver) {
      if (key === "close") return () => (closed = true);
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (closed) return Promise.reject(new Error("The database connection is not open"));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return storage as ChatStorage & { close(): void };
}

function setup(extra: Partial<ChatServiceOptions> & { model?: ReturnType<typeof mockModel> } = {}) {
  const { model = answering(), agent, ...options } = extra;
  const storage = options.storage ?? createInMemoryChatStorage();
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...agent },
    env: mockEnv,
    logError,
    ...options,
  });
  return { storage, service, model, logError };
}

async function lastAnswer(storage: ChatStorage, chatId: string): Promise<StoredMessage> {
  return (await storage.listMessages(chatId)).filter((message) => message.role === "assistant").at(-1)!;
}

/** Ход, чей поток держит тест: модель открыла поток и написала «Начало». Чтение — в обёртке, чтобы `await` не ждал конца хода. */
async function heldTurn(service: ChatService, source: ReturnType<typeof controlledModel>, chatId: string, id = "u1") {
  const reading = readAll(await service.sendMessage("anna", chatId, userMessage(id)));
  await source.opened;
  source.push(streamStart, { type: "text-start", id: "txt-0" }, delta("Начало"));
  await vi.advanceTimersByTimeAsync(0);
  return { reading };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("общий срок хода (agent.turnTimeoutMs)", () => {
  it("срок вышел: ход остановлен как «Стоп», написанное цело, afterTurn видит stopReason: timeout, чат свободен", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service, storage } = setup({ model: source.model, agent: { instructions: "Ты помощник.", turnTimeoutMs: 90_000 }, afterTurn });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    await vi.advanceTimersByTimeAsync(89_000);
    expect((await service.getHistory("anna", chat.id)).running).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const chunks = await reading;

    expect(chunks.at(-1)?.type).toBe("abort");
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "stopped", parts: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Начало" })]) });
    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "stopped", stopReason: "timeout", text: "Начало" });
    expect((await service.getHistory("anna", chat.id)).running).toBe(false);
  });

  it("«Стоп» человека — stopReason: user; ход, уложившийся в срок, причины остановки не несёт", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service } = setup({ model: source.model, agent: { instructions: "Ты помощник.", turnTimeoutMs: 90_000 }, afterTurn });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);
    await service.stop("anna", chat.id);
    await reading;
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "stopped", stopReason: "user" });

    const quickHook = vi.fn<AfterTurnHandler>();
    const quick = setup({ agent: { instructions: "Ты помощник.", turnTimeoutMs: 90_000 }, afterTurn: quickHook });
    const other = await quick.service.createChat("anna");
    await readAll(await quick.service.sendMessage("anna", other.id, userMessage("u1")));
    expect(quickHook.mock.calls[0]![0]).toMatchObject({ status: "complete" });
    expect(quickHook.mock.calls[0]![0]).not.toHaveProperty("stopReason");
  });

  it("срок не режет afterTurn записанного ответа: ход ждёт хук и его события", async () => {
    vi.useFakeTimers();
    const afterTurn = vi.fn<AfterTurnHandler>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { events: [{ type: "lesson.saved", data: { ok: true } }] };
    });
    const { service } = setup({ agent: { instructions: "Ты помощник.", turnTimeoutMs: 2_000 }, afterTurn });
    const chat = await service.createChat("anna");
    let read = false;
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1"))).then((chunks) => ((read = true), chunks));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(read).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    const chunks = await reading;
    expect(JSON.stringify(chunks)).toContain("lesson.saved");
    expect(chunks.at(-1)?.type).toBe("finish");
  });

  it("срок, вышедший во время повторов конечной записи, не обрывает afterTurn записанного ответа", async () => {
    vi.useFakeTimers();
    const inner = createInMemoryChatStorage();
    let finishCalls = 0;
    const storage = new Proxy(inner, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key === "finishMessage") {
          return (...args: unknown[]) => (++finishCalls <= 2 ? Promise.reject(new Error("база моргнула")) : value.apply(target, args));
        }
        return value;
      },
    });
    const afterTurn = vi.fn<AfterTurnHandler>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { events: [{ type: "lesson.saved", data: { ok: true } }] };
    });
    const { service } = setup({ storage, agent: { instructions: "Ты помощник.", turnTimeoutMs: 2_000 }, afterTurn });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));

    await vi.advanceTimersByTimeAsync(20_000);
    const chunks = await reading;
    expect(finishCalls).toBe(3);
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "complete" });
    expect(JSON.stringify(chunks)).toContain("lesson.saved");
  });

  it("срок по модели: byModel важнее default, 0 — без срока", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const { service, storage } = setup({
      model: source.model,
      agent: { instructions: "Ты помощник.", turnTimeoutMs: { default: 5_000, byModel: { [mockModelId]: 0 } } },
    });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await lastAnswer(storage, chat.id)).status).toBe("streaming");
    source.push({ type: "text-end", id: "txt-0" }, finishPart());
    source.end();
    await reading;
    expect((await lastAnswer(storage, chat.id)).status).toBe("complete");
  });

  it("неверный срок или незнакомая модель — ошибка при создании службы", () => {
    expect(() => setup({ agent: { instructions: "x", turnTimeoutMs: 10 } })).toThrow(/turnTimeoutMs/);
    expect(() => setup({ agent: { instructions: "x", turnTimeoutMs: { byModel: { "нет-такой": 5_000 } } } })).toThrow(/нет-такой/);
  });
});

describe("предел токенов ответа (agent.maxOutputTokens)", () => {
  it("идёт в каждый запрос к модели; не задан — в запросе его нет", async () => {
    const limited = setup({ agent: { instructions: "Ты помощник.", maxOutputTokens: 2400 } });
    const chat = await limited.service.createChat("anna");
    await readAll(await limited.service.sendMessage("anna", chat.id, userMessage("u1")));
    expect(limited.model.doStreamCalls[0]!.maxOutputTokens).toBe(2400);

    const plain = setup();
    const other = await plain.service.createChat("anna");
    await readAll(await plain.service.sendMessage("anna", other.id, userMessage("u1")));
    expect(plain.model.doStreamCalls[0]!.maxOutputTokens).toBeUndefined();
  });

  it("предел по модели важнее общего", async () => {
    const { service, model } = setup({ agent: { instructions: "Ты помощник.", maxOutputTokens: { default: 2400, byModel: { [mockModelId]: 800 } } } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    expect(model.doStreamCalls[0]!.maxOutputTokens).toBe(800);
  });

  it("ответ упёрся в предел: afterTurn видит lengthCut", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Длинн"]), lengthFinish]));
    const { service } = setup({ model, agent: { instructions: "Ты помощник.", maxOutputTokens: 5 }, afterTurn });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "complete", lengthCut: true });

    const plainHook = vi.fn<AfterTurnHandler>();
    const plain = setup({ afterTurn: plainHook });
    const other = await plain.service.createChat("anna");
    await readAll(await plain.service.sendMessage("anna", other.id, userMessage("u1")));
    expect(plainHook.mock.calls[0]![0]).not.toHaveProperty("lengthCut");
    expect(plainHook.mock.calls[0]![0]).not.toHaveProperty("stopReason");
  });

  it("ход упёрся в предел шагов: afterTurn видит stepLimit, обычный ход — нет", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    let call = 0;
    const model = mockModel(() => {
      call += 1;
      return streamOf([streamStart, { type: "tool-call", toolCallId: `c${call}`, toolName: "lookup", input: "{}" }, finishPart("tool-calls")]);
    });
    const lookup = tool({ description: "Поиск", inputSchema: z.object({}), execute: async () => "нашёл" });
    const { service } = setup({ model, agent: { instructions: "Ты помощник.", maxSteps: 2, tools: { lookup } }, afterTurn });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "complete", stepLimit: true });
    expect(afterTurn.mock.calls[0]![0]).not.toHaveProperty("stopReason");

    const plainHook = vi.fn<AfterTurnHandler>();
    const plain = setup({ afterTurn: plainHook });
    const other = await plain.service.createChat("anna");
    await readAll(await plain.service.sendMessage("anna", other.id, userMessage("u1")));
    expect(plainHook.mock.calls[0]![0]).not.toHaveProperty("stepLimit");
  });

  it("неверный предел — ошибка при создании службы", () => {
    expect(() => setup({ agent: { instructions: "x", maxOutputTokens: 0 } })).toThrow(/maxOutputTokens/);
    expect(() => setup({ agent: { instructions: "x", maxOutputTokens: 1.5 } })).toThrow(/maxOutputTokens/);
  });
});

describe("ход не начался после beforeTurn (turnNotStarted)", () => {
  function hooks() {
    const beforeTurn = vi.fn<BeforeTurnHandler>();
    const turnNotStarted = vi.fn<TurnNotStartedHandler>();
    return { beforeTurn, turnNotStarted };
  }

  it("beforeTurn получает id сообщения человека; удачный ход turnNotStarted не зовёт", async () => {
    const { beforeTurn, turnNotStarted } = hooks();
    const { service } = setup({ beforeTurn, turnNotStarted });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    expect(beforeTurn.mock.calls[0]![0]).toMatchObject({ action: "send", messageId: "u1" });
    expect(turnNotStarted).not.toHaveBeenCalled();
  });

  it("повтор id сообщения: 409 как раньше, а приложение узнаёт duplicate_message с тем же messageId", async () => {
    const { beforeTurn, turnNotStarted } = hooks();
    const { service, model } = setup({ beforeTurn, turnNotStarted });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    await expect(service.sendMessage("anna", chat.id, userMessage("u1"))).rejects.toThrow();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(beforeTurn).toHaveBeenCalledTimes(2);
    expect(turnNotStarted).toHaveBeenCalledTimes(1);
    expect(turnNotStarted.mock.calls[0]![0]).toMatchObject({
      userId: "anna",
      chat: { id: chat.id },
      action: "send",
      messageId: "u1",
      reason: "duplicate_message",
    });
  });

  it("занятый чат, предел одновременных ходов и лимит расходов — свои причины", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const { beforeTurn, turnNotStarted } = hooks();
    let blocked = false;
    const { service } = setup({
      model: source.model,
      beforeTurn,
      turnNotStarted,
      maxConcurrentTurnsPerUser: 1,
      limits: {
        assertWithinLimit: async () => {
          if (blocked) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: "2099-02-01T00:00:00.000Z" });
        },
        status: async () => ({ state: "ok" }),
      },
    });
    const chat = await service.createChat("anna");
    const other = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    await expect(service.sendMessage("anna", chat.id, userMessage("u2"))).rejects.toBeInstanceOf(ChatBusyError);
    await expect(service.sendMessage("anna", other.id, userMessage("u3"))).rejects.toBeInstanceOf(TooManyTurnsError);
    blocked = true;
    await expect(service.sendMessage("anna", other.id, userMessage("u4"))).rejects.toBeInstanceOf(SpendingLimitReachedError);
    expect(turnNotStarted.mock.calls.map(([input]) => [input.messageId, input.reason])).toEqual([
      ["u2", "busy"],
      ["u3", "too_many_turns"],
      ["u4", "spending_limit"],
    ]);
    await service.stop("anna", chat.id);
    await reading;
  });

  it("служебное сообщение: лимит исчерпан — пишется без хода, приложение узнаёт spending_limit; пропуск с ходом — без turnNotStarted", async () => {
    const { beforeTurn, turnNotStarted } = hooks();
    let blocked = true;
    const { service, model } = setup({
      beforeTurn,
      turnNotStarted,
      limits: {
        assertWithinLimit: async () => {
          if (blocked) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: "2099-02-01T00:00:00.000Z" });
        },
        status: async () => ({ state: "ok" }),
      },
    });
    const chat = await service.createChat("anna");
    const notice = (deliveryKey: string) => ({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "ок")], wakeAgent: true, deliveryKey });

    expect(await service.deliverNotices(notice("k1"))).toMatchObject({ status: "delivered", turnStarted: false });
    expect(turnNotStarted).toHaveBeenCalledTimes(1);
    expect(turnNotStarted.mock.calls[0]![0]).toMatchObject({ action: "notice", reason: "spending_limit" });

    blocked = false;
    expect(await service.deliverNotices(notice("k2"))).toMatchObject({ status: "delivered", turnStarted: true });
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(false));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(turnNotStarted).toHaveBeenCalledTimes(1);
  });

  it("служебное сообщение с пробуждением зовёт beforeTurn один раз: и при пропуске, и при отказе", async () => {
    const { beforeTurn, turnNotStarted } = hooks();
    const { service } = setup({ beforeTurn, turnNotStarted });
    const chat = await service.createChat("anna");
    const notice = (deliveryKey: string) => ({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "ок")], wakeAgent: true, deliveryKey });

    expect(await service.deliverNotices(notice("k1"))).toMatchObject({ status: "delivered", turnStarted: true });
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(false));
    expect(beforeTurn).toHaveBeenCalledTimes(1);

    beforeTurn.mockReturnValue({ code: "quota", message: "Квота" });
    expect(await service.deliverNotices(notice("k2"))).toMatchObject({ status: "delivered", turnStarted: false });
    expect(beforeTurn).toHaveBeenCalledTimes(2);
    expect(turnNotStarted).not.toHaveBeenCalled();
  });

  it("проверка без хода (assertTurnAllowed) закрывается сразу: no_turn", async () => {
    const { beforeTurn, turnNotStarted } = hooks();
    const { service } = setup({ beforeTurn, turnNotStarted });
    const chat = await service.createChat("anna");
    await service.assertTurnAllowed("anna", chat.id, "send", "голос");
    expect(turnNotStarted).toHaveBeenCalledTimes(1);
    expect(turnNotStarted.mock.calls[0]![0]).toMatchObject({ action: "send", reason: "no_turn" });
  });

  it("отказ beforeTurn — turnNotStarted не зовётся: резерва нет; сбой turnNotStarted — в журнал, ошибка хода прежняя", async () => {
    const turnNotStarted = vi.fn<TurnNotStartedHandler>(async () => {
      throw new Error("база резервов легла");
    });
    const refusing = setup({ beforeTurn: () => ({ code: "closed", message: "Закрыто" }), turnNotStarted });
    const chat = await refusing.service.createChat("anna");
    await expect(refusing.service.sendMessage("anna", chat.id, userMessage("u1"))).rejects.toThrow("Закрыто");
    expect(turnNotStarted).not.toHaveBeenCalled();

    const failing = setup({ beforeTurn: vi.fn<BeforeTurnHandler>(), turnNotStarted });
    const other = await failing.service.createChat("anna");
    await readAll(await failing.service.sendMessage("anna", other.id, userMessage("u1")));
    await expect(failing.service.sendMessage("anna", other.id, userMessage("u1"))).rejects.toThrow(/u1|уже/);
    expect(failing.logError).toHaveBeenCalledWith(expect.stringContaining("turnNotStarted"));
  });
});

describe("штатная остановка ждёт идущие ответы (flush({ waitForAnswersMs }))", () => {
  it("ответ успел за срок: flush возвращается после конечной записи и afterTurn; закрытие базы ничего не портит", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const storage = closableStorage();
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service, logError } = setup({ model: source.model, storage, afterTurn });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    let flushed = false;
    const flushing = service.flush({ waitForAnswersMs: 95_000 }).then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(flushed).toBe(false);
    source.push(delta(" и конец"), { type: "text-end", id: "txt-0" }, finishPart());
    source.end();
    await flushing;
    storage.close();
    const chunks: UIMessageChunk[] = await reading;

    expect(chunks.at(-1)?.type).toBe("finish");
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "complete", text: "Начало и конец" });
    expect(logError).not.toHaveBeenCalled();
  });

  it("срок вышел: ответ остановлен с записью (stopReason: shutdown), медленный afterTurn дождан до возврата flush", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const storage = closableStorage();
    let hookDone = false;
    const afterTurn = vi.fn<AfterTurnHandler>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      hookDone = true;
    });
    const { service, logError } = setup({ model: source.model, storage, afterTurn });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    const flushing = service.flush({ waitForAnswersMs: 10_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    await flushing;
    expect(hookDone).toBe(true);
    const answer = await lastAnswer(storage, chat.id);
    storage.close();
    await reading;

    expect(answer).toMatchObject({ status: "stopped", afterTurn: "done", parts: expect.arrayContaining([expect.objectContaining({ text: "Начало" })]) });
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "stopped", stopReason: "shutdown" });
    expect(logError).not.toHaveBeenCalled();
  });

  it("flush() без срока останавливает ответ сразу и возвращается, когда он записан", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const storage = closableStorage();
    const { service, logError } = setup({ model: source.model, storage });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    await service.flush();
    expect((await lastAnswer(storage, chat.id)).status).toBe("stopped");
    storage.close();
    expect((await reading).at(-1)?.type).toBe("abort");
    expect(logError).not.toHaveBeenCalled();
  });

  it("пока остановка ждёт ответы, новый ход не начинается: чат занят, ничего не записано", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const { service, storage } = setup({ model: source.model });
    const chat = await service.createChat("anna");
    const other = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    const flushing = service.flush({ waitForAnswersMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    await expect(service.sendMessage("anna", other.id, userMessage("u2"))).rejects.toBeInstanceOf(ChatBusyError);
    expect(await storage.listMessages(other.id)).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    await flushing;
    await reading;
  });

  it("конечная запись не прошла при остановке — ответ помечен брошенным: следующий старт прервёт его сразу", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const inner = createInMemoryChatStorage();
    const storage = new Proxy(inner, {
      get(target, key, receiver) {
        if (key === "finishMessage") return () => Promise.reject(new Error("The database connection is not open"));
        return Reflect.get(target, key, receiver);
      },
    });
    const { service } = setup({ model: source.model, storage });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    const flushing = service.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await flushing;
    await reading.catch(() => []);

    const answer = await lastAnswer(storage, chat.id);
    expect(answer.status).toBe("streaming");
    expect(await storage.listSilentAnswerIds!({ silentForMs: 60_000 })).toContain(answer.id);
  });

  it("остановка не помечает ответ брошенным, пока он сам записывает итог: другая копия его не перехватит", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const inner = createInMemoryChatStorage();
    const releasedBeforeFinish: string[] = [];
    let finishing = false;
    const storage = new Proxy(inner, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key === "updateStreamingMessage") {
          return (id: string, update: { alive?: string }) => {
            if (update.alive === "released" && !finishing) releasedBeforeFinish.push(id);
            return value.call(target, id, update);
          };
        }
        if (key === "finishMessage") {
          return (...args: unknown[]) => {
            finishing = true;
            return value.apply(target, args);
          };
        }
        return value;
      },
    });
    const { service } = setup({ model: source.model, storage });
    const chat = await service.createChat("anna");
    const { reading } = await heldTurn(service, source, chat.id);

    await service.flush();
    await reading;
    expect((await lastAnswer(storage, chat.id)).status).toBe("stopped");
    expect(releasedBeforeFinish).toEqual([]);
  });

  it("ход не закончился после остановки за отведённое время — flush не виснет: строка в журнал", async () => {
    vi.useFakeTimers();
    const source = controlledModel();
    const inner = createInMemoryChatStorage();
    const storage = new Proxy(inner, {
      get(target, key, receiver) {
        if (key === "finishMessage") return () => new Promise(() => {});
        return Reflect.get(target, key, receiver);
      },
    });
    const { service, logError } = setup({ model: source.model, storage });
    const chat = await service.createChat("anna");
    await heldTurn(service, source, chat.id);

    let flushed = false;
    const flushing = service.flush().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(flushed).toBe(true);
    await flushing;
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("не закончил"));
  });

  it("идущая проверка брошенных ответов дожидается до возврата flush", async () => {
    vi.useFakeTimers();
    const inner = createInMemoryChatStorage();
    let calls = 0;
    let releaseSweep!: () => void;
    const storage = new Proxy(inner, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key === "listSilentAnswerIds") {
          return async (...args: unknown[]) => {
            if (++calls === 2) await new Promise<void>((resolve) => (releaseSweep = resolve));
            return value.apply(target, args);
          };
        }
        return value;
      },
    });
    const { service } = setup({ storage });
    await service.recoverInterruptedAnswers();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2);

    let flushed = false;
    const flushing = service.flush().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushed).toBe(false);
    releaseSweep();
    await flushing;
  });

  it("неверный срок ожидания — TypeError", async () => {
    const { service } = setup();
    await expect(service.flush({ waitForAnswersMs: -1 })).rejects.toBeInstanceOf(TypeError);
  });
});
