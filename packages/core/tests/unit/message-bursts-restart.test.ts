import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BURST_HOLD_MS, BURST_SWEEP_LIMIT, ChatBusyError, DEFAULT_BURST_QUIET_MS, SpendingLimitReachedError } from "../../src/index";
import type { ChatService, SpendingLimits, TurnNotStartedHandler } from "../../src/index";
import type { ChatServiceOptions } from "../../src/chat-service";
import { STALE_ANSWERS_SWEEP_EVERY_MS } from "../../src/agent-run/answer-liveness";
import { createChatEvents } from "../../src/chat-events/chat-events";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { readAll, streamOf } from "./support/mock-model";
import { lastUserTexts, noticeService, saying, scriptedModel, userMessage, waitTurn } from "./support/notice-chat";

// Окно тишины пачки идёт по часам службы (`now`), а с `answerAfterRestart` переживает перезапуск: ждущая пачка записана
// в хранилище, запуск и регулярный обход отвечают на брошенные. Здесь часы службы подменены и стоят, пока тест их не сдвинет: настоящих
// пауз нет, ход начинается только после сдвига и `tickBursts`.

const QUIET = DEFAULT_BURST_QUIET_MS;
const START = Date.UTC(2026, 9, 15, 12, 0, 0);
const FAR_FUTURE = "2100-01-01T00:00:00.000Z";
const KEPT = { answerAfterRestart: true };

/** Часы службы, которые идут только по команде. */
function manualClock(at = START) {
  let current = at;
  return {
    now: () => new Date(current),
    set: (ms: number) => {
      current = ms;
    },
  };
}

const services: ChatService[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const service of services.splice(0)) await service.flush();
});

function serviceOn(storage: ChatStorage, clock: { now: () => Date }, extra: Partial<Omit<ChatServiceOptions, "agent">> = {}, model = scriptedModel()) {
  const events: ChatEvent[] = [];
  const logs: string[] = [];
  const chatEvents = createChatEvents();
  chatEvents.subscribe((event) => events.push(event));
  const { service } = noticeService(model, { storage, now: clock.now, chatEvents, logError: (message) => logs.push(message), ...extra });
  services.push(service);
  return { service, model, events, logs };
}

/** Копия с остановленными часами пишет пачки и «падает»: их окна не кончатся, ответит только обход другой копии. */
async function abandonedBursts(storage: ChatStorage, owners: string[] = ["anna"]) {
  const crashed = serviceOn(storage, manualClock());
  const chats = [];
  for (const [index, owner] of owners.entries()) {
    const chat = await crashed.service.createChat(owner);
    void (await crashed.service.sendBurstMessage(owner, chat.id, userMessage(`u${index}`, "привет"), KEPT)).turn.catch(() => {});
    chats.push(chat);
  }
  return chats;
}

/** Срок удержания пачек упавшей копии прошёл: другая копия их возьмёт. */
const ABANDONED_AT = START + QUIET + BURST_HOLD_MS;

const turnsStarted = (events: ChatEvent[]) => events.filter((event) => event.type === "turn-started");

/** Записи ждущих пачек хранилища (берёт их тестовая «копия»). */
const pendingOf = (storage: ChatStorage) => storage.takeAbandonedBursts!({ abandonedBefore: FAR_FUTURE, holder: "probe", heldUntil: FAR_FUTURE, limit: 10 });

/** Признак, что обещание уже решено (без ожидания). */
async function settledNow(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let step = 0; step < 20; step++) await Promise.resolve();
  return settled;
}

describe("sendBurstMessage: окно тишины по часам службы", () => {
  it("часы стоят — хода нет; сдвиг на окно и tickBursts — ход, без настоящего ожидания", async () => {
    const clock = manualClock();
    const { service, model } = serviceOn(createInMemoryChatStorage(), clock);
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));

    await service.tickBursts();
    clock.set(START + QUIET - 1);
    await service.tickBursts();
    expect(await settledNow(sent.turn)).toBe(false);
    expect(model.doStreamCalls).toHaveLength(0);

    clock.set(START + QUIET);
    await service.tickBursts();
    await readAll((await sent.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("окно считается от последнего сообщения пачки по тем же часам", async () => {
    const clock = manualClock();
    const { service, model } = serviceOn(createInMemoryChatStorage(), clock);
    const chat = await service.createChat("anna");
    const first = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    clock.set(START + 1000);
    const second = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"));

    clock.set(START + QUIET);
    await service.tickBursts();
    expect(await first.turn).toBeNull();
    expect(await settledNow(second.turn)).toBe(false);

    clock.set(START + 1000 + QUIET);
    await service.tickBursts();
    await readAll((await second.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(lastUserTexts(model.doStreamCalls[0]!).join("")).toMatch(/^привет\n\nвопрос/);
  });
});

describe("sendBurstMessage: ждущая пачка переживает перезапуск", () => {
  it("ответ записан — записи ждущей пачки нет; «Стоп» во время окна — тоже", async () => {
    const clock = manualClock();
    const storage = createInMemoryChatStorage();
    const { service } = serviceOn(storage, clock);
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);
    expect(await pendingOf(storage)).toEqual([
      expect.objectContaining({ chatId: chat.id, ownerId: "anna", messageId: "u1", dueAt: new Date(START + QUIET).toISOString() }),
    ]);
    clock.set(START + QUIET);
    await service.tickBursts();
    await readAll((await sent.turn)!);
    // Запись снимается сразу после решения, в фоне.
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));

    const stopped = await service.sendBurstMessage("anna", chat.id, userMessage("u2", "ещё"), KEPT);
    expect(await service.stop("anna", chat.id)).toBe(true);
    expect(await stopped.turn).toBeNull();
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
  });

  it("без answerAfterRestart записи нет: после перезапуска пачку отвечает только повтор вызова", async () => {
    const clock = manualClock();
    const storage = createInMemoryChatStorage();
    const before = serviceOn(storage, clock);
    const chat = await before.service.createChat("anna");
    await before.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    expect(await pendingOf(storage)).toEqual([]);
    await before.service.flush();

    clock.set(START + 60_000);
    const after = serviceOn(storage, clock);
    await after.service.recoverInterruptedAnswers({ soleServer: true });
    await after.service.tickBursts();
    expect(after.model.doStreamCalls).toHaveLength(0);
    expect(after.events.some((event) => event.type === "turn-started")).toBe(false);
  });

  it("перезапуск посреди окна: запуск единственной копии сам отвечает на пачку, когда окно прошло; повтора вызова не нужно", async () => {
    const clock = manualClock();
    const storage = createInMemoryChatStorage();
    const before = serviceOn(storage, clock);
    const chat = await before.service.createChat("anna");
    await before.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);
    const dropped = await before.service.sendBurstMessage("anna", chat.id, userMessage("u2", "вопрос"), KEPT);
    await before.service.flush();
    await expect(dropped.turn).rejects.toBeInstanceOf(ChatBusyError);

    const after = serviceOn(storage, clock);
    await after.service.recoverInterruptedAnswers({ soleServer: true });
    await after.service.tickBursts();
    expect(after.model.doStreamCalls).toHaveLength(0);

    clock.set(START + QUIET);
    await after.service.tickBursts();
    await vi.waitFor(() => expect(after.events.some((event) => event.type === "turn-started")).toBe(true));
    await waitTurn(after.service, chat.id);
    expect(after.model.doStreamCalls).toHaveLength(1);
    expect(lastUserTexts(after.model.doStreamCalls[0]!).join("")).toMatch(/^привет\n\nвопрос/);
    // Ход начал сервер сам, потока у вызова нет: каналы провожают его по событию.
    expect(after.events.find((event) => event.type === "turn-started")).toMatchObject({ chatId: chat.id, trigger: "human", unattended: true });
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
  });

  it("окно прошло, пока сервер лежал: запуск отвечает сразу", async () => {
    const clock = manualClock();
    const storage = createInMemoryChatStorage();
    const before = serviceOn(storage, clock);
    const chat = await before.service.createChat("anna");
    await before.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);
    await before.service.flush();

    clock.set(START + 60_000);
    const after = serviceOn(storage, clock);
    await after.service.recoverInterruptedAnswers({ soleServer: true });
    await vi.waitFor(() => expect(after.events.some((event) => event.type === "turn-started")).toBe(true));
    await waitTurn(after.service, chat.id);
    expect(after.model.doStreamCalls).toHaveLength(1);
  });

  it("копия упала посреди окна: другая берёт пачку, когда срок удержания вышел; отвечает одна", async () => {
    const storage = createInMemoryChatStorage();
    // У упавшей копии часы стоят: её окно не кончится само.
    const crashed = serviceOn(storage, manualClock());
    const chat = await crashed.service.createChat("anna");
    const lost = await crashed.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);

    const clock = manualClock();
    const other = serviceOn(storage, clock);
    await other.service.recoverInterruptedAnswers();
    clock.set(START + QUIET + BURST_HOLD_MS - 1);
    await other.service.tickBursts();
    expect(other.model.doStreamCalls).toHaveLength(0);

    clock.set(START + QUIET + BURST_HOLD_MS);
    await other.service.tickBursts();
    await vi.waitFor(() => expect(other.events.some((event) => event.type === "turn-started")).toBe(true));
    await waitTurn(other.service, chat.id);
    expect(other.model.doStreamCalls).toHaveLength(1);

    // «Упавшая» копия ожила: ответ уже есть, второго хода нет.
    await crashed.service.tickBursts();
    expect(await lost.turn).toBeNull();
    expect(crashed.model.doStreamCalls).toHaveLength(0);
  });

  it("срок удержания вышел, а живая копия ещё ждёт: ход один — у вызова, обход его не дублирует", async () => {
    const clock = manualClock();
    const storage = createInMemoryChatStorage();
    const { service, model, events } = serviceOn(storage, clock);
    const chat = await service.createChat("anna");
    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);
    clock.set(START + QUIET + BURST_HOLD_MS + 1);
    await service.tickBursts();
    await readAll((await sent.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn-started")).toEqual([expect.not.objectContaining({ unattended: true })]);
  });
});

describe("sendBurstMessage: регулярный обход брошенных пачек", () => {
  it("после recoverInterruptedAnswers брошенная пачка подхватывается сама, без tickBursts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const storage = createInMemoryChatStorage();
    const crashed = serviceOn(storage, manualClock());
    const chat = await crashed.service.createChat("anna");
    await crashed.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);

    const clock = manualClock();
    const other = serviceOn(storage, clock);
    await other.service.recoverInterruptedAnswers();
    clock.set(START + QUIET + BURST_HOLD_MS);
    await vi.advanceTimersByTimeAsync(STALE_ANSWERS_SWEEP_EVERY_MS);
    await vi.waitFor(() => expect(other.events.some((event) => event.type === "turn-started")).toBe(true));
    await waitTurn(other.service, chat.id);
    expect(other.model.doStreamCalls).toHaveLength(1);
  });
});

describe("sendBurstMessage: обход брошенных пачек — отказы и занятость", () => {
  it("предел ходов человека: пачка не теряется — её ответит следующий обход", async () => {
    const storage = createInMemoryChatStorage();
    const [first, second] = await abandonedBursts(storage, ["anna", "anna"]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        if (calls++ === 0) await gate;
        return { stream: streamOf(saying(`ответ ${calls}`) as LanguageModelV4StreamPart[]) };
      },
    });
    const clock = manualClock(ABANDONED_AT);
    const other = serviceOn(storage, clock, { maxConcurrentTurnsPerUser: 1 }, model);
    await other.service.tickBursts();
    await vi.waitFor(() => expect(turnsStarted(other.events)).toHaveLength(1));
    release();
    await waitTurn(other.service, first!.id);
    await waitTurn(other.service, second!.id);

    clock.set(ABANDONED_AT + BURST_HOLD_MS);
    await other.service.tickBursts();
    await vi.waitFor(() => expect(turnsStarted(other.events)).toHaveLength(2));
    for (const chat of [first!, second!]) {
      await waitTurn(other.service, chat.id);
      expect((await storage.listMessages(chat.id)).find((message) => message.role === "assistant")).toMatchObject({ status: "complete" });
    }
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
  });

  it("лимит расходов: запись снята, строка в журнал, turnNotStarted с unattended — приложение может сказать человеку", async () => {
    const storage = createInMemoryChatStorage();
    const [chat] = await abandonedBursts(storage);
    const limits: SpendingLimits = {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      status: async () => ({ state: "exhausted" as const, scope: "user" as const, period: "month" as const, share: 1, resetsAt: null }),
    };
    const notStarted = vi.fn<TurnNotStartedHandler>();
    const other = serviceOn(storage, manualClock(ABANDONED_AT), { limits, beforeTurn: () => undefined, turnNotStarted: notStarted });
    await other.service.tickBursts();
    await vi.waitFor(() => expect(notStarted).toHaveBeenCalledWith(expect.objectContaining({ chat: expect.objectContaining({ id: chat!.id }), reason: "spending_limit", unattended: true })));
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
    expect(other.logs.join("\n")).toMatch(/Ход на брошенную пачку чата .* не начался/);
    expect(other.model.doStreamCalls).toHaveLength(0);
  });

  it("отказ beforeTurn: ворота знают, что ход без вызова (unattended); запись снята, строка в журнал", async () => {
    const storage = createInMemoryChatStorage();
    const [chat] = await abandonedBursts(storage);
    const beforeTurn = vi.fn<NonNullable<ChatServiceOptions["beforeTurn"]>>(() => ({ code: "paused", message: "Пауза" }));
    const other = serviceOn(storage, manualClock(ABANDONED_AT), { beforeTurn });
    await other.service.tickBursts();
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
    expect(beforeTurn).toHaveBeenCalledWith(expect.objectContaining({ chat: expect.objectContaining({ id: chat!.id }), unattended: true }));
    expect(other.logs.join("\n")).toMatch(/paused/);
    expect(other.model.doStreamCalls).toHaveLength(0);
  });

  it("beforeTurn → hold: сообщение остаётся без хода, turn-held, запись снята", async () => {
    const storage = createInMemoryChatStorage();
    const [chat] = await abandonedBursts(storage);
    const other = serviceOn(storage, manualClock(ABANDONED_AT), { beforeTurn: () => ({ hold: true }) });
    await other.service.tickBursts();
    await vi.waitFor(() => expect(other.events).toContainEqual(expect.objectContaining({ type: "turn-held", chatId: chat!.id })));
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
    expect(other.model.doStreamCalls).toHaveLength(0);
    expect((await storage.listMessages(chat!.id)).map((message) => message.role)).toEqual(["user"]);
  });

  it("beforeTurn → готовая фраза: ответ без модели, turn-started с unattended", async () => {
    const storage = createInMemoryChatStorage();
    const [chat] = await abandonedBursts(storage);
    const other = serviceOn(storage, manualClock(ABANDONED_AT), { beforeTurn: () => ({ reply: { text: "Вернусь утром" } }) });
    await other.service.tickBursts();
    await vi.waitFor(() => expect(turnsStarted(other.events)).toEqual([expect.objectContaining({ chatId: chat!.id, unattended: true })]));
    await waitTurn(other.service, chat!.id);
    await vi.waitFor(async () =>
      expect((await storage.listMessages(chat!.id)).find((message) => message.role === "assistant")).toMatchObject({
        parts: expect.arrayContaining([expect.objectContaining({ text: "Вернусь утром" })]),
      }),
    );
    expect(other.model.doStreamCalls).toHaveLength(0);
  });

  it("чат удалили, когда пачку уже взяли: хода нет, обход не падает, запись снята", async () => {
    const storage = createInMemoryChatStorage();
    const [chat] = await abandonedBursts(storage);
    const take = storage.takeAbandonedBursts!.bind(storage);
    storage.takeAbandonedBursts = async (input) => {
      const taken = await take(input);
      for (const burst of taken) await storage.deleteChat(burst.chatId);
      return taken;
    };
    const other = serviceOn(storage, manualClock(ABANDONED_AT));
    await other.service.tickBursts();
    await other.service.flush();
    expect(other.model.doStreamCalls).toHaveLength(0);
    expect(await storage.getChat(chat!.id)).toBeNull();
    expect(await pendingOf(storage)).toEqual([]);
  });

  it("брошенных больше одной порции: обход отвечает всем до конца", async () => {
    const storage = createInMemoryChatStorage();
    const owners = Array.from({ length: BURST_SWEEP_LIMIT + 5 }, (_, index) => `user-${index}`);
    await abandonedBursts(storage, owners);
    const other = serviceOn(storage, manualClock(ABANDONED_AT));
    await other.service.recoverInterruptedAnswers({ soleServer: true });
    await vi.waitFor(() => expect(other.model.doStreamCalls).toHaveLength(owners.length), { timeout: 20_000 });
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
  }, 30_000);

  it("ход без вызова, а на события никто не подписан: строка в журнал — ответ никуда не уйдёт", async () => {
    const storage = createInMemoryChatStorage();
    await abandonedBursts(storage);
    const logs: string[] = [];
    const { service } = noticeService(scriptedModel(), { storage, now: manualClock(ABANDONED_AT).now, logError: (message) => logs.push(message) });
    services.push(service);
    await service.tickBursts();
    await vi.waitFor(() => expect(logs.join("\n")).toMatch(/на события чата никто не подписан/));
  });
});

describe("sendBurstMessage: живая копия держит свою пачку", () => {
  it("ждёт дольше срока удержания (медленный beforeTurn) — продлевает его, другая копия пачку не берёт", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const clock = manualClock();
    const storage = createInMemoryChatStorage();
    let pass!: () => void;
    const slow = new Promise<void>((resolve) => (pass = resolve));
    const live = serviceOn(storage, clock, { beforeTurn: async () => void (await slow) });
    const chat = await live.service.createChat("anna");
    const sent = await live.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);
    clock.set(START + QUIET);
    await live.service.tickBursts();

    const other = serviceOn(storage, clock);
    for (let step = 1; step <= 4; step++) {
      clock.set(START + QUIET + step * (BURST_HOLD_MS / 2));
      await vi.advanceTimersByTimeAsync(BURST_HOLD_MS / 2);
      await other.service.tickBursts();
    }
    expect(turnsStarted(other.events)).toEqual([]);

    pass();
    await readAll((await sent.turn)!);
    expect(live.model.doStreamCalls).toHaveLength(1);
    expect(other.model.doStreamCalls).toHaveLength(0);
  });

  it("сбой записи ждущей пачки — вызов отказывает, сообщение не записано: повтор с тем же id запишет его", async () => {
    const storage = createInMemoryChatStorage();
    const save = storage.savePendingBurst!.bind(storage);
    let failures = 1;
    storage.savePendingBurst = async (burst) => {
      if (failures-- > 0) throw new Error("база недоступна");
      return save(burst);
    };
    const clock = manualClock();
    const { service, model } = serviceOn(storage, clock);
    const chat = await service.createChat("anna");
    await expect(service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT)).rejects.toThrow("база недоступна");
    expect(await storage.listMessages(chat.id)).toEqual([]);

    const sent = await service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"), KEPT);
    expect(await pendingOf(storage)).toEqual([expect.objectContaining({ messageId: "u1" })]);
    clock.set(START + QUIET);
    await service.tickBursts();
    await readAll((await sent.turn)!);
    expect(model.doStreamCalls).toHaveLength(1);
  });
});
