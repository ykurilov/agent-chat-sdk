import { describe, expect, it, vi } from "vitest";
import { STOP_REQUESTS_PER_OWNER, createStopRequests } from "../../../src/running-answers/stop-requests";
import type { ChatStorage } from "../../../src/storage/chat-storage";

/** Память копии без хранилища «Стопов»: предел держит сама копия. */
const withoutStorage = () => createStopRequests({ storage: {} as ChatStorage, now: () => new Date("2026-01-01T10:00:00.000Z"), logError: () => {} });

describe("«Стопы» в памяти копии: предел на человека", () => {
  it("поток «Стопов» одного человека вытесняет только его же старые; чужой ранний «Стоп» остаётся", async () => {
    const stops = withoutStorage();
    await stops.remember("boris", "chat-b", "b1");
    for (let index = 0; index <= STOP_REQUESTS_PER_OWNER; index++) await stops.remember("anna", "chat-a", `a${index}`);

    const borisStopped = vi.fn();
    stops.watch("chat-b", "b1", borisStopped);
    expect(borisStopped).toHaveBeenCalledTimes(1);

    const oldest = vi.fn();
    stops.watch("chat-a", "a0", oldest)();
    expect(oldest).not.toHaveBeenCalled();
    const newest = vi.fn();
    stops.watch("chat-a", `a${STOP_REQUESTS_PER_OWNER}`, newest);
    expect(newest).toHaveBeenCalledTimes(1);
  });
});
