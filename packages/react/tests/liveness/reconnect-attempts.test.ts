import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReconnectAttempts } from "../../src/liveness/reconnect-attempts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settings = { delaysMs: [0, 2000, 5000], attemptTimeoutMs: 10_000 } as const;

/** Попытка, которая ждёт `signal` и записывает время старта. */
function recorder(behaviour: (index: number, signal: AbortSignal) => Promise<boolean>) {
  const startedAt: number[] = [];
  const t0 = Date.now();
  const attempt = vi.fn((signal: AbortSignal, index: number) => {
    startedAt.push(Date.now() - t0);
    return behaviour(index, signal);
  });
  return { attempt, startedAt };
}

const hangUntilAborted = (signal: AbortSignal) =>
  new Promise<boolean>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });

describe("серия попыток переподключения", () => {
  it("паузы перед попытками 0, 2000 и 5000 мс", async () => {
    const { attempt, startedAt } = recorder(async () => false);
    const outcome = runReconnectAttempts({ ...settings, attempt, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe("exhausted");
    expect(startedAt).toEqual([0, 2000, 7000]);
  });

  it("удачная попытка останавливает серию", async () => {
    const { attempt } = recorder(async (index) => index === 1);
    const outcome = runReconnectAttempts({ ...settings, attempt, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe("connected");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("попытка, которая бросила ошибку, считается неудачной", async () => {
    const { attempt } = recorder(async (index) => {
      if (index < 2) throw new Error("сбой");
      return true;
    });
    const outcome = runReconnectAttempts({ ...settings, attempt, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe("connected");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("у попытки целиком срок 10 000 мс: сигнал попытки отменяется", async () => {
    const seen: AbortSignal[] = [];
    const { attempt, startedAt } = recorder((_index, signal) => {
      seen.push(signal);
      return hangUntilAborted(signal);
    });
    const t0 = Date.now();
    let exhaustedAt = -1;
    const outcome = runReconnectAttempts({ ...settings, attempt, signal: new AbortController().signal }).then((result) => {
      exhaustedAt = Date.now() - t0;
      return result;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(seen[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toBe("exhausted");
    expect(startedAt).toEqual([0, 12_000, 27_000]);
    // Молчащий сервер: серия кончается через 37 с после первой попытки.
    expect(exhaustedAt).toBe(37_000);
  });

  it("попытка, которая не смотрит на сигнал, всё равно кончается по сроку", async () => {
    const { attempt } = recorder(() => new Promise<boolean>(() => {}));
    const outcome = runReconnectAttempts({ ...settings, attempt, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toBe("exhausted");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("отмена во время паузы прерывает серию", async () => {
    const cancel = new AbortController();
    const { attempt } = recorder(async () => false);
    const outcome = runReconnectAttempts({ ...settings, attempt, signal: cancel.signal });
    await vi.advanceTimersByTimeAsync(1_000);
    cancel.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("отмена во время попытки отменяет и её сигнал", async () => {
    const cancel = new AbortController();
    const seen: AbortSignal[] = [];
    const { attempt } = recorder((_index, signal) => {
      seen.push(signal);
      return hangUntilAborted(signal);
    });
    const outcome = runReconnectAttempts({ ...settings, attempt, signal: cancel.signal });
    await vi.advanceTimersByTimeAsync(3_000);
    cancel.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toBe("cancelled");
    expect(seen[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("сигнал уже отменён — ни одной попытки", async () => {
    const cancel = new AbortController();
    cancel.abort();
    const { attempt } = recorder(async () => true);
    expect(await runReconnectAttempts({ ...settings, attempt, signal: cancel.signal })).toBe("cancelled");
    expect(attempt).not.toHaveBeenCalled();
  });
});
