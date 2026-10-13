// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionSilentError } from "../../src/liveness/connection-errors";
import { effectiveSilenceTimeoutMs, watchSilence } from "../../src/liveness/silence-watchdog";

const encoder = new TextEncoder();

/** Тело ответа, которое тест кормит вручную; помнит, отменили ли его. */
function manualBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    body,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    wasCancelled: () => cancelled,
  };
}

/** Читает поток в фоне и отмечает, когда он оборвался ошибкой. */
function drain(stream: ReadableStream<Uint8Array>) {
  const result = { text: "", error: undefined as unknown, done: false };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        result.text += decoder.decode(value);
      }
    } catch (error) {
      result.error = error;
    }
    result.done = true;
  })();
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("сторож тишины", () => {
  it("любой байт, включая пинг, сбрасывает тишину", async () => {
    const source = manualBody();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000 }));
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      source.push(": ping\n\n");
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toBeUndefined();
    expect(seen.text).toBe(": ping\n\n".repeat(6));
  });

  it("тишина дольше срока обрывает поток ошибкой ConnectionSilentError и отменяет исходное соединение", async () => {
    const source = manualBody();
    const onSilence = vi.fn();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000, onSilence }));
    source.push("data: {}\n\n");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(seen.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.error).toBeInstanceOf(ConnectionSilentError);
    expect(source.wasCancelled()).toBe(true);
    expect(onSilence).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("зависание замечается через 30 с ± 2 с от последнего байта (SC-005)", async () => {
    const source = manualBody();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000 }));
    await vi.advanceTimersByTimeAsync(7_300);
    source.push("data: {}\n\n");
    const lastByteAt = Date.now();
    let noticedAfter = -1;
    for (let elapsed = 100; elapsed <= 40_000; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
      if (seen.error !== undefined) {
        noticedAfter = Date.now() - lastByteAt;
        break;
      }
    }
    expect(noticedAfter).toBeGreaterThanOrEqual(30_000);
    expect(noticedAfter).toBeLessThanOrEqual(32_000);
  });

  it("действующий срок — не меньше трёх пингов сервера (FR-017)", () => {
    expect(effectiveSilenceTimeoutMs(30_000, 0)).toBe(30_000);
    expect(effectiveSilenceTimeoutMs(30_000, 10_000)).toBe(30_000);
    expect(effectiveSilenceTimeoutMs(30_000, 15_000)).toBe(45_000);
    expect(effectiveSilenceTimeoutMs(5_000, 10_000)).toBe(30_000);
  });

  it("до первого байта действует свой, более короткий срок", async () => {
    const source = manualBody();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000, firstByteTimeoutMs: 10_000 }));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(seen.error).toBeInstanceOf(ConnectionSilentError);
  });

  it("после первого байта первый срок не действует", async () => {
    const source = manualBody();
    const onFirstByte = vi.fn();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000, firstByteTimeoutMs: 10_000, onFirstByte }));
    await vi.advanceTimersByTimeAsync(5_000);
    source.push(": ping\n\n");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onFirstByte).toHaveBeenCalledTimes(1);
    expect(seen.error).toBeUndefined();
  });

  it("visibilitychange при тишине не меньше срока рвёт поток сразу, не дожидаясь таймера", async () => {
    const source = manualBody();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000 }));
    // Фоновая вкладка: таймеры спят, а часы идут (телефон заснул).
    vi.setSystemTime(Date.now() + 120_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toBeInstanceOf(ConnectionSilentError);
  });

  it("поздний таймер фоновой вкладки не рвёт поток, если байты шли", async () => {
    const source = manualBody();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    source.push(": ping\n\n");
    // Таймер проснулся сильно позже, но байт был недавно.
    vi.setSystemTime(Date.now() + 25_000);
    source.push(": ping\n\n");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.error).toBeUndefined();
  });

  it("событие online при тишине не меньше срока рвёт поток сразу", async () => {
    const source = manualBody();
    const seen = drain(watchSilence(source.body, { silenceTimeoutMs: 30_000 }));
    vi.setSystemTime(Date.now() + 31_000);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toBeInstanceOf(ConnectionSilentError);
  });

  it("конец потока и отмена чтения снимают таймер и слушателей", async () => {
    const ended = manualBody();
    const endedSeen = drain(watchSilence(ended.body, { silenceTimeoutMs: 30_000 }));
    ended.push("a");
    ended.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(endedSeen.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const cancelledSource = manualBody();
    const reader = watchSilence(cancelledSource.body, { silenceTimeoutMs: 30_000 }).getReader();
    await reader.cancel();
    expect(cancelledSource.wasCancelled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ошибка исходного потока доходит как есть", async () => {
    let fail!: (error: unknown) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        fail = (error) => controller.error(error);
      },
    });
    const seen = drain(watchSilence(body, { silenceTimeoutMs: 30_000 }));
    const boom = new Error("сбой");
    fail(boom);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });
});
