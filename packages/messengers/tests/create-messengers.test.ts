import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMessengers, MESSENGER_RECORDS_KEEP_MS } from "../src/create-messengers";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { MessengersOptions } from "../src/types";
import { createFakeAdapter } from "./support/fake-adapter";
import { createFakeChatService } from "./support/fake-chat-service";

const NOW = Date.UTC(2026, 9, 7, 12, 0);
const HOUR = 60 * 60_000;

function setup() {
  const store = createMemoryMessengerStore();
  const purges: string[] = [];
  const purgeBefore = store.purgeBefore.bind(store);
  store.purgeBefore = async (before) => {
    purges.push(before);
    await purgeBefore(before);
  };
  const messengers = createMessengers({
    store,
    service: createFakeChatService().service,
    resolveUser: async () => null,
    bots: [createFakeAdapter().bot()],
    basePath: "/api/messengers",
  } as MessengersOptions);
  return { store, purges, messengers };
}

describe("уборка старых записей", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("при запуске и потом раз в час убирает записи старше срока хранения; после остановки — нет", async () => {
    const { purges, messengers } = setup();
    await messengers.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(purges).toEqual([new Date(NOW - MESSENGER_RECORDS_KEEP_MS).toISOString()]);
    await vi.advanceTimersByTimeAsync(HOUR / 2);
    expect(purges).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(HOUR / 2);
    expect(purges).toHaveLength(2);
    expect(purges[1]).toBe(new Date(NOW + HOUR - MESSENGER_RECORDS_KEEP_MS).toISOString());
    await messengers.stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(purges).toHaveLength(2);
  });

  it("срок хранения длиннее суток: повтор обновления от мессенджера и брошенная обработка ещё узнаются", () => {
    expect(MESSENGER_RECORDS_KEEP_MS).toBeGreaterThan(24 * HOUR);
  });
});
