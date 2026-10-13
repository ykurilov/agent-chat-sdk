import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundUpdate } from "../src/messenger-adapter";
import { POLL_LEASE_MS, POLL_RENEW_MS, startPolling } from "../src/polling-lease";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { MessengerStore } from "../src/types";
import { createFakeAdapter, update } from "./support/fake-adapter";

const NOW = Date.UTC(2026, 9, 5, 12, 0);

/** Хранилище копии сервера: общее, но связь с базой можно «уронить» или «заморозить». */
function copyStore(shared: MessengerStore) {
  const state = { mode: "ok" as "ok" | "down" | "hang" | "lost" };
  const store: MessengerStore = {
    ...shared,
    acquireLease: async (...args) => {
      if (state.mode === "down") throw new Error("db down");
      if (state.mode === "hang") return new Promise<boolean>(() => {});
      if (state.mode === "lost") return false;
      return shared.acquireLease(...args);
    },
  };
  return { store, state };
}

function copy(shared: MessengerStore, options: { holder?: string; leaseMs?: number; renewMs?: number } = {}) {
  const fake = createFakeAdapter();
  const { store, state } = copyStore(shared);
  const received: InboundUpdate[] = [];
  const errors: unknown[] = [];
  const polling = startPolling({
    store,
    bot: fake.bot({ receive: "polling" }),
    onUpdate: (item) => {
      received.push(item);
    },
    logError: (error) => errors.push(error),
    ...options,
  });
  return { fake, state, received, errors, polling };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("аренда опроса", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("по умолчанию аренда 30 с и продление раз в 10 с", () => {
    expect(POLL_LEASE_MS).toBe(30_000);
    expect(POLL_RENEW_MS).toBe(10_000);
  });

  it("опрашивает одна копия; обновления уходят в приём; живая копия держит аренду сколько угодно", async () => {
    const shared = createMemoryMessengerStore();
    const a = copy(shared);
    await settle();
    const b = copy(shared);
    await settle();
    expect(a.fake.polling).toBe(1);
    expect(b.fake.polling).toBe(0);

    const incoming = update({ text: "Привет" });
    a.fake.pushPoll(incoming);
    await settle();
    expect(a.received).toEqual([incoming]);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(a.fake.polling).toBe(1);
    expect(b.fake.polling).toBe(0);
    await a.polling.stop();
    await b.polling.stop();
  });

  it("копия упала (база недоступна) — бросает опрос заранее, другая перехватывает после истечения аренды", async () => {
    const shared = createMemoryMessengerStore();
    const a = copy(shared, { holder: "copy-a" });
    await settle();
    const b = copy(shared, { holder: "copy-b" });
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    a.state.mode = "down";

    // Продление в 10 с не прошло, аренда до 30 с: в 20 с копия бросает опрос, не дожидаясь конца аренды.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(a.fake.polling).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.fake.polling).toBe(0);
    expect(a.errors.length).toBeGreaterThan(0);

    // Аренда до 30 с: раньше её никто не берёт.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(b.fake.polling).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.fake.polling).toBe(1);

    // База вернулась — упавшая копия ждёт, аренда у другой.
    a.state.mode = "ok";
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.fake.polling).toBe(0);
    expect(b.fake.polling).toBe(1);
    await a.polling.stop();
    await b.polling.stop();
  });

  it("продление зависло — опрос брошен так же; аренду забрали — опрос брошен сразу", async () => {
    const hung = copy(createMemoryMessengerStore());
    await settle();
    hung.state.mode = "hang";
    await vi.advanceTimersByTimeAsync(19_999);
    expect(hung.fake.polling).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(hung.fake.polling).toBe(0);
    // Зависшая база не держит остановку.
    await hung.polling.stop();

    const lost = copy(createMemoryMessengerStore());
    await settle();
    lost.state.mode = "lost";
    await vi.advanceTimersByTimeAsync(POLL_RENEW_MS);
    expect(lost.fake.polling).toBe(0);
    await lost.polling.stop();
  });

  it("остановка отпускает аренду: другая копия берёт её на ближайшей попытке, не через 30 с", async () => {
    const shared = createMemoryMessengerStore();
    const a = copy(shared);
    await settle();
    const b = copy(shared);
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await a.polling.stop();
    expect(a.fake.polling).toBe(0);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(b.fake.polling).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.fake.polling).toBe(1);
    await b.polling.stop();
    expect(b.fake.polling).toBe(0);
  });

  it("leaseMs и renewMs приложения", async () => {
    const shared = createMemoryMessengerStore();
    const a = copy(shared, { leaseMs: 6_000, renewMs: 2_000 });
    await settle();
    const b = copy(shared, { leaseMs: 6_000, renewMs: 2_000 });
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    a.state.mode = "down";
    await vi.advanceTimersByTimeAsync(3_000);
    expect(a.fake.polling).toBe(0);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(b.fake.polling).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.fake.polling).toBe(1);
    await a.polling.stop();
    await b.polling.stop();
  });

  it("сбой опроса — в журнал, опрос продолжается; сбой приёма (база недоступна) — то же обновление снова после растущей паузы, следующее его не обгоняет", async () => {
    const shared = createMemoryMessengerStore();
    const fake = createFakeAdapter();
    const original = fake.adapter.poll.bind(fake.adapter);
    let calls = 0;
    fake.adapter.poll = (signal) => {
      calls++;
      if (calls === 1) {
        return (async function* () {
          throw new Error("network");
        })();
      }
      return original(signal);
    };
    const errors: unknown[] = [];
    const received: string[] = [];
    let failures = 2;
    const polling = startPolling({
      store: shared,
      bot: fake.bot({ receive: "polling" }),
      onUpdate: async (item) => {
        if (item.text === "сломай" && failures-- > 0) throw new Error("db down");
        received.push(item.text ?? "");
      },
      logError: (error) => errors.push(error),
    });
    await settle();
    expect(errors).toEqual([new Error("network")]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.polling).toBe(1);
    fake.pushPoll(update({ text: "сломай" }));
    fake.pushPoll(update({ text: "дальше" }));
    await settle();
    expect(received).toEqual([]);
    expect(errors).toEqual([new Error("network"), new Error("db down")]);
    // Паузы 1 с, потом 2 с.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(received).toEqual([]);
    expect(errors).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(received).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(received).toEqual(["сломай", "дальше"]);
    expect(errors).toEqual([new Error("network"), new Error("db down"), new Error("db down")]);
    await polling.stop();
  });
});
