import { expect, it, vi } from "vitest";
import { createAnswerSaver } from "../../../src/agent-run/answer-saver";
import type { ChatStorage } from "../../../src/storage/chat-storage";

it("потеря аренды освобождает завершение ответа, даже если запись хранилища не вернулась", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const write = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const saver = createAnswerSaver({ updateStreamingMessage: write } as unknown as ChatStorage, "a1", () => ({}), () => null, () => {});
  try {
    saver.observe({ type: "start", messageId: "a1" });
    saver.observe({ type: "text-start", id: "t1" });
    saver.observe({ type: "text-delta", id: "t1", delta: "Начатый ответ" });
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(1);
    const lost = new AbortController();
    let finished = false;
    // На старой реализации лишний аргумент игнорируется: finish остаётся ждать write.
    const finish = saver.finish as (signal?: AbortSignal) => ReturnType<typeof saver.finish>;
    const done = finish(lost.signal).then((parts) => { finished = true; return parts; });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    lost.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
    expect(await done).toContainEqual(expect.objectContaining({ type: "text", text: "Начатый ответ" }));
  } finally {
    release?.();
    saver.stop();
    vi.useRealTimers();
  }
});
