import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { LENGTH_CUT_NOTE, LENGTH_CUT_PART_TYPE } from "../../../src/agent-run/length-cut";
import { mockUsage, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const ending = (reason: "length" | "stop"): LanguageModelV4StreamPart[] => [
  streamStart,
  ...textParts(["Длинный отчёт, первая полови"]),
  { type: "finish", finishReason: { unified: reason, raw: reason === "length" ? "max_tokens" : "stop" }, usage: mockUsage },
];

const model = (reason: "length" | "stop") => new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(ending(reason)) }) });

describe("runAgentTurn: ответ, оборванный по длине (FR-054)", () => {
  it("последний шаг кончился по длине — отметка в конце ответа и куском клиенту, ответ законченный", async () => {
    const { answer, chunks } = await runTurn(model("length"));

    expect(answer.status).toBe("complete");
    expect(answer.parts.at(-1)).toEqual({ type: LENGTH_CUT_PART_TYPE, data: true });
    expect(chunks).toContainEqual({ type: LENGTH_CUT_PART_TYPE, data: true });
    // Отметка приходит до итога хода.
    const markAt = chunks.findIndex((chunk) => chunk.type === LENGTH_CUT_PART_TYPE);
    const finishAt = chunks.findIndex((chunk) => chunk.type === "finish");
    expect(markAt).toBeLessThan(finishAt);
  });

  it("следующий ход: модель видит пометку в конце своего ответа", async () => {
    const { answer } = await runTurn(model("length"));
    const next = model("stop");
    await runTurn(next, {
      history: [
        { id: "u0", role: "user", parts: [{ type: "text", text: "Отчёт" }] },
        { id: "a0", role: "assistant", parts: answer.parts },
        { id: "u1", role: "user", parts: [{ type: "text", text: "Допиши" }] },
      ],
    });
    const assistant = next.doStreamCalls[0]!.prompt.find((message) => message.role === "assistant")!;
    expect(JSON.stringify(assistant.content.at(-1))).toContain(LENGTH_CUT_NOTE);
  });

  it("обычный конец — отметки нет", async () => {
    const { answer, chunks } = await runTurn(model("stop"));
    expect(answer.parts.some((part) => part.type === LENGTH_CUT_PART_TYPE)).toBe(false);
    expect(chunks.some((chunk) => chunk.type === LENGTH_CUT_PART_TYPE)).toBe(false);
  });
});
