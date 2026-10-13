import { describe, expect, it, vi } from "vitest";
import { createSandboxJournal, QUEUE_LIMIT } from "../../src/journal/journal";
import type { JournalStore } from "../../src/journal/journal-store";
import { createMemoryJournalStore } from "../../src/journal/memory-journal";
import { modelCallEvent, toolCallEvent } from "./support/events";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Хранилище, которое отвечает на запись не сразу. */
function slowStore(delayMs: number): { store: JournalStore; saved: () => number } {
  const inner = createMemoryJournalStore();
  let saved = 0;
  return {
    saved: () => saved,
    store: {
      ...inner,
      async saveModelCall(row, blobs) {
        await sleep(delayMs);
        await inner.saveModelCall(row, blobs);
        saved += 1;
      },
      async saveToolCall(row, blobs) {
        await sleep(delayMs);
        await inner.saveToolCall(row, blobs);
        saved += 1;
      },
    },
  };
}

describe("очередь записи журнала", () => {
  it("enqueue возвращается сразу, даже если хранилище отвечает 500 мс (SC-004)", async () => {
    const { store, saved } = slowStore(500);
    const journal = createSandboxJournal(store, { env: {} });
    const event = modelCallEvent();
    const started = performance.now();
    for (let index = 0; index < 20; index += 1) journal.enqueueModelCall(modelCallEvent());
    journal.enqueueToolCall(toolCallEvent());
    journal.enqueueModelCall(event);
    const perCall = (performance.now() - started) / 22;
    expect(perCall).toBeLessThan(5);
    expect(saved()).toBe(0);
    await journal.flush();
    expect(saved()).toBe(22);
  }, 30_000);

  it("разбор идёт в следующей задаче, а не внутри enqueue", async () => {
    const inner = createMemoryJournalStore();
    const spy = vi.spyOn(inner, "saveModelCall");
    const journal = createSandboxJournal(inner, { env: {} });
    journal.enqueueModelCall(modelCallEvent());
    expect(spy).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    await journal.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("при переполнении события пропускаются, об этом пишется в logError, остальные сохраняются", async () => {
    const inner = createMemoryJournalStore();
    const logError = vi.fn();
    const journal = createSandboxJournal(inner, { env: {}, logError });
    const chatId = "overflow-chat";
    for (let index = 0; index < QUEUE_LIMIT + 5; index += 1) journal.enqueueModelCall(modelCallEvent({ chatId, startedAt: new Date(2026, 9, 1, 0, 0, index) }));
    await journal.flush();
    expect(logError).toHaveBeenCalled();
    expect(logError.mock.calls.map(([message]) => String(message)).join("\n")).toContain("переполн");
    expect(await journal.listForChat(chatId)).toHaveLength(QUEUE_LIMIT);
    // Очередь заполняется до предела: при полном прогоне под нагрузкой 5 с по умолчанию не хватает.
  }, 30_000);

  it("сбой записи уходит в logError, очередь продолжает работать", async () => {
    const inner = createMemoryJournalStore();
    let first = true;
    const store: JournalStore = {
      ...inner,
      async saveModelCall(row, blobs) {
        if (first) {
          first = false;
          throw new Error("диск полон");
        }
        await inner.saveModelCall(row, blobs);
      },
    };
    const logError = vi.fn();
    const journal = createSandboxJournal(store, { env: {}, logError });
    journal.enqueueModelCall(modelCallEvent({ chatId: "c" }));
    journal.enqueueModelCall(modelCallEvent({ chatId: "c" }));
    await journal.flush();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0]?.[0])).toContain("диск полон");
    expect(await journal.listForChat("c")).toHaveLength(1);
  });

  it("flush ждёт записи; без событий возвращается сразу", async () => {
    const { store, saved } = slowStore(50);
    const journal = createSandboxJournal(store, { env: {} });
    await journal.flush();
    journal.enqueueModelCall(modelCallEvent());
    await journal.flush();
    expect(saved()).toBe(1);
  });

  it("чтение видит то, что уже в очереди, без явного flush", async () => {
    const journal = createSandboxJournal(createMemoryJournalStore(), { env: {} });
    journal.enqueueModelCall(modelCallEvent({ chatId: "read-chat" }));
    expect(await journal.listForChat("read-chat")).toHaveLength(1);
  });

  it("close дописывает очередь и закрывает хранилище", async () => {
    const inner = createMemoryJournalStore();
    const close = vi.spyOn(inner, "close");
    const spy = vi.spyOn(inner, "saveModelCall");
    const journal = createSandboxJournal(inner, { env: {} });
    journal.enqueueModelCall(modelCallEvent());
    await journal.close();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ошибка в разборе одного события не роняет остальные", async () => {
    const logError = vi.fn();
    const journal = createSandboxJournal(createMemoryJournalStore(), { env: {}, logError });
    const broken = modelCallEvent({ chatId: "broken" });
    Object.defineProperty(broken, "request", {
      get() {
        throw new Error("не читается");
      },
    });
    journal.enqueueModelCall(broken);
    journal.enqueueModelCall(modelCallEvent({ chatId: "broken" }));
    await journal.flush();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(await journal.listForChat("broken")).toHaveLength(1);
  });
});
