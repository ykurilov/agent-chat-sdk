import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyProviderError } from "../../../src/provider-errors/classify-provider-error";
import {
  FirstChunkTimeoutError,
  StreamStallError,
  createTransientRetryMiddleware,
  transientRetryMiddleware,
} from "../../../src/provider-errors/transient-retry-middleware";
import type { TransientRetryContext } from "../../../src/provider-errors/transient-retry-middleware";
import { finishPart, generateResult, readAll, reasoningAndTextParts, streamOf } from "../support/mock-model";

function apiError(statusCode: number | undefined, responseHeaders?: Record<string, string>): APICallError {
  return new APICallError({
    message: `ошибка ${statusCode ?? "сети"}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    ...(statusCode !== undefined && { statusCode }),
    ...(responseHeaders && { responseHeaders }),
    isRetryable: statusCode === undefined || statusCode === 429 || statusCode >= 500,
  });
}

type Attempt = (
  options: { abortSignal?: AbortSignal },
) => ReadableStream<LanguageModelV4StreamPart> | Error | Promise<never>;

/** Модель, которая на каждой попытке делает своё: бросает ошибку или отдаёт поток. Дальше — последняя. */
function modelWith(attempts: Attempt[], context: TransientRetryContext = { random: () => 0 }) {
  const inner = new MockLanguageModelV4();
  const calls: Array<{ abortSignal?: AbortSignal }> = [];
  inner.doStream = (async (options: { abortSignal?: AbortSignal }) => {
    calls.push(options);
    const outcome = attempts[Math.min(calls.length - 1, attempts.length - 1)]!(options);
    if (outcome instanceof Error) throw outcome;
    if (outcome instanceof Promise) return outcome;
    return { stream: outcome };
  }) as MockLanguageModelV4["doStream"];
  const model = wrapLanguageModel({ model: inner, middleware: createTransientRetryMiddleware(context) });
  return { model, calls };
}

const answer = () => streamOf(reasoningAndTextParts(["Готово"]));
const fail = (statusCode: number | undefined, headers?: Record<string, string>) => () => apiError(statusCode, headers);
const throwing = (error: unknown) => () => error as Error;
/** Поток, в котором до первого куска ответа пришла ошибка-объект. */
const errorChunk = (error: unknown) => () =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "error", error },
  ]);

/** Поток, который ничего не отдаёт, пока его не отменят. */
function silentStream(options: { abortSignal?: AbortSignal }): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      options.abortSignal?.addEventListener("abort", () => controller.error(options.abortSignal?.reason));
    },
  });
}

function textOf(parts: LanguageModelV4StreamPart[]): string {
  return parts.map((part) => (part.type === "text-delta" ? part.delta : "")).join("");
}

describe("transientRetryMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Запускает запрос и сразу подписывает обработчик, чтобы отказ не считался необработанным. */
  function start(model: ReturnType<typeof modelWith>["model"], abortSignal?: AbortSignal) {
    const result = model.doStream({ prompt: [], ...(abortSignal && { abortSignal }) });
    const settled = result.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    return settled;
  }

  it.each([429, 500, 502, 503, 504, 529])("статус %i — повторы с паузами 1 с, 3 с, 6 с", async (status) => {
    const { model, calls } = modelWith([fail(status), fail(status), fail(status), answer]);
    const result = start(model);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(4);

    const settled = await result;
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(textOf(await readAll(settled.value.stream))).toBe("Готово");
  });

  it("после трёх повторов отдаёт последнюю ошибку", async () => {
    const { model, calls } = modelWith([fail(503)]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(10_000);
    const settled = await result;
    expect(calls).toHaveLength(4);
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(APICallError.isInstance(settled.error) && settled.error.statusCode).toBe(503);
  });

  it("следующий шаг после начавшегося ответа — прежние повторы, даже когда callback ещё предлагает быстрый переход", async () => {
    const { model, calls } = modelWith([answer, fail(503)], { random: () => 0, retryDelaysMs: () => [] });
    const first = await start(model);
    expect(first.ok).toBe(true);
    if (first.ok) await readAll(first.value.stream);
    const next = start(model);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await next).ok).toBe(false);
    expect(calls).toHaveLength(5);
  });

  it("retryDelaysMs: [] не выключает повтор молчания до первого куска", async () => {
    const { model, calls } = modelWith([silentStream], {
      random: () => 0, retryDelaysMs: () => [], silence: { firstChunkMs: 100, betweenChunksMs: 100 },
    });
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_200);
    const settled = await result;
    expect(calls).toHaveLength(2);
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error).toBeInstanceOf(FirstChunkTimeoutError);
  });

  it("ошибка сети без статуса — тоже временная", async () => {
    const { model, calls } = modelWith([fail(undefined), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it.each([401, 402, 403])("статус %i — ошибка сразу, без повторов", async (status) => {
    const { model, calls } = modelWith([fail(status), answer]);
    const settled = await start(model);
    expect(settled.ok).toBe(false);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it("retry-after-ms в пределах запаса берётся вместо паузы", async () => {
    const { model, calls } = modelWith([fail(429, { "retry-after-ms": "2500" }), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect((await result).ok).toBe(true);
  });

  it("retry-after в секундах в пределах запаса берётся вместо паузы", async () => {
    const { model, calls } = modelWith([fail(503, { "retry-after": "4" }), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect((await result).ok).toBe(true);
  });

  it("retry-after длиннее оставшегося запаса не берётся: пауза обычная", async () => {
    const { model, calls } = modelWith([fail(503, { "retry-after": "30" }), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    expect((await result).ok).toBe(true);
  });

  it("запас считается от уже прожданного: retry-after 8 с после паузы 1 с не влезает", async () => {
    const { model, calls } = modelWith([fail(503), fail(503, { "retry-after": "9.5" }), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    // Осталось 9 с запаса, 9,5 с не влезает — обычные 3 с.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls).toHaveLength(3);
    expect((await result).ok).toBe(true);
  });

  it("ошибка в потоке до первого куска ответа повторяется", async () => {
    const errorBeforeOutput = () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "error", error: apiError(503) },
      ]);
    const { model, calls } = modelWith([errorBeforeOutput, answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    const settled = await result;
    expect(calls).toHaveLength(2);
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      const parts = await readAll(settled.value.stream);
      expect(textOf(parts)).toBe("Готово");
      expect(parts.some((part) => part.type === "error")).toBe(false);
    }
  });

  it("ошибка после первого куска ответа идёт наружу без повтора", async () => {
    const errorAfterOutput = () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Начало" },
        { type: "error", error: apiError(503) },
      ]);
    const { model, calls } = modelWith([errorAfterOutput, answer]);
    const settled = await start(model);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    const parts = await readAll(settled.value.stream);
    expect(textOf(parts)).toBe("Начало");
    expect(parts.at(-1)?.type).toBe("error");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it("куски до первого куска ответа не теряются и не двоятся", async () => {
    const { model } = modelWith([answer]);
    const settled = await start(model);
    if (!settled.ok) throw settled.error;
    expect(await readAll(settled.value.stream)).toEqual(reasoningAndTextParts(["Готово"]));
  });

  it("пустой ответ без кусков текста проходит как есть", async () => {
    const empty = () => streamOf([{ type: "stream-start", warnings: [] }, finishPart()]);
    const { model } = modelWith([empty]);
    const settled = await start(model);
    if (!settled.ok) throw settled.error;
    expect((await readAll(settled.value.stream)).map((part) => part.type)).toEqual(["stream-start", "finish"]);
  });

  it("90 с без первого куска — таймаут: попытка отменяется и повторяется", async () => {
    const { model, calls } = modelWith([silentStream, answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.abortSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls[0]?.abortSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    const settled = await result;
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(textOf(await readAll(settled.value.stream))).toBe("Готово");
  });

  it("провайдер не отвечает даже заголовками — тоже таймаут", async () => {
    const { model, calls } = modelWith([() => new Promise(() => {}), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(91_000);
    expect(calls).toHaveLength(2);
    expect((await result).ok).toBe(true);
  });

  it("молчание до первого куска повторяется у того же провайдера один раз: второй срок — ошибка наружу, третьей попытки нет", async () => {
    const { model, calls } = modelWith([silentStream]);
    const result = start(model);
    // 90 с, пауза 1 с, ещё 90 с: лёгший провайдер держит ход ~3 мин, а не четыре срока подряд.
    await vi.advanceTimersByTimeAsync(90_000 + 1_000 + 89_999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    const settled = await result;
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error).toBeInstanceOf(FirstChunkTimeoutError);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(calls).toHaveLength(2);
  });

  it("repeatSilence: false — молчание до первого куска не повторяется у того же провайдера: ошибка наружу сразу", async () => {
    const { model, calls } = modelWith([silentStream, answer], { random: () => 0, repeatSilence: false });
    const result = start(model);
    await vi.advanceTimersByTimeAsync(90_000);
    const settled = await result;
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error).toBeInstanceOf(FirstChunkTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it("repeatSilence: false не трогает прочие сбои: 503 повторяется как раньше", async () => {
    const { model, calls } = modelWith([fail(503), answer], { random: () => 0, repeatSilence: false });
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    expect((await result).ok).toBe(true);
  });

  it("лимит повтора молчания не трогает прочие сбои: 503, молчание, 503 — повторы как раньше, второе молчание — конец", async () => {
    const recovered = modelWith([fail(503), silentStream, fail(503), answer]);
    const ok = start(recovered.model);
    await vi.advanceTimersByTimeAsync(1_000 + 90_000 + 3_000 + 6_000);
    expect((await ok).ok).toBe(true);
    expect(recovered.calls).toHaveLength(4);

    const twice = modelWith([fail(503), silentStream, silentStream, answer]);
    const failed = start(twice.model);
    await vi.advanceTimersByTimeAsync(1_000 + 90_000 + 3_000 + 90_000);
    const settled = await failed;
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error).toBeInstanceOf(FirstChunkTimeoutError);
    expect(twice.calls).toHaveLength(3);
  });

  it("после первого куска срок 90 с больше не действует", async () => {
    const slowAfterStart = () =>
      new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "Раз" });
          setTimeout(() => {
            controller.enqueue({ type: "text-delta", id: "t", delta: " два" });
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue(finishPart());
            controller.close();
          }, 100_000);
        },
      });
    const { model, calls } = modelWith([slowAfterStart]);
    const settled = await start(model);
    if (!settled.ok) throw settled.error;
    const reading = readAll(settled.value.stream);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(textOf(await reading)).toBe("Раз два");
    expect(calls).toHaveLength(1);
  });

  it("отмена во время паузы прерывает ожидание без новой попытки", async () => {
    const { model, calls } = modelWith([fail(503), answer]);
    const controller = new AbortController();
    const result = start(model, controller.signal);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    const settled = await result;
    expect(settled.ok).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it("отмена во время ожидания первого куска отменяет попытку и не повторяет", async () => {
    const { model, calls } = modelWith([silentStream, answer]);
    const controller = new AbortController();
    const result = start(model, controller.signal);
    await vi.advanceTimersByTimeAsync(5_000);
    controller.abort();
    const settled = await result;
    expect(settled.ok).toBe(false);
    expect(calls[0]?.abortSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(calls).toHaveLength(1);
  });
  it("готовый экспорт transientRetryMiddleware — та же обёртка без журнала", () => {
    expect(transientRetryMiddleware.wrapStream).toBeTypeOf("function");
    expect(transientRetryMiddleware.wrapGenerate).toBeTypeOf("function");
  });

  it("ошибка кусочком потока с code 502 «Provider returned error» до первого куска — повтор", async () => {
    const { model, calls } = modelWith([errorChunk({ code: 502, message: "Provider returned error" }), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    const settled = await result;
    expect(calls).toHaveLength(2);
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(textOf(await readAll(settled.value.stream))).toBe("Готово");
  });

  it("ошибка кусочком потока без кода с текстом «Provider returned error» — повтор", async () => {
    const { model, calls } = modelWith([errorChunk({ message: "Provider returned error" }), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("Error(\"fetch failed\") — повтор", async () => {
    const { model, calls } = modelWith([throwing(new TypeError("fetch failed")), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it.each([408, 409])("статус %i — повтор", async (status) => {
    const { model, calls } = modelWith([fail(status), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("x-should-retry: true при 400 — повтор", async () => {
    const { model, calls } = modelWith([fail(400, { "x-should-retry": "true" }), answer]);
    const result = start(model);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("x-should-retry: false при 503 — без повтора", async () => {
    const { model, calls } = modelWith([fail(503, { "x-should-retry": "false" }), answer]);
    const settled = await start(model);
    expect(settled.ok).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it("4xx с временным текстом не повторяется: текст смотрится только без кода или при коде ≥ 500", async () => {
    const error = new APICallError({
      message: "Bad request: 500 items, server error",
      url: "https://provider.test",
      requestBodyValues: {},
      statusCode: 400,
    });
    const { model, calls } = modelWith([throwing(error), answer]);
    const settled = await start(model);
    expect(settled.ok).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["переполнение с 400", { code: 400, message: "maximum context length is 131072 tokens" }],
    ["переполнение с 500", { code: 500, message: "maximum context length is 131072 tokens" }],
    ["квота с 429", { code: 429, message: "insufficient_quota" }],
    ["квота без кода", { message: "You exceeded your current quota exceeded, check billing" }],
  ])("%s — без повтора", async (_name, error) => {
    const { model, calls } = modelWith([errorChunk(error), answer]);
    const settled = await start(model);
    expect(settled.ok).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it("429 «Quota exceeded … per minute» — повторяется: это лимит в минуту, не пустой счёт", async () => {
    const error = { code: 429, message: "Quota exceeded for metric: generate_content_requests, limit: 15 per minute. Please check your plan and billing details." };
    const { model, calls } = modelWith([errorChunk(error), answer]);
    const settled = start(model);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(2);
    expect((await settled).ok).toBe(true);
  });

  it("разброс 0–25%: пауза растёт со случайностью, общий бюджет не больше 10 с", async () => {
    const { model, calls } = modelWith([fail(503)], { random: () => 0.8 });
    const result = start(model);
    // Паузы ×1,2: 1,2 с и 3,6 с.
    await vi.advanceTimersByTimeAsync(1_199);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_599);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    // Третья пауза упирается в остаток бюджета: 10 − 1,2 − 3,6 = 5,2 с вместо 7,2 с.
    await vi.advanceTimersByTimeAsync(5_199);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(4);
    expect((await result).ok).toBe(false);
  });

  it("случайность по умолчанию даёт паузу в пределах 1–1,25 с", async () => {
    const { model, calls } = modelWith([fail(503), answer], {});
    const result = start(model);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(calls).toHaveLength(2);
    expect((await result).ok).toBe(true);
  });

  it("подменённые sleep и now: пауза идёт через sleep, retry-after датой считается от now", async () => {
    const slept: number[] = [];
    const now = Date.parse("2026-10-02T12:00:00.000Z");
    const { model, calls } = modelWith([fail(429, { "retry-after": new Date(now + 2_000).toUTCString() }), fail(503), answer], {
      random: () => 0,
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const settled = await start(model);
    expect(settled.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([2_000, 3_000]);
  });

  it("wrapGenerate: 429, затем ответ → ответ", async () => {
    const inner = new MockLanguageModelV4();
    let call = 0;
    inner.doGenerate = (async () => {
      call++;
      if (call === 1) throw apiError(429);
      return generateResult("сводка");
    }) as MockLanguageModelV4["doGenerate"];
    const model = wrapLanguageModel({ model: inner, middleware: createTransientRetryMiddleware({ random: () => 0 }) });
    const result = model.doGenerate({ prompt: [] });
    await vi.advanceTimersByTimeAsync(1_000);
    const generated = await result;
    expect(call).toBe(2);
    expect(generated.content).toEqual([{ type: "text", text: "сводка" }]);
  });

  it("wrapGenerate: ключ не подходит — ошибка сразу", async () => {
    const inner = new MockLanguageModelV4();
    let call = 0;
    inner.doGenerate = (async () => {
      call++;
      throw apiError(401);
    }) as MockLanguageModelV4["doGenerate"];
    const model = wrapLanguageModel({ model: inner, middleware: createTransientRetryMiddleware({ random: () => 0 }) });
    await expect(model.doGenerate({ prompt: [] })).rejects.toSatisfy((error) => APICallError.isInstance(error));
    expect(call).toBe(1);
  });

  it("после первого куска 120 с тишины — StreamStallError, классификатор даёт overloaded", async () => {
    const stalling = (options: { abortSignal?: AbortSignal }) =>
      new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "Начало" });
          options.abortSignal?.addEventListener("abort", () => controller.error(options.abortSignal?.reason));
        },
      });
    const { model, calls } = modelWith([stalling, answer]);
    const settled = await start(model);
    if (!settled.ok) throw settled.error;
    const parts: LanguageModelV4StreamPart[] = [];
    const reader = settled.value.stream.getReader();
    const reading = (async () => {
      for (;;) {
        const read = await reader.read();
        if (read.done) return undefined;
        parts.push(read.value);
      }
    })().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(textOf(parts)).toBe("Начало");
    expect(calls[0]?.abortSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await reading;
    expect(error).toBeInstanceOf(StreamStallError);
    expect(classifyProviderError(error)).toBe("overloaded");
    // Провайдер получил отмену, повтора после первого куска нет.
    expect(calls[0]?.abortSignal?.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("срок тишины считается между кусками: кусок каждые 100 с не обрывает ответ", async () => {
    const steady = () =>
      new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "1" });
          setTimeout(() => controller.enqueue({ type: "text-delta", id: "t", delta: "2" }), 100_000);
          setTimeout(() => {
            controller.enqueue({ type: "text-delta", id: "t", delta: "3" });
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue(finishPart());
            controller.close();
          }, 200_000);
        },
      });
    const { model } = modelWith([steady]);
    const settled = await start(model);
    if (!settled.ok) throw settled.error;
    const reading = readAll(settled.value.stream);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(textOf(await reading)).toBe("123");
  });

  it("с logError — строка [повтор] на каждую попытку: чат, модель, провайдер, номер, код и пауза", async () => {
    const logged: string[] = [];
    const { model } = modelWith([fail(503), errorChunk({ message: "socket hang up" }), answer], {
      chatId: "chat-7",
      modelId: "deepseek-v4",
      providerId: "fireworks",
      logError: (message) => logged.push(message),
      random: () => 0,
    });
    const result = start(model);
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await result).ok).toBe(true);
    expect(logged).toEqual([
      "[повтор] чат=chat-7 модель=deepseek-v4 провайдер=fireworks попытка=2 код=503 пауза=1000мс",
      "[повтор] чат=chat-7 модель=deepseek-v4 провайдер=fireworks попытка=3 имя=нет пауза=3000мс",
    ]);
  });

  it("свои сроки молчания из контекста: 10 с до первого куска, 5 с между кусками; строка [молчание модели] на каждый срок", async () => {
    const logged: string[] = [];
    const stalling = (options: { abortSignal?: AbortSignal }) =>
      new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "Начало" });
          options.abortSignal?.addEventListener("abort", () => controller.error(options.abortSignal?.reason));
        },
      });
    const { model, calls } = modelWith([silentStream, stalling], {
      random: () => 0,
      chatId: "chat-7",
      modelId: "deepseek-v4",
      providerId: "fireworks",
      logError: (message) => logged.push(message),
      silence: { firstChunkMs: 10_000, betweenChunksMs: 5_000 },
    });
    const result = start(model);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1_000);
    expect(calls).toHaveLength(2);
    const settled = await result;
    if (!settled.ok) throw settled.error;
    const reading = readAll(settled.value.stream).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await reading).toBeInstanceOf(StreamStallError);
    expect(logged).toEqual([
      "[молчание модели] чат=chat-7 модель=deepseek-v4 провайдер=fireworks ждали=первый-кусок срок=10000мс",
      "[повтор] чат=chat-7 модель=deepseek-v4 провайдер=fireworks попытка=2 имя=FirstChunkTimeoutError пауза=1000мс",
      "[молчание модели] чат=chat-7 модель=deepseek-v4 провайдер=fireworks ждали=следующий-кусок срок=5000мс",
    ]);
  });

  it("сроки молчания Infinity — таймеров нет, молчание не обрывается; отмена работает", async () => {
    const { model, calls } = modelWith([silentStream, answer], {
      random: () => 0,
      silence: { firstChunkMs: Number.POSITIVE_INFINITY, betweenChunksMs: Number.POSITIVE_INFINITY },
    });
    const controller = new AbortController();
    const result = start(model, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls).toHaveLength(1);
    controller.abort();
    expect((await result).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("без повторов журнал молчит", async () => {
    const logged: string[] = [];
    const { model } = modelWith([answer], { logError: (message) => logged.push(message), random: () => 0 });
    expect((await start(model)).ok).toBe(true);
    expect(logged).toEqual([]);
  });
});
