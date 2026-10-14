import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatBusyError, DEFAULT_BURST_QUIET_MS } from "../../src/index";
import { CHAT_TURN_LEASE_MS, createChatTurnLeases } from "../../src/chat-turn-lease";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { generateResult, readAll, streamOf } from "./support/mock-model";
import { noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

// Один ход за раз на чат и между копиями сервера: аренда хода в хранилище (`claimChatTurn`). Две копии — две службы на
// одном хранилище.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

function twoCopies() {
  const storage = createInMemoryChatStorage();
  const models = [scriptedModel(), scriptedModel()] as const;
  const first = noticeService(models[0], { storage });
  const second = noticeService(models[1], { storage });
  return { storage, first, second, calls: () => models[0].doStreamCalls.length + models[1].doStreamCalls.length };
}

describe("аренда хода между копиями сервера", () => {
  it("две копии разом начинают ход в одном чате: идёт один, второй вызов — ChatBusyError", async () => {
    const { first, second, calls } = twoCopies();
    const chat = await first.service.createChat("anna");
    const results = await Promise.allSettled([
      first.service.sendMessage("anna", chat.id, userMessage("u1", "раз")),
      second.service.sendMessage("anna", chat.id, userMessage("u2", "два")),
    ]);
    for (const result of results) if (result.status === "fulfilled") await readAll(result.value);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.any(ChatBusyError) });
    expect(calls()).toBe(1);
  });

  it("одна пачка на двух копиях (повтор обновления попал на другую): ход один, вторая копия — null", async () => {
    const { first, second, calls } = twoCopies();
    const chat = await first.service.createChat("anna");
    const here = await first.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    const there = await second.service.sendBurstMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.advanceTimersByTimeAsync(DEFAULT_BURST_QUIET_MS);
    const streams = (await Promise.all([here.turn, there.turn])).filter((stream) => stream !== null);
    for (const stream of streams) await readAll(stream);
    await vi.advanceTimersByTimeAsync(5000);
    expect(streams).toHaveLength(1);
    expect(calls()).toBe(1);
  });

  it("ход кончился — аренда снята: следующий ход идёт на другой копии", async () => {
    const { first, second, calls } = twoCopies();
    const chat = await first.service.createChat("anna");
    await readAll(await first.service.sendMessage("anna", chat.id, userMessage("u1", "раз")));
    await readAll(await second.service.sendMessage("anna", chat.id, userMessage("u2", "два")));
    expect(calls()).toBe(2);
  });

  it("копия упала с арендой: чат занят, пока аренда не истекла, потом свободен", async () => {
    const { storage, second } = twoCopies();
    const chat = await second.service.createChat("anna");
    expect(await storage.claimChatTurn!(chat.id, "упавшая копия", CHAT_TURN_LEASE_MS)).toBe(true);
    await expect(second.service.sendMessage("anna", chat.id, userMessage("u1", "раз"))).rejects.toBeInstanceOf(ChatBusyError);
    await vi.advanceTimersByTimeAsync(CHAT_TURN_LEASE_MS);
    await readAll(await second.service.sendMessage("anna", chat.id, userMessage("u1", "раз")));
  });

  it("старт единственной копии (soleServer) снимает аренды упавшего запуска: чат свободен сразу", async () => {
    const { storage, second } = twoCopies();
    const chat = await second.service.createChat("anna");
    await storage.claimChatTurn!(chat.id, "упавший прошлый запуск", CHAT_TURN_LEASE_MS);
    await second.service.recoverInterruptedAnswers({ soleServer: true });
    await readAll(await second.service.sendMessage("anna", chat.id, userMessage("u1", "раз")));
  });

  it("старт без soleServer чужие аренды не трогает: другая копия может быть жива", async () => {
    const { storage, second } = twoCopies();
    const chat = await second.service.createChat("anna");
    await storage.claimChatTurn!(chat.id, "живая копия", CHAT_TURN_LEASE_MS);
    await second.service.recoverInterruptedAnswers();
    await expect(second.service.sendMessage("anna", chat.id, userMessage("u1", "раз"))).rejects.toBeInstanceOf(ChatBusyError);
    await second.service.flush();
  });

  it("долгий ход продлевает аренду: чужая копия не берёт чат и через несколько сроков", async () => {
    const storage = createInMemoryChatStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const model = new MockLanguageModelV4({
      doStream: async () => {
        await gate;
        return { stream: streamOf(saying("ответ")) };
      },
      doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
    });
    const { service } = noticeService(model, { storage });
    const chat = await service.createChat("anna");
    const stream = service.sendMessage("anna", chat.id, userMessage("u1", "раз"));
    await vi.advanceTimersByTimeAsync(3 * CHAT_TURN_LEASE_MS);
    expect(await storage.claimChatTurn!(chat.id, "другая копия", CHAT_TURN_LEASE_MS)).toBe(false);
    release();
    await readAll(await stream);
    expect(await storage.claimChatTurn!(chat.id, "другая копия", CHAT_TURN_LEASE_MS)).toBe(true);
  });
});

/** Хранилище, у которого снятие аренды висит до `letRelease()`: так база выполняет DELETE позже следующего запроса. */
function slowRelease() {
  const storage = createInMemoryChatStorage();
  let letRelease!: () => void;
  const gate = new Promise<void>((resolve) => (letRelease = resolve));
  const slow: ChatStorage = { ...storage, releaseChatTurn: async (chatId, holder) => {
    await gate;
    return storage.releaseChatTurn!(chatId, holder);
  } };
  return { storage, slow, letRelease };
}

describe("снятие аренды не обгоняет следующий захват", () => {
  it("вышли и сразу вошли снова, а снятие дошло до базы позже: новая аренда цела", async () => {
    const { storage, slow, letRelease } = slowRelease();
    const leases = createChatTurnLeases({ storage: slow, holder: "копия A", logError: () => {} });
    await leases.enter("c");
    leases.leave("c");
    const entering = leases.enter("c");
    letRelease();
    await entering;
    expect(await storage.claimChatTurn!("c", "копия B", CHAT_TURN_LEASE_MS)).toBe(false);
    leases.leave("c");
    await leases.releaseAll();
    expect(await storage.claimChatTurn!("c", "копия B", CHAT_TURN_LEASE_MS)).toBe(true);
  });

  it("продление в пути не воскрешает снятую аренду", async () => {
    const storage = createInMemoryChatStorage();
    let letRenew!: () => void;
    let renewing = false;
    const renewGate = new Promise<void>((resolve) => (letRenew = resolve));
    const slow: ChatStorage = { ...storage, claimChatTurn: async (chatId, holder, ms) => {
      if (renewing) await renewGate;
      return storage.claimChatTurn!(chatId, holder, ms);
    } };
    const leases = createChatTurnLeases({ storage: slow, holder: "копия A", logError: () => {} });
    await leases.enter("c");
    renewing = true;
    await vi.advanceTimersByTimeAsync(5000);
    leases.leave("c");
    letRenew();
    await leases.releaseAll();
    expect(await storage.claimChatTurn!("c", "копия B", CHAT_TURN_LEASE_MS)).toBe(true);
  });

  it("flush службы ждёт снятия всех аренд", async () => {
    const { storage, slow, letRelease } = slowRelease();
    const { service } = noticeService(scriptedModel(), { storage: slow });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "раз")));
    let flushed = false;
    const flushing = service.flush().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(flushed).toBe(false);
    letRelease();
    await flushing;
    expect(await storage.claimChatTurn!(chat.id, "копия B", CHAT_TURN_LEASE_MS)).toBe(true);
  });
});
