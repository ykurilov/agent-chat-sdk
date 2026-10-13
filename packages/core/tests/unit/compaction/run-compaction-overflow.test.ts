import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cutToolResult } from "../../../src/agent-run/tool-result-limit";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { compactionTask } from "../../../src/compaction/compaction-task";
import { CompactionFailedError, runCompaction } from "../../../src/compaction/run-compaction";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { generateResult, mockCatalog, mockEnv, mockModelId } from "../support/mock-model";

const settings = resolveCompactionSettings({ thresholdTokens: 1000, tailTokens: 300, summaryCeilingTokens: 100 })!;
const lookup = tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute: async () => "x" });

const longText = "длинный результат ".repeat(400);
const longJson = { rows: Array.from({ length: 300 }, (_, index) => ({ index, title: `задача ${index}` })) };
const history: AgentChatMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Пройдись по задачам" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "tool-lookup", toolCallId: "c1", state: "output-available", input: { query: "все" }, output: longText },
      { type: "tool-lookup", toolCallId: "c2", state: "output-available", input: { query: "json" }, output: longJson },
      { type: "tool-lookup", toolCallId: "c3", state: "output-available", input: { query: "коротко" }, output: "коротко" },
      { type: "step-start" },
      { type: "text", text: "Готово", state: "done" },
    ],
  },
];

const overflowError = () =>
  new APICallError({
    message: "ответ 400",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '{"error":{"message":"This model\'s maximum context length is 1000 tokens. However, your messages resulted in 5000 tokens."}}',
  });

/** Модель сжатия: ответы `doGenerate` по очереди. */
function summarizer(results: Array<string | Error>) {
  const queue = [...results];
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error("лишний запрос");
      if (next instanceof Error) throw next;
      return generateResult(next, { output: 20 });
    },
  });
}

function compact(model: MockLanguageModelV4) {
  return runCompaction({
    catalog: mockCatalog({ mock: model }),
    env: mockEnv,
    chatId: "chat-1",
    model: { modelId: mockModelId, providerId: "mock" },
    instructions: "Ты помощник.",
    tools: { lookup },
    history,
    settings,
    logError: () => {},
  });
}

type PromptMessage = MockLanguageModelV4["doGenerateCalls"][number]["prompt"][number];

/** Результаты инструментов запроса по id вызова. */
function toolOutputs(prompt: PromptMessage[]): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const message of prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) if (part.type === "tool-result") outputs[part.toolCallId] = part.output;
  }
  return outputs;
}

describe("сжатие при переполнении самого запроса сжатия (FR-014, US4 сц. 6)", () => {
  it("обычное сжатие результаты инструментов не сокращает: запрос тот же, что раньше (кэш хода)", async () => {
    const model = summarizer(["## Цель\nсводка"]);
    await compact(model);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(toolOutputs(model.doGenerateCalls[0]!.prompt)).toEqual({
      c1: { type: "text", value: longText },
      c2: { type: "json", value: longJson },
      c3: { type: "text", value: "коротко" },
    });
  });

  it("ответ переполнением — один повтор, где результаты длиннее 2000 знаков сокращены до 2000 с пометкой; остальное то же", async () => {
    const model = summarizer([overflowError(), "## Цель\nсводка"]);

    const result = await compact(model);

    expect(result.summary).toBe("## Цель\nсводка");
    expect(model.doGenerateCalls).toHaveLength(2);
    const [first, second] = model.doGenerateCalls;
    const cutText = cutToolResult(longText, 2000);
    const cutJson = cutToolResult(longJson, 2000);
    if (!cutText.cut || !cutJson.cut) throw new Error("результаты должны резаться");
    expect(toolOutputs(second!.prompt)).toEqual({
      c1: { type: "text", value: cutText.text },
      c2: { type: "text", value: cutJson.text },
      c3: { type: "text", value: "коротко" },
    });
    expect(cutText.text.length).toBeLessThanOrEqual(2000);
    expect(cutText.text).toContain("[Результат обрезан: показано");
    // Инструкция, инструменты, задание и всё, кроме результатов, — как в первом запросе.
    expect(second!.prompt[0]).toEqual(first!.prompt[0]);
    expect(second!.tools).toEqual(first!.tools);
    expect(second!.toolChoice).toEqual(first!.toolChoice);
    expect(second!.prompt.at(-1)).toEqual(first!.prompt.at(-1));
    expect(JSON.stringify(second!.prompt.at(-1))).toContain(JSON.stringify(compactionTask({ summaryCeilingTokens: 100 })).slice(1, 40));
    expect(second!.prompt.map((message) => message.role)).toEqual(first!.prompt.map((message) => message.role));
  });

  it("повтор тоже переполнен — сжатие не вышло с видом context_overflow, третьего запроса нет", async () => {
    const model = summarizer([overflowError(), overflowError()]);
    const failure = await compact(model).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CompactionFailedError);
    expect((failure as Error).message).toContain("context_overflow");
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("другая ошибка 400 — повтора с сокращением нет", async () => {
    const other = new APICallError({
      message: "ответ 400",
      url: "https://provider.test/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: "bad request",
    });
    const model = summarizer([other, "## Цель\nсводка"]);
    await expect(compact(model)).rejects.toBeInstanceOf(CompactionFailedError);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
