import { afterEach, describe, expect, it, vi } from "vitest";
import { BURST_HOLD_MS, DEFAULT_BURST_QUIET_MS } from "../../src/index";
import type { ChatService } from "../../src/index";
import type { ChatServiceOptions } from "../../src/chat-service";
import { STALE_ANSWERS_SWEEP_EVERY_MS } from "../../src/agent-run/answer-liveness";
import { createChatEvents } from "../../src/chat-events/chat-events";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { noticeService, scriptedModel, textsOf, userMessage, waitTurn } from "./support/notice-chat";

// Несколько служб чата на одном хранилище (своя инструкция на версию продукта): брошенную пачку обход отдаёт службе,
// которую назвало приложение (`abandonedBursts.serviceFor`), а не той, что первой проверила брошенные.

const QUIET = DEFAULT_BURST_QUIET_MS;
const START = Date.UTC(2026, 9, 15, 12, 0, 0);
const ABANDONED_AT = START + QUIET + BURST_HOLD_MS;
const FAR_FUTURE = "2100-01-01T00:00:00.000Z";
const KEPT = { answerAfterRestart: true };

function manualClock(at = START) {
  let current = at;
  return { now: () => new Date(current), set: (ms: number) => void (current = ms) };
}

const services: ChatService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.flush();
});

/** Служба со своей инструкцией и своей моделью: по модели видно, кто ответил. */
function serviceWith(instructions: string, storage: ChatStorage, clock: { now: () => Date }, extra: Partial<Omit<ChatServiceOptions, "agent">> = {}) {
  const model = scriptedModel();
  const events: ChatEvent[] = [];
  const logs: string[] = [];
  const chatEvents = createChatEvents();
  chatEvents.subscribe((event) => events.push(event));
  const { service } = noticeService(model, { storage, now: clock.now, chatEvents, logError: (message) => logs.push(message), agent: { instructions }, ...extra });
  services.push(service);
  return { service, model, events, logs };
}

/** Копия с остановленными часами пишет пачку в чат и «падает». */
async function abandonedBurst(storage: ChatStorage, owner = "anna") {
  const crashed = serviceWith("Упавшая копия.", storage, manualClock());
  const chat = await crashed.service.createChat(owner);
  void (await crashed.service.sendBurstMessage(owner, chat.id, userMessage("u1", "привет"), KEPT)).turn.catch(() => {});
  return chat;
}

const pendingOf = (storage: ChatStorage) => storage.takeAbandonedBursts!({ abandonedBefore: FAR_FUTURE, holder: "probe", heldUntil: FAR_FUTURE, limit: 10 });
const systemOf = (model: ReturnType<typeof scriptedModel>) => textsOf(model.doStreamCalls[0]!.prompt.find((message) => message.role === "system")).join("\n");

describe("abandonedBursts.serviceFor: брошенная пачка — нужной службе", () => {
  it("две службы с разными инструкциями: обход любой из них отдаёт пачку службе её версии", async () => {
    const storage = createInMemoryChatStorage();
    const chatOfB = await abandonedBurst(storage);
    const versionOf = new Map([[chatOfB.id, "B"]]);
    const clock = manualClock(ABANDONED_AT);
    const byVersion: Record<string, ReturnType<typeof serviceWith>> = {};
    const serviceFor = vi.fn(({ chatId }: { ownerId: string; chatId: string }) => byVersion[versionOf.get(chatId) ?? "A"]!.service);
    byVersion.A = serviceWith("Ты консультант версии A.", storage, clock, { abandonedBursts: { serviceFor } });
    byVersion.B = serviceWith("Ты консультант версии B.", storage, clock, { abandonedBursts: { serviceFor } });

    await byVersion.A.service.recoverInterruptedAnswers({ soleServer: true });
    await vi.waitFor(() => expect(byVersion.B!.model.doStreamCalls).toHaveLength(1));
    await waitTurn(byVersion.B.service, chatOfB.id);
    expect(systemOf(byVersion.B.model)).toContain("Ты консультант версии B.");
    expect(byVersion.A.model.doStreamCalls).toHaveLength(0);
    expect(serviceFor).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "anna", chatId: chatOfB.id, chat: expect.objectContaining({ id: chatOfB.id }) }));
    expect(byVersion.B.events.filter((event) => event.type === "turn-started")).toEqual([expect.objectContaining({ chatId: chatOfB.id, unattended: true })]);
    await vi.waitFor(async () => expect(await pendingOf(storage)).toEqual([]));
  });

  it("нужной службы нет (serviceFor → null): чужая не отвечает, пачка ждёт и уходит своей службе следующим обходом", async () => {
    const storage = createInMemoryChatStorage();
    const chat = await abandonedBurst(storage);
    const clock = manualClock(ABANDONED_AT);
    let own: ChatService | null = null;
    const recovery = serviceWith("", storage, clock, { abandonedBursts: { serviceFor: () => own } });
    await recovery.service.tickBursts();
    await recovery.service.tickBursts();
    expect(recovery.model.doStreamCalls).toHaveLength(0);
    expect(recovery.logs.join("\n")).toMatch(/нет службы/);

    const version = serviceWith("Ты консультант своей версии.", storage, clock);
    own = version.service;
    clock.set(ABANDONED_AT + BURST_HOLD_MS);
    await recovery.service.tickBursts();
    await vi.waitFor(() => expect(version.model.doStreamCalls).toHaveLength(1));
    await waitTurn(version.service, chat.id);
    expect(recovery.model.doStreamCalls).toHaveLength(0);
  });

  it("служба создаётся по требованию: serviceFor может её создать (асинхронно) — пачка отвечена ею", async () => {
    const storage = createInMemoryChatStorage();
    const chat = await abandonedBurst(storage);
    const clock = manualClock(ABANDONED_AT);
    const created: Array<ReturnType<typeof serviceWith>> = [];
    const serviceFor = async () => {
      await Promise.resolve();
      if (created.length === 0) created.push(serviceWith("Ты консультант старой версии.", storage, clock));
      return created[0]!.service;
    };
    const recovery = serviceWith("", storage, clock, { abandonedBursts: { serviceFor } });
    await recovery.service.recoverInterruptedAnswers({ soleServer: true });
    await vi.waitFor(() => expect(created[0]?.model.doStreamCalls).toHaveLength(1));
    await waitTurn(created[0]!.service, chat.id);
    expect(systemOf(created[0]!.model)).toContain("Ты консультант старой версии.");
    expect(recovery.model.doStreamCalls).toHaveLength(0);
  });

  it("регулярный обход тоже идёт через serviceFor", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const storage = createInMemoryChatStorage();
      await abandonedBurst(storage);
      const clock = manualClock(START);
      const version = serviceWith("Ты консультант версии.", storage, clock);
      const recovery = serviceWith("", storage, clock, { abandonedBursts: { serviceFor: () => version.service } });
      await recovery.service.recoverInterruptedAnswers();
      clock.set(ABANDONED_AT);
      await vi.advanceTimersByTimeAsync(STALE_ANSWERS_SWEEP_EVERY_MS);
      await vi.waitFor(() => expect(version.model.doStreamCalls).toHaveLength(1));
      expect(recovery.model.doStreamCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serviceFor упал: пачка не теряется — строка в журнал, следующий обход пробует снова", async () => {
    const storage = createInMemoryChatStorage();
    await abandonedBurst(storage);
    const clock = manualClock(ABANDONED_AT);
    const version = serviceWith("Ты консультант версии.", storage, clock);
    let fail = true;
    const recovery = serviceWith("", storage, clock, {
      abandonedBursts: {
        serviceFor: () => {
          if (fail) throw new Error("каталог версий недоступен");
          return version.service;
        },
      },
    });
    await recovery.service.tickBursts();
    await vi.waitFor(() => expect(recovery.logs.join("\n")).toMatch(/каталог версий недоступен/));
    fail = false;
    clock.set(ABANDONED_AT + BURST_HOLD_MS);
    await recovery.service.tickBursts();
    await vi.waitFor(() => expect(version.model.doStreamCalls).toHaveLength(1));
  });

  it("serviceFor вернул не службу SDK: пачка не отвечена чужой службой, строка в журнал", async () => {
    const storage = createInMemoryChatStorage();
    await abandonedBurst(storage);
    const recovery = serviceWith("", storage, manualClock(ABANDONED_AT), { abandonedBursts: { serviceFor: () => ({}) as ChatService } });
    await recovery.service.tickBursts();
    await vi.waitFor(() => expect(recovery.logs.join("\n")).toMatch(/не службу чата SDK/));
    expect(recovery.model.doStreamCalls).toHaveLength(0);
    expect(await pendingOf(storage)).toHaveLength(1);
  });
});
