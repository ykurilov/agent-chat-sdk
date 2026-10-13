import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HANGING_TOOL_CALL_REASON } from "../../../src/tool-approval/approval-parts";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

function providerError(statusCode: number): APICallError {
  return new APICallError({
    message: `ответ ${statusCode}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: "Provider returned error",
  });
}

const callPart = (id: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: "send", input: JSON.stringify({ to: id }) });
/** Шаг: текст и вызов `send`, затем модель молчит, пока ход не оборвёт её сроком тишины. */
const callThenSilence = (id: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts(["Отправляю. "]), callPart(id)];
/** Шаг: начало текста и сбой провайдера посреди ответа. */
const textThenFailure = (statusCode: number): LanguageModelV4StreamPart[] => [
  streamStart,
  ...textParts(["Начинаю ответ. "]),
  { type: "error", error: providerError(statusCode) },
];
const answerText = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Модель по сценарию: поток из `callThenSilence` после своих кусков молчит, пока запрос не отменят. */
function scriptedModel(script: Array<{ parts: LanguageModelV4StreamPart[]; silentAfter?: true }>) {
  const queue = [...script];
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const next = queue.shift();
      if (!next) throw new Error("лишний запрос");
      if (!next.silentAfter) return { stream: streamOf(next.parts) };
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of next.parts) controller.enqueue(part);
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason), { once: true });
          },
        }),
      };
    },
  });
}

function sendTool() {
  const started: string[] = [];
  const send = tool({
    description: "Отправить письмо.",
    inputSchema: z.object({ to: z.string() }),
    execute: async ({ to }) => {
      started.push(to);
      return `отправлено ${to}`;
    },
  });
  return { tools: { send }, started };
}

describe("runAgentTurn: у каждой попытки своя отмена (FR-057)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("сбой посреди ответа: сигнал отмены, который получили инструменты старой попытки, срабатывает; ход не остановлен", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const signals: AbortSignal[] = [];
    const tools = {
      look: tool({
        description: "Посмотреть.",
        inputSchema: z.object({}),
        execute: async (_input, { abortSignal }) => {
          signals.push(abortSignal!);
          return "видно";
        },
      }),
    };
    const model = scriptedModel([
      { parts: [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "look", input: "{}" }, finishPart("tool-calls")] },
      { parts: textThenFailure(503) },
      { parts: answerText("и заканчиваю.") },
    ]);
    const storage = await storageWithQuestion();

    // Без срока инструмента: инструмент получает сигнал попытки как есть.
    await onFakeClock(() => readAll(startTurn(storage, model, { tools, toolTimeout: { forTool: () => Infinity }, logError: () => {} })));

    expect(model.doStreamCalls).toHaveLength(3);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    expect((await savedAnswer(storage))!.status).toBe("complete");
  });

  it("модель замолчала после вызова: инструмент оборванной попытки не запускается, продолжение видит «мог выполниться частично»", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { tools, started } = sendTool();
    const model = scriptedModel([{ parts: callThenSilence("c1"), silentAfter: true }, { parts: answerText("Проверю почту, прежде чем слать ещё раз.") }]);
    const storage = await storageWithQuestion();

    await onFakeClock(() => readAll(startTurn(storage, model, { tools, logError: () => {} })));

    // SDK запускает инструменты шага только после конца ответа модели: оборванный шаг до них не доходит.
    expect(started).toEqual([]);
    expect((await savedAnswer(storage))!.status).toBe("complete");
    const continuation = JSON.stringify(model.doStreamCalls[1]!.prompt);
    expect(continuation).toContain('"toolCallId":"c1"');
    expect(continuation).toContain(JSON.stringify(HANGING_TOOL_CALL_REASON).slice(1, -1));
  });
});
