import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishPart, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

/** Ход целиком, пока подменённые часы идут вперёд на `advanceMs`. */
async function runTurnWithClock(model: MockLanguageModelV4, advanceMs: number) {
  const storage = await storageWithQuestion();
  const reading = readAll(startTurn(storage, model));
  await vi.advanceTimersByTimeAsync(advanceMs);
  const chunks = await reading;
  const answer = await savedAnswer(storage);
  if (!answer) throw new Error("ответ не сохранён");
  return { chunks, answer };
}

describe("runAgentTurn: провайдер замолчал или прислал ошибку кусочком потока", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("модель написала текст и замолчала — через 120 с автопродолжение; error вида overloaded только после двух неудачных, текст сохранён (FR-022)", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        call++;
        const delta = `кусок ${call}. `;
        return {
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue(streamStart);
              controller.enqueue({ type: "text-start", id: "t" });
              controller.enqueue({ type: "text-delta", id: "t", delta });
              abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
            },
          }),
        };
      },
    });

    // Три срока тишины по 120 с и паузы автопродолжений (2 с и 5 с, плюс разброс до 25%).
    const { chunks, answer } = await runTurnWithClock(model, 3 * 120_000 + 2_500 + 6_250);

    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind: "overloaded" });
    expect(textOf(answer.parts)).toBe("кусок 1. кусок 2. кусок 3. ");
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "overloaded" }]);
    expect(model.doStreamCalls).toHaveLength(3);
  });

  it("модель замолчала, автопродолжение дописало ответ — complete (FR-022, US7)", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        call++;
        if (call === 2) return { stream: streamOf([streamStart, ...textParts(["конец."]), finishPart()]) };
        return {
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue(streamStart);
              controller.enqueue({ type: "text-start", id: "t" });
              controller.enqueue({ type: "text-delta", id: "t", delta: "Начало, " });
              abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
            },
          }),
        };
      },
    });

    const { chunks, answer } = await runTurnWithClock(model, 120_000 + 2_500);

    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("Начало, конец.");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("ошибка кусочком потока до первого куска — тихий повтор, ответ complete (сц. 1, SC-003: 20 из 20)", async () => {
    for (let run = 0; run < 20; run++) {
      let call = 0;
      const model = new MockLanguageModelV4({
        doStream: async () => {
          call++;
          const parts: LanguageModelV4StreamPart[] =
            call === 1
              ? [streamStart, { type: "error", error: { code: 502, message: "Provider returned error" } }]
              : [streamStart, ...textParts(["Готово"]), finishPart()];
          return { stream: streamOf(parts) };
        },
      });

      const { chunks, answer } = await runTurnWithClock(model, 1_250);

      expect(answer.status).toBe("complete");
      expect(textOf(answer.parts)).toBe("Готово");
      expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
      expect(model.doStreamCalls).toHaveLength(2);
    }
  });
});
