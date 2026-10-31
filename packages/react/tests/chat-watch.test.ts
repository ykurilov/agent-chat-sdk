import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchChat } from "../src/chat-watch/chat-watch";
import type { ChatWatchEvent } from "../src/chat-watch/chat-watch";
import { sseStream } from "./support/fake-chat-server";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

/** Сервер событий: каждый `GET` отдаёт новый поток или ответ из `answers` по очереди. */
function fakeWatchServer(answers: Array<"stream" | number | "down"> = []) {
  const streams: Array<ReturnType<typeof sseStream>> = [];
  const signals: Array<AbortSignal | undefined> = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    signals.push(init?.signal ?? undefined);
    const answer = answers.shift() ?? "stream";
    if (answer === "down") throw new TypeError("Failed to fetch");
    if (typeof answer === "number") return new Response(null, { status: answer });
    const stream = sseStream({ signal: init?.signal ?? null });
    streams.push(stream);
    return stream.response();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch.mock.calls, streams, signals };
}

function start(server: ReturnType<typeof fakeWatchServer>, options: { silenceTimeoutMs?: number } = {}) {
  const events: ChatWatchEvent[] = [];
  const onOpen = vi.fn();
  const controller = new AbortController();
  const done = watchChat({
    url: "/api/chat/c1/watch",
    fetch: server.fetch,
    signal: controller.signal,
    delaysMs: [1000, 2000, 5000],
    silenceTimeoutMs: options.silenceTimeoutMs ?? 30_000,
    onOpen,
    onEvent: (event) => events.push(event),
  });
  return { events, onOpen, controller, done };
}

describe("watchChat: поток событий чата", () => {
  it("события из потока приходят по одному, пинги не события", async () => {
    const server = fakeWatchServer();
    const watch = start(server);
    await settle();
    expect(server.calls[0]![0]).toBe("/api/chat/c1/watch");
    expect(watch.onOpen).toHaveBeenCalledTimes(1);
    server.streams[0]!.ping();
    server.streams[0]!.push({ type: "tasks-changed" });
    server.streams[0]!.push({ type: "turn-started", messageId: "n1", trigger: "notice", channel: "web" });
    await settle();
    expect(watch.events).toEqual([{ type: "tasks-changed" }, { type: "turn-started", messageId: "n1", trigger: "notice", channel: "web" }]);
    watch.controller.abort();
  });

  it("адреса нет (404): подписка заканчивается без повторов", async () => {
    const server = fakeWatchServer([404]);
    const watch = start(server);
    await expect(watch.done).resolves.toBe("unavailable");
    await settle(60_000);
    expect(server.calls).toHaveLength(1);
  });

  it.each([401, 403])("доступ закрыт (%i): подписка не заканчивается, повтор через минуту — вход могли восстановить", async (status) => {
    const server = fakeWatchServer([status, status, "stream"]);
    const watch = start(server);
    let ended = false;
    void watch.done.then(() => (ended = true));
    await settle(59_999);
    expect(server.calls).toHaveLength(1);
    expect(ended).toBe(false);
    await settle(1);
    expect(server.calls).toHaveLength(2);
    await settle(60_000);
    expect(server.calls).toHaveLength(3);
    expect(watch.onOpen).toHaveBeenCalledTimes(1);
    watch.controller.abort();
    await expect(watch.done).resolves.toBe("stopped");
  });

  it("обрыв потока: переподключение с паузой, паузы растут, после удачного подключения начинаются сначала", async () => {
    const server = fakeWatchServer(["stream", "down", "down", "stream"]);
    const watch = start(server);
    await settle();
    server.streams[0]!.break();
    await settle(999);
    expect(server.calls).toHaveLength(1);
    await settle(1);
    expect(server.calls).toHaveLength(2);
    await settle(1999);
    expect(server.calls).toHaveLength(2);
    await settle(1);
    expect(server.calls).toHaveLength(3);
    await settle(5000);
    expect(server.calls).toHaveLength(4);
    expect(watch.onOpen).toHaveBeenCalledTimes(2);
    server.streams[1]!.end();
    await settle(1000);
    expect(server.calls).toHaveLength(5);
    watch.controller.abort();
  });

  it("сервер ответил 500: тоже повтор после паузы", async () => {
    const server = fakeWatchServer([500]);
    const watch = start(server);
    await settle(1000);
    expect(server.calls).toHaveLength(2);
    watch.controller.abort();
  });

  it("тишина дольше срока: поток закрывается и открывается заново", async () => {
    const server = fakeWatchServer();
    const watch = start(server, { silenceTimeoutMs: 30_000 });
    await settle();
    await settle(20_000);
    server.streams[0]!.ping();
    await settle(20_000);
    expect(server.calls).toHaveLength(1);
    await settle(10_000);
    expect(server.signals[0]!.aborted).toBe(true);
    await settle(1000);
    expect(server.calls).toHaveLength(2);
    watch.controller.abort();
  });

  it("отмена закрывает поток и больше не подключается", async () => {
    const server = fakeWatchServer();
    const watch = start(server);
    await settle();
    watch.controller.abort();
    await expect(watch.done).resolves.toBe("stopped");
    expect(server.signals[0]!.aborted).toBe(true);
    await settle(60_000);
    expect(server.calls).toHaveLength(1);
  });

  it("битая строка в потоке пропускается, следующие события доходят", async () => {
    const server = fakeWatchServer();
    const watch = start(server);
    await settle();
    const stream = server.streams[0]!;
    (stream as unknown as { push: (chunk: unknown) => void }).push("не json" as unknown as Record<string, unknown>);
    stream.push({ type: "tasks-changed" });
    await settle();
    expect(watch.events).toEqual([{ type: "tasks-changed" }]);
    watch.controller.abort();
  });
});

describe("watchChat: сервер без подписки", () => {
  it("ответ не поток событий (страница, JSON) — подписка заканчивается без повторов", async () => {
    const fetch = vi.fn(async () => Response.json([])) as unknown as typeof globalThis.fetch;
    const done = watchChat({ url: "/w", fetch, signal: new AbortController().signal, delaysMs: [1000], silenceTimeoutMs: 30_000, onEvent: vi.fn() });
    await expect(done).resolves.toBe("unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("times out a watch whose response headers never arrive", async () => {
  let attempts = 0;
  const controller = new AbortController();
  const fetch = async (_url: string, init?: RequestInit) => {
    attempts++;
    return await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  const done = watchChat({ url: "/watch", fetch, signal: controller.signal, delaysMs: [10], silenceTimeoutMs: 100, onEvent: () => {} });
  await settle(111);
  expect(attempts).toBe(2);
  controller.abort();
  await done;
});

it("does not report a late watch opening after its chat was left", async () => {
  const controller = new AbortController();
  let release!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; });
  const onOpen = vi.fn();
  const done = watchChat({ url: "/watch", fetch: async () => response, signal: controller.signal, delaysMs: [10], silenceTimeoutMs: 100, onOpen, onEvent: () => {} });
  controller.abort();
  release(new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } }));
  await done;
  expect(onOpen).not.toHaveBeenCalled();
});
