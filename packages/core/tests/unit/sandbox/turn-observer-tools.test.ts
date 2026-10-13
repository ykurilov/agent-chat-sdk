import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveToolResultLimit } from "../../../src/agent-run/tool-result-limit";
import type { ModelCallEvent, ToolCallEvent, TurnObserver } from "../../../src/agent-run/turn-observer";
import { finishPart, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const tools = {
  current_time: tool({
    description: "Текущее время в часовом поясе.",
    inputSchema: z.object({ timeZone: z.string() }),
    execute: async ({ timeZone }) => `время в ${timeZone}`,
  }),
  broken_lookup: tool({
    description: "Всегда падает.",
    inputSchema: z.object({ query: z.string() }),
    execute: async (): Promise<string> => {
      throw new Error("сервис недоступен");
    },
  }),
  long_read: tool({
    description: "Длинный текст.",
    inputSchema: z.object({}),
    execute: async () => "а".repeat(5_000),
  }),
  hanging: tool({
    description: "Не отвечает.",
    inputSchema: z.object({}),
    execute: () => new Promise<string>(() => {}),
  }),
  ask_human: tool({ description: "Спросить человека.", inputSchema: z.object({ question: z.string() }) }),
} satisfies ToolSet;

const callThen = (toolName: string, input: object, toolCallId = "call-1"): MockLanguageModelV4 => {
  let step = 0;
  const steps: LanguageModelV4StreamPart[][] = [
    [streamStart, { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) }, finishPart("tool-calls")],
    [streamStart, ...textParts(["Готово"]), finishPart()],
  ];
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = steps[step++];
      if (!next) throw new Error("лишний шаг");
      return { stream: streamOf(next) };
    },
  });
};

function recordingObserver() {
  const models: ModelCallEvent[] = [];
  const calls: ToolCallEvent[] = [];
  const observer: TurnObserver = { modelCall: (event) => models.push(event), toolCall: (event) => calls.push(event) };
  return { observer, models, calls };
}

const outputOf = (parts: ReadonlyArray<{ type: string }>, toolCallId: string) =>
  (parts.find((part) => "toolCallId" in part && part.toolCallId === toolCallId) as { output?: unknown } | undefined)?.output;

describe("наблюдатель хода: вызовы инструментов (T010)", () => {
  it("законченный вызов — событие со входом, результатом и длительностью; обращения к модели — с messageId хода", async () => {
    const { observer, models, calls } = recordingObserver();
    const { answer } = await runTurn(callThen("current_time", { timeZone: "Asia/Tokyo" }), { tools, ownerId: "anna", turnObserver: observer });

    expect(answer.status).toBe("complete");
    expect(calls).toEqual([
      {
        chatId: "chat-1",
        ownerId: "anna",
        messageId: "a1",
        toolCallId: "call-1",
        toolName: "current_time",
        input: { timeZone: "Asia/Tokyo" },
        output: "время в Asia/Tokyo",
        error: null,
        startedAt: expect.any(Date),
        durationMs: expect.any(Number),
      },
    ]);
    expect(models.map(({ purpose, messageId, attempt, status }) => ({ purpose, messageId, attempt, status }))).toEqual([
      { purpose: "answer", messageId: "a1", attempt: 1, status: "complete" },
      { purpose: "answer", messageId: "a1", attempt: 1, status: "complete" },
    ]);
  });

  it("ошибка инструмента — событие с текстом ошибки и без результата", async () => {
    const { observer, calls } = recordingObserver();
    await runTurn(callThen("broken_lookup", { query: "чай" }), { tools, turnObserver: observer });
    expect(calls).toEqual([expect.objectContaining({ toolName: "broken_lookup", output: null, error: "сервис недоступен" })]);
  });

  it("длинный результат — в событии обрезанный, ровно тот, что увидела модель", async () => {
    const { observer, calls } = recordingObserver();
    const { answer } = await runTurn(callThen("long_read", {}), { tools, turnObserver: observer, toolResultLimit: resolveToolResultLimit(1_000), logError: () => {} });
    const output = calls[0]!.output;
    expect(typeof output).toBe("string");
    expect((output as string).length).toBeLessThan(5_000);
    expect(output).toEqual(outputOf(answer.parts, "call-1"));
  });

  it("инструмент не ответил в срок — событие с ошибкой", async () => {
    const { observer, calls } = recordingObserver();
    await runTurn(callThen("hanging", {}), { tools, turnObserver: observer, toolTimeout: { forTool: () => 20 }, logError: () => {} });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ toolName: "hanging", output: null });
    expect(calls[0]!.error).toEqual(expect.any(String));
  });

  it("инструмент без execute не оборачивается: событий вызова нет", async () => {
    const { observer, calls } = recordingObserver();
    await runTurn(callThen("ask_human", { question: "Да?" }), { tools, turnObserver: observer });
    expect(calls).toEqual([]);
  });

  it("бросок наблюдателя ход не ломает: ответ complete, причина в журнале", async () => {
    const logError = vi.fn();
    const observer: TurnObserver = {
      modelCall: () => {},
      toolCall: () => {
        throw new Error("журнал упал");
      },
    };
    const { answer } = await runTurn(callThen("current_time", { timeZone: "UTC" }), { tools, turnObserver: observer, logError });
    expect(answer.status).toBe("complete");
    expect(outputOf(answer.parts, "call-1")).toBe("время в UTC");
    expect(logError.mock.calls.map(([line]) => String(line)).some((line) => line.includes("журнал упал"))).toBe(true);
  });
});
