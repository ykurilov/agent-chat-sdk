import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeartbeatResponse } from "../src/heartbeat";

/** Источник частей ответа, который тест кормит вручную. */
function manualSource() {
  let controller!: ReadableStreamDefaultController<unknown>;
  let cancelled = false;
  const stream = new ReadableStream<unknown>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    push: (part: unknown) => controller.enqueue(part),
    end: () => controller.close(),
    fail: (error: unknown) => controller.error(error),
    wasCancelled: () => cancelled,
  };
}

const decoder = new TextDecoder();

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value, done } = await reader.read();
  if (done) throw new Error("поток закончился раньше времени");
  return decoder.decode(value);
}

describe("createHeartbeatResponse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("отдаёт заголовки потока SDK и срок между пингами", () => {
    const source = manualSource();
    const response = createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 10_000 });
    for (const [name, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get("x-agent-chat-heartbeat-ms")).toBe("10000");
  });

  it("шлёт первый пинг сразу, дальше по одному каждые heartbeatIntervalMs", async () => {
    const source = manualSource();
    const reader = createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 10_000 }).body!.getReader();
    expect(await readChunk(reader)).toBe(": ping\n\n");
    const second = readChunk(reader);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await second).toBe(": ping\n\n");
    const third = readChunk(reader);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await third).toBe(": ping\n\n");
    await reader.cancel();
  });

  it("части ответа идут как события, пинг стоит только между целыми событиями", async () => {
    const source = manualSource();
    const reader = createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 1000 }).body!.getReader();
    source.push({ type: "start" });
    source.push({ type: "text-delta", id: "t", delta: "Привет: мир\n\nещё" });
    await vi.advanceTimersByTimeAsync(3500);
    source.push({ type: "finish" });
    source.end();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    const blocks = text.split("\n\n").filter((block) => block.length > 0);
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks) {
      if (block === ": ping") continue;
      expect(block.startsWith("data: ")).toBe(true);
      const payload = block.slice("data: ".length);
      if (payload !== "[DONE]") expect(() => JSON.parse(payload)).not.toThrow();
    }
    expect(blocks.filter((block) => block !== ": ping").map((block) => block.slice(6))).toEqual([
      JSON.stringify({ type: "start" }),
      JSON.stringify({ type: "text-delta", id: "t", delta: "Привет: мир\n\nещё" }),
      JSON.stringify({ type: "finish" }),
      "[DONE]",
    ]);
  });

  it("конец источника останавливает таймер, пингов больше нет", async () => {
    const source = manualSource();
    const reader = createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 1000 }).body!.getReader();
    await readChunk(reader);
    source.end();
    expect(await readChunk(reader)).toBe("data: [DONE]\n\n");
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("отмена чтения отменяет источник и снимает таймер", async () => {
    const source = manualSource();
    const reader = createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 1000 }).body!.getReader();
    await readChunk(reader);
    await reader.cancel();
    expect(source.wasCancelled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("после отмены висящее чтение не закрывает отменённый поток", async () => {
    const source = manualSource();
    const close = vi.spyOn(ReadableStreamDefaultController.prototype, "close");
    try {
      const reader = createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 1000 }).body!.getReader();
      await readChunk(reader); // пинг прочитан: поток просит следующее событие и ждёт его
      await vi.advanceTimersByTimeAsync(0);
      close.mockClear();
      await reader.cancel();
      await vi.advanceTimersByTimeAsync(0);
      expect(close).not.toHaveBeenCalled();
    } finally {
      close.mockRestore();
    }
  });

  it("ошибка источника доходит до читателя, таймер снят", async () => {
    const source = manualSource();
    const reader = createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 1000 }).body!.getReader();
    await readChunk(reader);
    source.fail(new Error("сбой"));
    await expect(reader.read()).rejects.toThrow("сбой");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("срок меньше 1000 мс — ошибка", () => {
    const source = manualSource();
    expect(() => createHeartbeatResponse({ stream: source.stream, heartbeatIntervalMs: 999 })).toThrow(/1000/);
  });
});
