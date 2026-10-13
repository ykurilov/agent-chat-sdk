import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { answerStepsFrame } from "../../../src/compaction/answer-steps";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import { finishPart, mockCatalog, mockModelId, mockUsage, streamOf, streamStart, textParts } from "../support/mock-model";
import { createCacheMissWatch } from "../../../src/usage/cache-miss-watch";
import { newStoredMessage } from "../../../src/conversation/types";
import { readAll } from "../support/mock-model";
import { runTurn, startTurn, storageWithQuestion, TODAY } from "../support/turn-fixtures";

const price = { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: 0.1 };

const overflowError = () =>
  new APICallError({
    message: "ответ 400",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '{"error":{"message":"This model\'s maximum context length is 1000 tokens. However, your messages resulted in 5000 tokens."}}',
  });

const rateLimitError = () =>
  new APICallError({
    message: "ответ 429",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: "Too many tokens, please wait before trying again.",
    responseHeaders: { "retry-after-ms": "1" },
  });

const call = (id: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: "lookup", input: JSON.stringify({ query: id }) },
  finishPart("tool-calls"),
];
const answerText = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Модель: на каждый запрос — следующий поток или ошибка. */
function scriptedModel(script: Array<LanguageModelV4StreamPart[] | Error>) {
  const queue = [...script];
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = queue.shift();
      if (!next) throw new Error("лишний запрос");
      if (next instanceof Error) throw next;
      return { stream: streamOf(next) };
    },
  });
}

function lookupTool() {
  const execute = vi.fn(async ({ query }: { query: string }) => `результат ${query}`);
  return { tools: { lookup: tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute }) }, execute };
}

const compactedHistory: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "<сводка> Привет" }] }];

async function overflowTurn(model: MockLanguageModelV4, extra: Partial<AgentTurnInput> = {}) {
  const logged: string[] = [];
  const { tools, execute } = lookupTool();
  const compactForOverflow = vi.fn(async () => compactedHistory);
  const result = await runTurn(model, {
    catalog: mockCatalog({ mock: model }, { pricing: price }),
    tools,
    ownerId: "anna",
    compactForOverflow,
    logError: (line) => logged.push(line),
    ...extra,
  });
  return { ...result, logged, execute, compactForOverflow };
}

type Prompt = MockLanguageModelV4["doStreamCalls"][number]["prompt"];
const roles = (prompt: Prompt) => prompt.map((message) => message.role);
const userText = (prompt: Prompt, index: number) => {
  const message = prompt[index]!;
  return message.role === "user" ? message.content.map((part) => (part.type === "text" ? part.text : "")) : [];
};

describe("runAgentTurn: переполнение — сжать и продолжить тот же ответ (US4 сц. 3–4, FR-012)", () => {
  it("первый запрос не влез — история сжата, ход повторён один раз; ответ complete, один start, ошибки в потоке нет (сц. 3)", async () => {
    const model = scriptedModel([overflowError(), answerText("Готово")]);

    const { answer, chunks, compactForOverflow } = await overflowTurn(model);

    expect(compactForOverflow).toHaveBeenCalledTimes(1);
    expect(compactForOverflow).toHaveBeenCalledWith(expect.objectContaining({ providerId: "mock" }));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(userText(model.doStreamCalls[1]!.prompt, 1)).toEqual(["<сводка> Привет", TODAY]);
    expect(answer.status).toBe("complete");
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
  });

  it("упёрлись посреди хода — продолжение с выполненными шагами: инструмент не вызван второй раз, тот же ответ (сц. 3)", async () => {
    const model = scriptedModel([call("c1"), overflowError(), answerText("Итог")]);

    const { answer, chunks, execute } = await overflowTurn(model);

    expect(model.doStreamCalls).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(1);
    const continuation = model.doStreamCalls[2]!.prompt;
    // Сжатая история, затем текущий ответ с вызовом и результатом.
    expect(roles(continuation)).toEqual(["system", "user", "assistant", "tool"]);
    expect(userText(continuation, 1)).toEqual(["<сводка> Привет", TODAY]);
    // Инструкция и инструменты — как в упавшем запросе (кэш).
    expect(continuation[0]).toEqual(model.doStreamCalls[1]!.prompt[0]);
    expect(model.doStreamCalls[2]!.tools).toEqual(model.doStreamCalls[1]!.tools);
    expect(answer.status).toBe("complete");
    expect(answer.parts.filter((part) => part.type === "tool-lookup")).toHaveLength(1);
    expect(answer.parts.at(-1)).toMatchObject({ type: "text", text: "Итог" });
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
  });

  it("повтор после сжатия снова не влез — error / context_overflow, без цикла: два запроса (сц. 4, SC-006)", async () => {
    const model = scriptedModel([overflowError(), overflowError()]);

    const { answer, chunks, logged, compactForOverflow } = await overflowTurn(model);

    expect(model.doStreamCalls).toHaveLength(2);
    expect(compactForOverflow).toHaveBeenCalledTimes(1);
    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind: "context_overflow" });
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "context_overflow" }]);
    expect(logged.filter((line) => line.startsWith("[сбой провайдера]"))).toHaveLength(1);
  });

  it("сжимать нечего (null) — error / context_overflow после одного запроса (сц. 4)", async () => {
    const model = scriptedModel([overflowError()]);

    const { answer } = await overflowTurn(model, { compactForOverflow: async () => null });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(answer.error).toEqual({ kind: "context_overflow" });
  });

  it("сжатия у хода нет — переполнение сразу ошибка", async () => {
    const model = scriptedModel([overflowError()]);
    const { answer } = await overflowTurn(model, { compactForOverflow: undefined });
    expect(answer.error).toEqual({ kind: "context_overflow" });
  });

  it("«Too many tokens, please wait» — лимит, а не переполнение: сжатия нет (сц. 5)", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw rateLimitError();
      },
    });

    const { answer, compactForOverflow } = await overflowTurn(model, { providerFallback: false });

    expect(compactForOverflow).not.toHaveBeenCalled();
    expect(answer.error).toEqual({ kind: "rate_limited" });
  });

  it("«Стоп» во время сжатия — ход остановлен, нового запроса нет", async () => {
    const model = scriptedModel([call("c1"), overflowError()]);
    const stop = new AbortController();
    const compactForOverflow = vi.fn(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise<AgentChatMessage[] | null>((_, reject) => {
          abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
          stop.abort(new DOMException("Стоп", "AbortError"));
        }),
    );

    const { answer } = await overflowTurn(model, { compactForOverflow, abortSignal: stop.signal });

    expect(model.doStreamCalls).toHaveLength(2);
    expect(answer.status).toBe("stopped");
    expect(answer.parts.filter((part) => part.type === "tool-lookup")).toHaveLength(1);
  });

  it("расход обеих попыток — в ответе и в журнале расходов (FR-013)", async () => {
    const model = scriptedModel([call("c1"), overflowError(), answerText("Итог")]);

    const { answer, storage } = await overflowTurn(model);

    // Шаг первой попытки и шаг продолжения: по 100 на вход и 30 на выход у каждого.
    expect(answer.usage).toMatchObject({ inputTokens: 200, outputTokens: 60 });
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([
      expect.objectContaining({ modelId: mockModelId, providerId: "mock", inputTokens: 200, outputTokens: 60 }),
    ]);
    expect(mockUsage.inputTokens.total).toBe(100);
  });

  it("продолжение после подтверждения или «Повторить»: сжатая история до ответа, затем сам ответ", async () => {
    const model = scriptedModel([overflowError(), answerText("Итог")]);
    const resumed: AgentChatMessage = {
      id: "a1",
      role: "assistant",
      metadata: { modelId: mockModelId, providerId: "mock" },
      parts: [
        { type: "step-start" },
        { type: "tool-lookup", toolCallId: "c0", state: "output-available", input: { query: "c0" }, output: "результат c0" },
      ],
    };
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }, resumed];

    const { answer, compactForOverflow } = await overflowTurn(model, { history, resume: { message: resumed, usage: null, replay: true } });

    expect(compactForOverflow).toHaveBeenCalledTimes(1);
    expect(roles(model.doStreamCalls[0]!.prompt)).toEqual(["system", "user", "assistant", "tool"]);
    expect(roles(model.doStreamCalls[1]!.prompt)).toEqual(["system", "user", "assistant", "tool"]);
    expect(userText(model.doStreamCalls[1]!.prompt, 1)).toEqual(["<сводка> Привет", TODAY]);
    expect(answer.status).toBe("complete");
    expect(answer.parts.at(-1)).toMatchObject({ type: "text", text: "Итог" });
  });
});

describe("runAgentTurn: сжатие внутри хода — пересказ первых шагов ответа", () => {
  it("история сжата, а ход всё равно не влез — первые шаги пересказаны, последние два идут как есть; хранится весь ответ", async () => {
    const model = scriptedModel([call("c1"), call("c2"), call("c3"), overflowError(), overflowError(), answerText("Итог")]);
    const compactAnswerSteps = vi.fn(async (_input: { history: readonly AgentChatMessage[]; steps: AgentChatMessage["parts"] }) => "вызван поиск c1");

    const { answer, execute } = await overflowTurn(model, { compactAnswerSteps });

    expect(model.doStreamCalls).toHaveLength(6);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(compactAnswerSteps).toHaveBeenCalledTimes(1);
    const { history, steps } = compactAnswerSteps.mock.calls[0]![0];
    expect(history).toEqual(compactedHistory);
    expect(steps.filter((part) => part.type === "tool-lookup").map((part) => "toolCallId" in part && part.toolCallId)).toEqual(["c1"]);
    const last = model.doStreamCalls[5]!.prompt;
    expect(userText(last, 1)).toEqual(["<сводка> Привет", answerStepsFrame("вызван поиск c1"), TODAY]);
    expect(roles(last)).toEqual(["system", "user", "assistant", "tool", "assistant", "tool"]);
    expect(JSON.stringify(last)).not.toContain('"c1"');
    expect(answer.status).toBe("complete");
    expect(answer.parts.filter((part) => part.type === "tool-lookup")).toHaveLength(3);
    expect(answer.parts.at(-1)).toMatchObject({ type: "text", text: "Итог" });
  });

  it("ход начат ответом на виджет, его шаг пересказан — заметка продолжения остаётся в запросе", async () => {
    const model = scriptedModel([call("c1"), call("c2"), overflowError(), overflowError(), answerText("Итог")]);
    const resumed: AgentChatMessage = {
      id: "a1",
      role: "assistant",
      metadata: { modelId: mockModelId, providerId: "mock" },
      parts: [
        { type: FROZEN_CONTEXT_PART_TYPE, data: { blocks: [{ key: "today", text: TODAY }], sent: "all", base: null } } as never,
        { type: "step-start" },
        { type: "tool-lookup", toolCallId: "c0", state: "output-available", input: { query: "c0" }, output: "результат c0" },
      ],
    };
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }, resumed];

    const storage = await storageWithQuestion();
    await storage.insertMessage(
      newStoredMessage({ id: "a1", chatId: "chat-1", parentId: "u1", role: "assistant", status: "streaming", modelId: mockModelId, providerId: "mock", parts: resumed.parts }),
    );
    await readAll(
      startTurn(storage, model, {
        catalog: mockCatalog({ mock: model }, { pricing: price }),
        tools: lookupTool().tools,
        compactForOverflow: async () => compactedHistory,
        compactAnswerSteps: async () => "вызван поиск c0",
        history,
        resume: { message: resumed, usage: null },
        place: { description: "Карточка «ИП Лютик»" },
      }),
    );

    const [first, , , , last] = model.doStreamCalls.map((entry) => entry.prompt);
    expect(roles(first!)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(JSON.stringify(first!.at(-1))).toContain("ИП Лютик");
    expect(JSON.stringify(last)).not.toContain('"c0"');
    expect(JSON.stringify(last)).toContain("ИП Лютик");
  });

  it("история не сжалась (null) — сразу пересказ шагов", async () => {
    const model = scriptedModel([call("c1"), call("c2"), overflowError(), answerText("Итог")]);
    const compactAnswerSteps = vi.fn(async () => "вызван поиск c1");

    const { answer } = await overflowTurn(model, { compactForOverflow: async () => null, compactAnswerSteps });

    expect(compactAnswerSteps).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(4);
    expect(answer.status).toBe("complete");
  });

  it("шаг в ответе один — пересказывать нечего: error / context_overflow", async () => {
    const model = scriptedModel([call("c1"), overflowError(), overflowError()]);
    const compactAnswerSteps = vi.fn(async () => "пересказ");

    const { answer } = await overflowTurn(model, { compactAnswerSteps });

    expect(compactAnswerSteps).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(3);
    expect(answer.error).toEqual({ kind: "context_overflow" });
  });

  it("и после пересказа не влезло — error / context_overflow, третьего сжатия нет", async () => {
    const model = scriptedModel([call("c1"), call("c2"), overflowError(), overflowError(), overflowError()]);
    const compactAnswerSteps = vi.fn(async () => "пересказ");

    const { answer } = await overflowTurn(model, { compactAnswerSteps });

    expect(compactAnswerSteps).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(5);
    expect(answer.error).toEqual({ kind: "context_overflow" });
  });
});

describe("runAgentTurn: попытки хода делят его лимит шагов и расход", () => {
  it("лимит шагов — на весь ход: после сжатия попытка получает остаток (maxSteps минус сделанные шаги)", async () => {
    const model = scriptedModel([call("c1"), overflowError(), call("c2"), answerText("лишний шаг")]);

    const { answer, execute } = await overflowTurn(model, { maxSteps: 2 });

    // Шаг c1 до переполнения и шаг c2 после сжатия — лимит в два шага исчерпан, третьего запроса нет. Шаг c2 —
    // последний шаг хода: вызов вопреки запрету не выполняется.
    expect(model.doStreamCalls).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(answer.parts.some((part) => part.type === "text")).toBe(false);
  });

  it("последняя попытка упала без итога — в ответе расход прежних попыток не теряется", async () => {
    const model = scriptedModel([call("c1"), overflowError(), overflowError()]);

    const { answer, storage } = await overflowTurn(model);

    expect(answer.error).toEqual({ kind: "context_overflow" });
    // Шаг c1 первой попытки: 100 на вход, 30 на выход; вторая попытка шагов не сделала.
    expect(answer.usage).toMatchObject({ inputTokens: 100, outputTokens: 30 });
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([expect.objectContaining({ inputTokens: 100, outputTokens: 30 })]);
  });
});

describe("runAgentTurn: следилка кэша и пересказ шагов", () => {
  /** Поток с заданным расходом шага: вход `input`, из них прочитано из кэша `cacheRead`. */
  const withUsage = (parts: LanguageModelV4StreamPart[], input: number, cacheRead: number): LanguageModelV4StreamPart[] =>
    parts.map((part) =>
      part.type === "finish"
        ? { ...part, usage: { inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } }
        : part,
    );

  it("после пересказа начало запроса другое — ложной строки «[промах кэша]» нет", async () => {
    const model = scriptedModel([
      withUsage(call("c1"), 20_000, 15_000),
      withUsage(call("c2"), 21_000, 20_000),
      overflowError(),
      withUsage(answerText("Итог"), 8_000, 0),
    ]);
    const lines: string[] = [];
    const cacheMissWatch = createCacheMissWatch({ logError: (line) => lines.push(line) });

    const { answer } = await overflowTurn(model, {
      cacheMissWatch,
      compactForOverflow: async () => null,
      compactAnswerSteps: async () => "вызван поиск c1",
    });

    expect(answer.status).toBe("complete");
    expect(model.doStreamCalls).toHaveLength(4);
    expect(lines).toEqual([]);
  });
});
