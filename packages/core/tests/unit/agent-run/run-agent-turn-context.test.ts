import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { mockModel, streamOf, streamStart, textParts } from "../support/mock-model";
import { readAll } from "../support/mock-model";
import { runTurn, savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

function usageOf(input: number, output: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

function finishWith(reason: "stop" | "tool-calls", input: number, output: number): LanguageModelV4StreamPart {
  return { type: "finish", finishReason: { unified: reason, raw: reason }, usage: usageOf(input, output) };
}

describe("размер контекста в итоге ответа", () => {
  it("contextTokens — вход плюс выход последнего шага, а не сумма по шагам", async () => {
    const steps: LanguageModelV4StreamPart[][] = [
      [
        streamStart,
        { type: "tool-call", toolCallId: "t1", toolName: "lookup", input: "{}" },
        finishWith("tool-calls", 100, 30),
      ],
      [streamStart, ...textParts(["Готово"]), finishWith("stop", 160, 50)],
    ];
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(steps[step++]!) }) });
    const { answer } = await runTurn(model, {
      tools: { lookup: tool({ description: "Поиск.", inputSchema: z.object({}), execute: async () => "результат" }) },
    });
    expect(answer.usage).toMatchObject({ inputTokens: 260, outputTokens: 80, contextTokens: 210 });
  });

  it("без вызовов инструментов — вход плюс выход единственного шага", async () => {
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), finishWith("stop", 1000, 40)]));
    const { answer } = await runTurn(model);
    expect(answer.usage?.contextTokens).toBe(1040);
  });

  it("метаданные итога в потоке тоже несут contextTokens", async () => {
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), finishWith("stop", 1000, 40)]));
    const { chunks } = await runTurn(model);
    const finalMetadata = chunks.filter((chunk) => chunk.type === "message-metadata").at(-1);
    expect(finalMetadata).toMatchObject({ messageMetadata: { usage: { contextTokens: 1040 } } });
  });
});

describe("история хода функцией", () => {
  const okModel = () => mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), finishWith("stop", 10, 5)]));

  it("функция вызывается после того, как сообщение агента уже в хранилище, и её итог уходит модели", async () => {
    const storage = await storageWithQuestion();
    const model = okModel();
    const history: AgentChatMessage[] = [{ id: "s", role: "user", parts: [{ type: "text", text: "Сводка и вопрос" }] }];
    let seenStatus: string | undefined;
    const chunks = await readAll(
      startTurn(storage, model, {
        history: async () => {
          seenStatus = (await savedAnswer(storage))?.status;
          return history;
        },
      }),
    );
    expect(seenStatus).toBe("streaming");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain("Сводка и вопрос");
    expect(chunks.at(-1)).toMatchObject({ type: "finish" });
  });

  it("сбой функции — ответ в состоянии «ошибка», поток закрыт штатно", async () => {
    const storage = await storageWithQuestion();
    const logError = vi.fn();
    const chunks = await readAll(
      startTurn(storage, okModel(), {
        history: async () => {
          throw new Error("не собралась");
        },
        logError,
      }),
    );
    expect((await savedAnswer(storage))?.status).toBe("error");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(true);
  });
});

describe("хук окончания хода", () => {
  it("вызывается после записи итога с состоянием и id ответа", async () => {
    const storage = await storageWithQuestion();
    const seen: Array<{ status: string; messageId: string; stored: string | undefined }> = [];
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), finishWith("stop", 10, 5)]));
    await readAll(
      startTurn(storage, model, {
        onFinished: async ({ status, messageId }) => {
          seen.push({ status, messageId, stored: (await savedAnswer(storage))?.status });
        },
      }),
    );
    expect(seen).toEqual([{ status: "complete", messageId: "a1", stored: "complete" }]);
  });

  it("на остановленном ходе — «stopped»; сбой хука ход не ломает", async () => {
    const storage = await storageWithQuestion();
    const controller = new AbortController();
    controller.abort();
    const onFinished = vi.fn(async () => {
      throw new Error("хук упал");
    });
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), finishWith("stop", 10, 5)]));
    const chunks = await readAll(startTurn(storage, model, { abortSignal: controller.signal, onFinished }));
    expect(onFinished).toHaveBeenCalledWith({ status: "stopped", messageId: "a1", answeredProviderId: "mock" });
    expect(chunks.at(-1)).toMatchObject({ type: "abort" });
  });
});
