import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { finishPart, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const callBuild: LanguageModelV4StreamPart[] = [
  streamStart,
  { type: "tool-call", toolCallId: "c1", toolName: "build", input: "{}" },
  finishPart("tool-calls"),
];

function steppedModel(steps: LanguageModelV4StreamPart[][]): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(steps[step++] ?? [streamStart, ...textParts(["Готово"]), finishPart()]) }) });
}

const tools = { build: tool({ description: "Собрать", inputSchema: z.object({}), execute: async () => "собрано" }) };

describe("ход: поправка человека на границе шага", () => {
  it("поправка ждёт — после результатов инструмента следующего запроса нет, ответ готов", async () => {
    const model = steppedModel([callBuild]);
    const { answer } = await runTurn(model, { tools, correctionsWaiting: () => true });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("complete");
    expect(answer.parts.some((part) => part.type === "tool-build" && (part as { state: string }).state === "output-available")).toBe(true);
  });

  it("поправок нет — ход идёт дальше, как раньше", async () => {
    const model = steppedModel([callBuild]);
    const { answer } = await runTurn(model, { tools, correctionsWaiting: () => false });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(answer.status).toBe("complete");
  });
});
