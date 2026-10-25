import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ANSWER_STALE_AFTER_MS } from "../../../src/agent-run/answer-liveness";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

/** Модель: шаг 1 — вызов `slow`, шаг 2 — ответ текстом. */
function callThenAnswer() {
  const steps: LanguageModelV4StreamPart[][] = [
    [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "slow", input: "{}" }, finishPart("tool-calls")],
    [streamStart, ...textParts(["Готово."]), finishPart()],
  ];
  return new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(steps.shift()!) }) });
}

/** Инструмент, который думает `ms` по часам теста. */
const slowTool = (ms: number) => ({
  slow: tool({ description: "Долго", inputSchema: z.object({}), execute: () => new Promise<string>((resolve) => setTimeout(() => resolve("ок"), ms)) }),
});

const staleNow = (storage: ChatStorage) => storage.listSilentAnswerIds!({ silentForMs: ANSWER_STALE_AFTER_MS });

/** Хранилище, которое считает знаки жизни: полные записи со знаком и лёгкие отметки. */
function countingSigns(storage: ChatStorage) {
  const signs = { full: 0, light: 0 };
  const watched: ChatStorage = {
    ...storage,
    updateStreamingMessage: async (messageId, patch) => {
      if (patch.alive) signs.full += 1;
      await storage.updateStreamingMessage(messageId, patch);
    },
    markAnswerAlive: async (messageId) => {
      signs.light += 1;
      await storage.markAnswerAlive!(messageId);
    },
  };
  return { watched, signs };
}

describe("runAgentTurn: идущий ответ отмечает «жив» (FR-060)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-01T10:00:00.000Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("инструмент молчит 100 с, время ответа старое: ответ всё время живой, а после конца хода — законченный", async () => {
    const storage = await storageWithQuestion();
    const reading = readAll(
      startTurn(storage, callThenAnswer(), { tools: slowTool(100_000), toolTimeout: { forTool: () => Infinity }, createdAt: "2026-01-01T00:00:01.000Z" }),
    );
    for (let elapsed = 0; elapsed <= 100_000; elapsed += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await staleNow(storage)).toEqual([]);
    }
    await onFakeClock(() => reading);

    expect((await savedAnswer(storage))!.status).toBe("complete");
  });

  it("ход кончился — знаки жизни больше не пишутся: брошенный ответ становится старым", async () => {
    const { watched, signs } = countingSigns(await storageWithQuestion());
    await onFakeClock(() => readAll(startTurn(watched, callThenAnswer(), { tools: slowTool(25_000) })));
    const written = { ...signs };

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(written.full + written.light).toBeGreaterThan(0);
    expect(signs).toEqual(written);
  });

  it("в тишине пишется только лёгкая отметка «жив», а не весь ответ", async () => {
    const { watched, signs } = countingSigns(await storageWithQuestion());
    const reading = readAll(startTurn(watched, callThenAnswer(), { tools: slowTool(60_000), toolTimeout: { forTool: () => Infinity } }));
    await vi.advanceTimersByTimeAsync(5_000);
    const before = { ...signs };

    await vi.advanceTimersByTimeAsync(40_000);

    expect(signs.full).toBe(before.full);
    expect(signs.light - before.light).toBeGreaterThanOrEqual(7);
    await onFakeClock(() => reading);
  });

  it("хранилище без лёгкой отметки: знак жизни в тишине идёт полной записью", async () => {
    const { markAnswerAlive: _absent, ...older } = await storageWithQuestion();
    const { watched, signs } = countingSigns(older);
    const { markAnswerAlive: _counted, ...withoutMark } = watched;
    const reading = readAll(startTurn(withoutMark, callThenAnswer(), { tools: slowTool(60_000), toolTimeout: { forTool: () => Infinity } }));
    await vi.advanceTimersByTimeAsync(5_000);
    const before = signs.full;

    await vi.advanceTimersByTimeAsync(40_000);

    expect(signs.full - before).toBeGreaterThanOrEqual(7);
    expect(signs.light).toBe(0);
    await onFakeClock(() => reading);
  });

  it("запись в базу висит дольше 5 с — таймер знака жизни не крутится вхолостую, знак идёт после конца записи", async () => {
    const storage = await storageWithQuestion();
    let releaseWrite = () => {};
    let writes = 0;
    const hanging: ChatStorage = {
      ...storage,
      updateStreamingMessage: async (messageId, patch) => {
        writes += 1;
        // Первая промежуточная запись висит: связь с базой оборвалась без срока запроса.
        if (writes === 1) await new Promise<void>((resolve) => (releaseWrite = resolve));
        await storage.updateStreamingMessage(messageId, patch);
      },
    };
    const streamingText = new MockLanguageModelV4({ doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
        controller.enqueue(streamStart);
        controller.enqueue({ type: "text-start", id: "text" });
        controller.enqueue({ type: "text-delta", id: "text", delta: "Работаю" });
        setTimeout(() => {
          controller.enqueue({ type: "text-end", id: "text" });
          controller.enqueue(finishPart());
          controller.close();
        }, 60_000);
      } }),
    }) });
    // A hung text snapshot keeps the stream alive; a hung tool intent must instead refuse execution.
    void readAll(startTurn(hanging, streamingText)).catch(() => {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toBe(1);
    const timers = vi.spyOn(globalThis, "setTimeout");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(timers.mock.calls.length).toBeLessThan(10);

    releaseWrite();
    const signs = vi.fn();
    hanging.markAnswerAlive = async (messageId) => {
      signs();
      await storage.markAnswerAlive!(messageId);
    };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signs).toHaveBeenCalled();
    timers.mockRestore();
  });

  it("ход упал исключением до конечной записи — таймер знака жизни не остаётся", async () => {
    const { watched, signs } = countingSigns(await storageWithQuestion());
    const flushers = new Set<() => Promise<void>>();
    flushers.delete = () => {
      throw new Error("реестр сломан");
    };
    await expect(onFakeClock(() => readAll(startTurn(watched, callThenAnswer(), { tools: slowTool(0), flushers })))).rejects.toThrow("реестр сломан");
    const written = { ...signs };

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(signs).toEqual(written);
  });
});
