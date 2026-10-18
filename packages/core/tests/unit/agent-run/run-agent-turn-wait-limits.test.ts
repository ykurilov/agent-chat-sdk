import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet, UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { resolveToolTimeout, toolTimeoutMessage } from "../../../src/agent-run/tool-timeout";
import { finishPart, mockCatalog, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

const callTool = (name: string, id = "call-1"): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: name, input: "{}" },
  finishPart("tool-calls"),
];
const saying = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Модель по сценарию: шаг N — `scripts[N]`; функция получает сигнал отмены (поток, который молчит до отмены). */
type Script = LanguageModelV4StreamPart[] | ((abortSignal?: AbortSignal) => ReadableStream<LanguageModelV4StreamPart>);
function scriptedModel(scripts: Script[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const script = scripts[Math.min(call++, scripts.length - 1)]!;
      return { stream: typeof script === "function" ? script(abortSignal) : streamOf(script) };
    },
  });
}

/** Поток, который открылся и молчит, пока его не отменят; `before` — куски до молчания. */
const silentAfter =
  (before: LanguageModelV4StreamPart[] = [streamStart]) =>
  (abortSignal?: AbortSignal) =>
    new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const part of before) controller.enqueue(part);
        abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
      },
    });

/** Инструмент, который не отвечает, пока его не отменят. */
function hangingTools(signals: AbortSignal[] = []): ToolSet {
  return {
    slow_report: tool({
      description: "Долгий отчёт",
      inputSchema: z.object({}),
      execute: (_input, { abortSignal }) => {
        if (abortSignal) signals.push(abortSignal);
        return new Promise<string>(() => {});
      },
    }),
  };
}

/** Ход, пока подменённые часы идут на `advanceMs`; `stopAfterMs` — «Стоп» после этого времени. */
async function runWithClock(model: MockLanguageModelV4, advanceMs: number, extra: Partial<AgentTurnInput> = {}, stopAfterMs?: number) {
  const storage = await storageWithQuestion();
  const logged: string[] = [];
  const stop = new AbortController();
  const reading = readAll(startTurn(storage, model, { logError: (line) => logged.push(line), abortSignal: stop.signal, ...extra }));
  if (stopAfterMs !== undefined) {
    await vi.advanceTimersByTimeAsync(stopAfterMs);
    stop.abort();
  }
  await vi.advanceTimersByTimeAsync(advanceMs);
  const chunks: UIMessageChunk[] = await reading;
  const answer = await savedAnswer(storage);
  if (!answer) throw new Error("ответ не сохранён");
  return { chunks, answer, logged };
}

const toolOutputError = (chunks: UIMessageChunk[]) => chunks.find((chunk) => chunk.type === "tool-output-error");
/** Что модель увидела результатом вызова на шаге `call`. */
function toolResultSeen(model: MockLanguageModelV4, call = 1): unknown {
  const toolMessage = model.doStreamCalls[call]!.prompt.find((message) => message.role === "tool");
  return toolMessage && Array.isArray(toolMessage.content) ? (toolMessage.content[0] as { output?: unknown }).output : undefined;
}

describe("runAgentTurn: предел ожидания серверного инструмента", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("инструмент молчит 120 с — вызов закрыт ошибкой, модель видит её и дописывает ответ; инструмент отменён; строка в журнале", async () => {
    const signals: AbortSignal[] = [];
    const model = scriptedModel([callTool("slow_report"), saying("Отчёт не успел, попробую иначе.")]);

    const { chunks, answer, logged } = await runWithClock(model, 120_000, { tools: hangingTools(signals), toolTimeout: resolveToolTimeout(120_000) });

    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("Отчёт не успел, попробую иначе.");
    expect(toolOutputError(chunks)).toMatchObject({ toolCallId: "call-1", errorText: toolTimeoutMessage(120_000) });
    // SDK пишет модели ошибку инструмента как «Имя: текст».
    expect(toolResultSeen(model)).toEqual({ type: "error-text", value: `ToolTimeoutError: ${toolTimeoutMessage(120_000)}` });
    expect(signals[0]!.aborted).toBe(true);
    expect(logged).toContain("[инструмент не ответил] чат=chat-1 инструмент=slow_report срок=120000мс");
  });

  it("без настройки в ходе — тоже 120 с", async () => {
    const model = scriptedModel([callTool("slow_report"), saying("Дальше.")]);
    const { chunks, answer } = await runWithClock(model, 120_000, { tools: hangingTools() });
    expect(toolOutputError(chunks)).toMatchObject({ errorText: toolTimeoutMessage(120_000) });
    expect(answer.status).toBe("complete");
  });

  it("свой срок 5 с: в 4,999 с вызов ещё ждёт, в 5 с закрыт", async () => {
    const model = scriptedModel([callTool("slow_report"), saying("Дальше.")]);
    const storage = await storageWithQuestion();
    const reading = readAll(startTurn(storage, model, { tools: hangingTools(), toolTimeout: resolveToolTimeout(5_000), logError: () => {} }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(model.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const chunks = await reading;
    expect(toolOutputError(chunks)).toMatchObject({ errorText: toolTimeoutMessage(5_000) });
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("без предела (Infinity): инструмент ждётся сколько угодно, «Стоп» останавливает ход как раньше", async () => {
    const signals: AbortSignal[] = [];
    const model = scriptedModel([callTool("slow_report")]);
    const { answer, logged } = await runWithClock(
      model,
      1_000,
      { tools: hangingTools(signals), toolTimeout: resolveToolTimeout(Number.POSITIVE_INFINITY) },
      600_000,
    );
    expect(answer.status).toBe("stopped");
    expect(signals[0]!.aborted).toBe(true);
    expect(logged.some((line) => line.startsWith("[инструмент не ответил]"))).toBe(false);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("два вызова в одном шаге: один завис, второй ответил — модель получает оба результата", async () => {
    const signals: AbortSignal[] = [];
    const model = scriptedModel([
      [
        streamStart,
        { type: "tool-call", toolCallId: "call-1", toolName: "slow_report", input: "{}" },
        { type: "tool-call", toolCallId: "call-2", toolName: "quick_count", input: "{}" },
        finishPart("tool-calls"),
      ],
      saying("Счёт есть, отчёт не успел."),
    ]);
    const tools: ToolSet = {
      ...hangingTools(signals),
      quick_count: tool({ description: "Счёт", inputSchema: z.object({}), execute: async () => "42" }),
    };
    const { answer } = await runWithClock(model, 5_000, { tools, toolTimeout: resolveToolTimeout(5_000) });

    expect(answer.status).toBe("complete");
    const toolMessage = model.doStreamCalls[1]!.prompt.find((message) => message.role === "tool");
    const results = (toolMessage!.content as Array<{ toolCallId: string; output: unknown }>).map(({ toolCallId, output }) => ({ toolCallId, output }));
    expect(results).toEqual([
      { toolCallId: "call-1", output: { type: "error-text", value: `ToolTimeoutError: ${toolTimeoutMessage(5_000)}` } },
      { toolCallId: "call-2", output: { type: "text", value: "42" } },
    ]);
    expect(signals[0]!.aborted).toBe(true);
  });

  it("свой срок инструмента в ходе: «спроси человека» без предела ждёт 10 мин и дожидается ответа, срок в журнале — свой", async () => {
    let answerHuman!: (text: string) => void;
    const tools: ToolSet = {
      ...hangingTools(),
      ask_user: tool({
        description: "Спросить человека",
        inputSchema: z.object({}),
        execute: () => new Promise<string>((resolve) => (answerHuman = resolve)),
      }),
    };
    const model = scriptedModel([callTool("ask_user"), callTool("slow_report", "call-2"), saying("Понял.")]);
    const storage = await storageWithQuestion();
    const logged: string[] = [];
    const reading = readAll(
      startTurn(storage, model, {
        tools,
        toolTimeout: resolveToolTimeout({ default: 120_000, byTool: { ask_user: 0, slow_report: 30_000 } }),
        logError: (line) => logged.push(line),
      }),
    );
    await vi.advanceTimersByTimeAsync(600_000);
    expect(model.doStreamCalls).toHaveLength(1);
    answerHuman("Да");
    await vi.advanceTimersByTimeAsync(30_000);
    await reading;

    expect(toolResultSeen(model, 1)).toEqual({ type: "text", value: "Да" });
    expect((await savedAnswer(storage))?.status).toBe("complete");
    expect(logged.filter((line) => line.startsWith("[инструмент не ответил]"))).toEqual([
      "[инструмент не ответил] чат=chat-1 инструмент=slow_report срок=30000мс",
    ]);
  });

  it("«Стоп» до срока — ход stopped, инструмент отменён, срока в журнале нет", async () => {
    const signals: AbortSignal[] = [];
    const model = scriptedModel([callTool("slow_report")]);
    const { answer, logged } = await runWithClock(model, 300_000, { tools: hangingTools(signals) }, 10_000);
    expect(answer.status).toBe("stopped");
    expect(signals[0]!.aborted).toBe(true);
    expect(logged.some((line) => line.startsWith("[инструмент не ответил]"))).toBe(false);
  });
});

describe("runAgentTurn: предел молчания потока модели", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("провайдер открыл поток и молчит: по умолчанию в 89,999 с ещё ждём, в 90 с — тихий повтор; строка [молчание модели]", async () => {
    const model = scriptedModel([silentAfter(), saying("Готово.")]);
    const storage = await storageWithQuestion();
    const logged: string[] = [];
    const reading = readAll(startTurn(storage, model, { logError: (line) => logged.push(line) }));

    await vi.advanceTimersByTimeAsync(89_999);
    expect(model.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1_250);
    await reading;

    expect(model.doStreamCalls).toHaveLength(2);
    expect((await savedAnswer(storage))?.status).toBe("complete");
    expect(logged).toContain("[молчание модели] чат=chat-1 модель=mock-model провайдер=mock ждали=первый-кусок срок=90000мс");
    expect(model.doStreamCalls[0]!.abortSignal?.aborted).toBe(true);
  });

  it("молчит и после повтора, запасного нет — через ~3 мин ход кончается error вида overloaded, а не висит", async () => {
    const model = scriptedModel([silentAfter()]);
    // Две попытки по 90 с и одна пауза повтора (1 с, разброс до 25%).
    const { chunks, answer } = await runWithClock(model, 2 * 90_000 + 1_250, { providerFallback: false });
    expect(answer.status).toBe("error");
    expect(answer.error?.kind).toBe("overloaded");
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "overloaded" }]);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("молчит и после повтора, запасной есть — через ~3 мин ответ от запасного", async () => {
    const primary = scriptedModel([silentAfter()]);
    const backup = scriptedModel([saying("Ответ запасного.")]);
    const { answer, logged } = await runWithClock(primary, 2 * 90_000 + 1_250, {
      catalog: mockCatalog({ mock: primary, "mock-backup": backup }),
      providerFallback: {},
    });
    expect(primary.doStreamCalls).toHaveLength(2);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe("mock-backup");
    expect(textOf(answer.parts)).toBe("Ответ запасного.");
    expect(logged.filter((line) => line.includes("ждали=первый-кусок"))).toHaveLength(2);
  });

  it("замолчал посреди ответа: по умолчанию 120 с между кусками — строка [молчание модели], затем автопродолжение", async () => {
    const model = scriptedModel([silentAfter([streamStart, ...textParts(["Начало, "]).slice(0, 2)]), saying("конец.")]);
    const { answer, logged } = await runWithClock(model, 120_000 + 2_500);
    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("Начало, конец.");
    expect(logged).toContain("[молчание модели] чат=chat-1 модель=mock-model провайдер=mock ждали=следующий-кусок срок=120000мс");
    expect(logged.some((line) => line.startsWith("[автопродолжение]"))).toBe(true);
  });

  it("свои сроки: 10 с до первого куска и 5 с между кусками", async () => {
    const first = scriptedModel([silentAfter(), saying("Готово.")]);
    const storage = await storageWithQuestion();
    const reading = readAll(startTurn(storage, first, { modelSilence: { firstChunkMs: 10_000, betweenChunksMs: 5_000 }, logError: () => {} }));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(first.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1_250);
    await reading;
    expect(first.doStreamCalls).toHaveLength(2);

    const between = scriptedModel([silentAfter([streamStart, ...textParts(["Начало, "]).slice(0, 2)]), saying("конец.")]);
    const { answer, logged } = await runWithClock(between, 5_000 + 2_500, { modelSilence: { firstChunkMs: 10_000, betweenChunksMs: 5_000 } });
    expect(textOf(answer.parts)).toBe("Начало, конец.");
    expect(logged).toContain("[молчание модели] чат=chat-1 модель=mock-model провайдер=mock ждали=следующий-кусок срок=5000мс");
  });

  it("пока работает серверный инструмент, модель законно молчит: 60 с инструмента при сроке молчания 5 с — не обрыв", async () => {
    const model = scriptedModel([callTool("report"), saying("Отчёт готов.")]);
    const tools: ToolSet = {
      report: tool({
        description: "Отчёт за минуту",
        inputSchema: z.object({}),
        execute: () => new Promise<string>((resolve) => setTimeout(() => resolve("отчёт"), 60_000)),
      }),
    };
    const { answer, logged } = await runWithClock(model, 60_000, {
      tools,
      modelSilence: { firstChunkMs: 10_000, betweenChunksMs: 5_000 },
    });
    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("Отчёт готов.");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(logged.filter((line) => line.startsWith("[молчание модели]") || line.startsWith("[повтор]"))).toEqual([]);
  });

  it("предел выключен (Infinity у обоих сроков): молчание не обрывается, «Стоп» останавливает ход", async () => {
    const model = scriptedModel([silentAfter()]);
    const { answer } = await runWithClock(
      model,
      1_000,
      { modelSilence: { firstChunkMs: Number.POSITIVE_INFINITY, betweenChunksMs: Number.POSITIVE_INFINITY } },
      600_000,
    );
    expect(answer.status).toBe("stopped");
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("«Стоп» во время ожидания первого куска — stopped без повторов, как раньше", async () => {
    const model = scriptedModel([silentAfter(), saying("Готово.")]);
    const { answer, logged } = await runWithClock(model, 200_000, {}, 30_000);
    expect(answer.status).toBe("stopped");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(logged.some((line) => line.startsWith("[молчание модели]"))).toBe(false);
  });
});

describe("runAgentTurn: пределы ожидания не меняют запрос модели (кэш)", () => {
  it("с любыми сроками запрос тот же: инструкция, сообщения, инструменты", async () => {
    vi.useRealTimers();
    const tools: ToolSet = {
      report: tool({ description: "Отчёт", inputSchema: z.object({}), execute: async () => "отчёт" }),
    };
    const request = async (extra: Partial<AgentTurnInput>) => {
      const model = scriptedModel([saying("Ок.")]);
      const storage = await storageWithQuestion();
      await readAll(startTurn(storage, model, { tools, ...extra }));
      const { abortSignal: _signal, ...call } = model.doStreamCalls[0]!;
      return JSON.stringify(call);
    };
    const usual = await request({});
    expect(await request({ toolTimeout: resolveToolTimeout(5_000), modelSilence: { firstChunkMs: 10_000, betweenChunksMs: 5_000 } })).toBe(usual);
    expect(await request({ toolTimeout: resolveToolTimeout(Number.POSITIVE_INFINITY) })).toBe(usual);
  });
});
