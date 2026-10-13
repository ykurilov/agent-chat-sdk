// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionLostError } from "../../src/liveness/connection-errors";
import { fetchWithDeadline } from "../../src/liveness/request-deadline";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** `fetch`, который висит, пока его не отменят. */
const hangingFetch = vi.fn(
  (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")));
    }),
);

/** Сколько слушателей `abort` сейчас висит на сигнале. */
function trackAbortListeners(signal: AbortSignal): () => number {
  const active = new Set<unknown>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    if (type === "abort") active.add(listener);
    add(type, listener, options as AddEventListenerOptions);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    if (type === "abort") active.delete(listener);
    remove(type, listener, options as EventListenerOptions);
  }) as typeof signal.removeEventListener;
  return () => active.size;
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("сроки запросов", () => {
  it("срок истёк — ConnectionLostError, а не AbortError и не TypeError", async () => {
    const outcome = catchError(fetchWithDeadline(hangingFetch, "/api/chat/c1", undefined, { timeoutMs: 10_000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(ConnectionLostError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).name).toBe("ConnectionLostError");
  });

  it("срок истёк, даже если fetch не смотрит на сигнал", async () => {
    const deaf = vi.fn(() => new Promise<Response>(() => {}));
    const outcome = catchError(fetchWithDeadline(deaf, "/x", undefined, { timeoutMs: 10_000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBeInstanceOf(ConnectionLostError);
  });

  it("ответ пришёл вовремя — отдаётся как есть, таймер снят", async () => {
    const fetchFn = vi.fn(async () => new Response("тело", { status: 201 }));
    const response = await fetchWithDeadline(fetchFn, "/x", undefined, { timeoutMs: 10_000 });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("тело");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("сетевой TypeError при соединении — ConnectionLostError", async () => {
    const refusing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await catchError(fetchWithDeadline(refusing, "/x", undefined, { timeoutMs: 10_000 }))).toBeInstanceOf(
      ConnectionLostError,
    );
  });

  it("сетевой TypeError при чтении тела — ConnectionLostError (ловушка R9)", async () => {
    const breaking = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
        },
        pull(controller) {
          controller.error(new TypeError("network error"));
        },
      });
      return new Response(body);
    });
    const response = await fetchWithDeadline(breaking, "/x", undefined, { timeoutMs: 10_000 });
    const reader = response.body!.getReader();
    await reader.read();
    const error = await catchError(reader.read());
    expect(error).toBeInstanceOf(ConnectionLostError);
    expect(error).not.toBeInstanceOf(TypeError);
  });

  it("отмена пользователем остаётся AbortError", async () => {
    const user = new AbortController();
    const outcome = catchError(fetchWithDeadline(hangingFetch, "/x", { signal: user.signal }, { timeoutMs: 10_000 }));
    user.abort();
    await vi.advanceTimersByTimeAsync(0);
    const error = (await outcome) as Error;
    expect(error).not.toBeInstanceOf(ConnectionLostError);
    expect(error.name).toBe("AbortError");
  });

  it("сигнал попытки — своя отмена, это ConnectionLostError", async () => {
    const attempt = new AbortController();
    const outcome = catchError(fetchWithDeadline(hangingFetch, "/x", undefined, { timeoutMs: 10_000, signal: attempt.signal }));
    attempt.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toBeInstanceOf(ConnectionLostError);
  });

  it("срок можно распространить и на тело ответа", async () => {
    const slowBody = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
            },
          }),
        ),
    );
    const outcome = catchError(
      fetchWithDeadline(slowBody, "/x", undefined, { timeoutMs: 10_000, wholeBody: true }).then((response) => response.json()),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBeInstanceOf(ConnectionLostError);
  });

  it("без wholeBody срок кончается вместе с получением заголовков", async () => {
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(new Error("не должно сработать")));
            },
          }),
        ),
    );
    const response = await fetchWithDeadline(fetchFn, "/x", undefined, { timeoutMs: 10_000 });
    const reader = response.body!.getReader();
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(60_000);
    let settled = false;
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await reader.cancel();
  });

  it("отказ сервера с недочитанным телом не оставляет слушателей на сигналах", async () => {
    const user = new AbortController();
    const attempt = new AbortController();
    const active = [user.signal, attempt.signal].map(trackAbortListeners);
    const refusing = vi.fn(async () => new Response("сбой", { status: 500 }));
    const response = await fetchWithDeadline(refusing, "/x", { signal: user.signal }, { timeoutMs: 10_000, signal: attempt.signal });
    expect(response.status).toBe(500);
    // Тело никто не читает: ни конца, ни ошибки, ни cancel не будет.
    expect(active.map((count) => count())).toEqual([0, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
