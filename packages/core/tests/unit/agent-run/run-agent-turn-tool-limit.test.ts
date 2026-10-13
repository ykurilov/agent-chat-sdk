import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const hugeResult = "ж".repeat(200_000);

const tools = {
  list_tasks: tool({
    description: "Все задачи.",
    inputSchema: z.object({}),
    execute: async () => hugeResult,
  }),
} satisfies ToolSet;

describe("runAgentTurn: предел результата инструмента", () => {
  it("инструмент вернул 200 000 знаков → в запросе следующего шага результат ≤ 50 000 с пометкой", async () => {
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        step++;
        return {
          stream: streamOf(
            step === 1
              ? [
                  streamStart,
                  { type: "tool-call", toolCallId: "call-1", toolName: "list_tasks", input: "{}" },
                  finishPart("tool-calls"),
                ]
              : reasoningAndTextParts(["Вот список."], "смотрю"),
          ),
        };
      },
    });

    const { answer } = await runTurn(model, { tools });

    const secondRequest = JSON.stringify(model.doStreamCalls[1]!.prompt);
    expect(secondRequest).toContain("[Результат обрезан: показано");
    expect(secondRequest).toContain("из 200000 знаков]");
    expect(secondRequest.length).toBeLessThan(55_000);

    const call = answer.parts.find((part) => part.type === "tool-list_tasks");
    const output = (call as { output?: string } | undefined)?.output ?? "";
    expect(output.length).toBeLessThanOrEqual(50_000);
    expect(output).toContain("[Результат обрезан");
  });
});
