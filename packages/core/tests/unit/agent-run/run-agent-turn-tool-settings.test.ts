import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveToolResultLimit } from "../../../src/agent-run/tool-result-limit";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

/** Модель: первый шаг — вызов инструмента с аргументами `input`, второй — текст. */
function callingModel(toolName: string, input: string) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      step++;
      const parts: LanguageModelV4StreamPart[] =
        step === 1
          ? [streamStart, { type: "tool-call", toolCallId: "call-1", toolName, input }, finishPart("tool-calls")]
          : reasoningAndTextParts(["Готово."], "смотрю");
      return { stream: streamOf(parts) };
    },
  });
}

const hugeResult = "ж".repeat(200_000);
const listTasks = tool({ description: "Все задачи.", inputSchema: z.object({}), execute: async () => hugeResult });

describe("runAgentTurn: настройки инструментов хода", () => {
  it("обрезка результата — строка журнала без содержимого (FR-017)", async () => {
    const logged: string[] = [];
    await runTurn(callingModel("list_tasks", "{}"), { tools: { list_tasks: listTasks }, logError: (line) => logged.push(line) });
    expect(logged).toEqual(["[результат обрезан] чат=chat-1 инструмент=list_tasks знаков=200000 предел=50000"]);
  });

  it("починка аргументов — строка журнала с моделью и провайдером, без содержимого", async () => {
    const logged: string[] = [];
    const remember = tool({ description: "Запомнить.", inputSchema: z.object({ facts: z.array(z.string()) }), execute: async () => "ok" });
    await runTurn(callingModel("remember", '{"facts": ["тайный факт"]}}'), { tools: { remember }, logError: (line) => logged.push(line) });
    expect(logged).toEqual([
      "[аргументы починены] чат=chat-1 инструмент=remember модель=mock-model провайдер=mock правка=лишние скобки в конце ×1 длина=27",
    ]);
  });

  it("приложение подняло предел для своего инструмента — результат не режется (US4 сц. 2)", async () => {
    const logged: string[] = [];
    const model = callingModel("list_tasks", "{}");
    const { answer } = await runTurn(model, {
      tools: { list_tasks: listTasks },
      toolResultLimit: resolveToolResultLimit({ byTool: { list_tasks: 300_000 } }),
      logError: (line) => logged.push(line),
    });
    const call = answer.parts.find((part) => part.type === "tool-list_tasks") as { output?: string } | undefined;
    expect(call?.output).toBe(hugeResult);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).not.toContain("[Результат обрезан");
    expect(logged).toEqual([]);
  });

  it("кривые аргументы чинятся без обращения к модели: строки-числа и строки-булевы по схеме (US6)", async () => {
    const execute = vi.fn(async ({ taskId, done }: { taskId: number; done: boolean }) => `задача ${taskId}: ${done}`);
    const markTask = tool({ description: "Отметить задачу.", inputSchema: z.object({ taskId: z.number(), done: z.boolean() }), execute });
    const model = callingModel("mark_task", '{"taskId":"2","done":"true"}');

    const { answer } = await runTurn(model, { tools: { mark_task: markTask } });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({ taskId: 2, done: true });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(answer.status).toBe("complete");
  });
});
