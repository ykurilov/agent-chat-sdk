import { afterEach, describe, expect, it, vi } from "vitest";
import { pause } from "../src/pause";

afterEach(() => {
  vi.useRealTimers();
});

describe("pause: пауза, которую можно оборвать", () => {
  it("сотня пауз на одном сигнале не оставляет на нём слушателей", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    for (let index = 0; index < 100; index++) {
      const waiting = pause(20, controller.signal);
      await vi.advanceTimersByTimeAsync(20);
      await waiting;
    }
    expect(added).toHaveBeenCalledTimes(100);
    expect(removed).toHaveBeenCalledTimes(100);
  });

  it("отмена обрывает паузу сразу; уже отменённый сигнал — пауза без ожидания", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let done = false;
    const waiting = pause(10_000, controller.signal).then(() => (done = true));
    controller.abort();
    await waiting;
    expect(done).toBe(true);
    await pause(10_000, controller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });
});
