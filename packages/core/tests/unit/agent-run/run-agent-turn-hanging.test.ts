import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StoredMessage } from "../../../src/conversation/types";
import { HANGING_TOOL_CALL_REASON, INTERRUPTED_REASON } from "../../../src/tool-approval/approval-parts";
import { finishPart, readAll, streamStart } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

/** Медленный инструмент: `started` — когда он запущен; результат не приходит никогда. */
function slowTool() {
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const slow = tool({
    description: "Долгая операция.",
    inputSchema: z.object({ id: z.string() }),
    execute: async () => {
      markStarted();
      return new Promise<string>(() => {});
    },
  });
  return { slow, started };
}

const toolCall = (id: string, toolName: string, input: object): LanguageModelV4StreamPart => ({
  type: "tool-call",
  toolCallId: id,
  toolName,
  input: JSON.stringify(input),
});

/** Модель: один шаг из заданных кусков; `fail` обрывает поток ошибкой провайдера, если он ещё открыт. */
function oneStepModel(parts: LanguageModelV4StreamPart[], options: { keepOpen?: boolean } = {}) {
  let controller: ReadableStreamDefaultController<LanguageModelV4StreamPart> | undefined;
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(streamController) {
          controller = streamController;
          for (const part of parts) streamController.enqueue(part);
          if (!options.keepOpen) streamController.close();
          abortSignal?.addEventListener("abort", () => streamController.error(abortSignal.reason));
        },
      }),
    }),
  });
  return { model, fail: (error: Error) => controller?.error(error) };
}

const toolPart = (answer: StoredMessage | undefined, toolCallId: string) =>
  answer?.parts.find((part) => "toolCallId" in part && part.toolCallId === toolCallId);

describe("runAgentTurn: висящие вызовы в конце оборванного хода", () => {
  it("«Стоп» во время медленного инструмента: ход stopped, в базе вызов закрыт постоянным текстом", async () => {
    const { slow, started } = slowTool();
    const storage = await storageWithQuestion();
    const abort = new AbortController();
    const { model } = oneStepModel([streamStart, toolCall("call-1", "slow", { id: "2" }), finishPart("tool-calls")]);
    const reading = readAll(startTurn(storage, model, { tools: { slow } satisfies ToolSet, abortSignal: abort.signal }));
    await started;
    abort.abort();
    await reading;

    const answer = await savedAnswer(storage);
    expect(answer?.status).toBe("stopped");
    expect(toolPart(answer, "call-1")).toMatchObject({ state: "output-error", errorText: HANGING_TOOL_CALL_REASON });
    expect(toolPart(answer, "call-1")).not.toHaveProperty("output");
  });

  it("обрыв провайдера после вызова, до конца шага: ход error, вызов закрыт тем же текстом", async () => {
    const { slow } = slowTool();
    const storage = await storageWithQuestion();
    const { model, fail } = oneStepModel([streamStart, toolCall("call-1", "slow", { id: "2" })], { keepOpen: true });
    for await (const chunk of startTurn(storage, model, { tools: { slow } satisfies ToolSet, logError: () => {} })) {
      if (chunk.type === "tool-input-available") fail(new Error("соединение сброшено"));
    }

    const answer = await savedAnswer(storage);
    expect(answer?.status).toBe("error");
    expect(toolPart(answer, "call-1")).toMatchObject({ state: "output-error", errorText: HANGING_TOOL_CALL_REASON });
  });

  it("запрос подтверждения при «Стоп» закрыт прежним текстом, а не текстом висящего вызова", async () => {
    const { slow, started } = slowTool();
    const remove = tool({
      description: "Удалить.",
      inputSchema: z.object({ path: z.string() }),
      needsApproval: true,
      execute: async () => "удалено",
    });
    const storage = await storageWithQuestion();
    const abort = new AbortController();
    const { model } = oneStepModel([
      streamStart,
      toolCall("call-1", "remove", { path: "a" }),
      toolCall("call-2", "slow", { id: "2" }),
      finishPart("tool-calls"),
    ]);
    const reading = readAll(startTurn(storage, model, { tools: { remove, slow } satisfies ToolSet, abortSignal: abort.signal }));
    await started;
    abort.abort();
    await reading;

    const answer = await savedAnswer(storage);
    expect(answer?.status).toBe("stopped");
    expect(toolPart(answer, "call-1")).toMatchObject({
      state: "output-denied",
      approval: { approved: false, reason: INTERRUPTED_REASON },
    });
    expect(toolPart(answer, "call-2")).toMatchObject({ state: "output-error", errorText: HANGING_TOOL_CALL_REASON });
  });
});
