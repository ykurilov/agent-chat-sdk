import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import type { LanguageModelUsage, UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { createTurnUsage, estimateTextTokens } from "../../../src/agent-run/turn-usage";
import { newStoredMessage } from "../../../src/conversation/types";
import type { UsageRecord } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { controlledModel, finishPart, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

/** Длинная инструкция: вход запроса — не меньше 1500 токенов (кириллица — токен на два знака). */
const instructions = "и".repeat(3_000);

/** Конец шага без чисел расхода: так отвечают некоторые провайдеры. */
const finishWithoutUsage: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  },
};

const toolCallStep: LanguageModelV4StreamPart[] = [
  streamStart,
  { type: "tool-call", toolCallId: "c1", toolName: "time", input: "{}" },
  finishPart("tool-calls"),
];
const tools = { time: tool({ description: "время", inputSchema: z.object({}), execute: async () => "12:00" }) };

async function recordingStorage() {
  const storage = await storageWithQuestion();
  const written: UsageRecord[] = [];
  const recording: ChatStorage = {
    ...storage,
    insertUsageRecord: async (record) => {
      written.push(record);
      await storage.insertUsageRecord(record);
    },
  };
  return { storage: recording, written };
}

/** Читает поток хода, пока не придёт кусок `until`. */
async function readUntil(reader: ReadableStreamDefaultReader<UIMessageChunk>, until: (chunk: UIMessageChunk) => boolean) {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("поток кончился раньше");
    if (until(value)) return;
  }
}

/** Ход, второй шаг которого (после инструмента с расходом 100/30) идёт кусками по команде теста. */
async function secondStepUnderControl(storage: ChatStorage, extra: Partial<AgentTurnInput>) {
  const second = controlledModel();
  let step = 0;
  const model = new MockLanguageModelV4({
    doStream: async (options) => (step++ === 0 ? { stream: streamOf(toolCallStep) } : second.model.doStream(options)),
  });
  const reader = startTurn(storage, model, { ownerId: "anna", tools, instructions, ...extra }).getReader();
  await second.opened;
  return { reader, push: second.push, end: second.end };
}

describe("расход без чисел провайдера — оценка «примерно» (FR-050)", () => {
  it("шаг без чисел: вход и выход прикинуты по длине текста, запись и итог помечены", async () => {
    const { storage, written } = await recordingStorage();
    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["а".repeat(300)]), finishWithoutUsage]) }),
    });

    await readAll(startTurn(storage, model, { ownerId: "anna", instructions }));

    expect(written).toHaveLength(1);
    const record = written[0]!;
    expect(record.estimated).toBe(true);
    // Инструкция 3000 знаков кириллицы, короткий вопрос и дата — чуть больше 1500 токенов.
    expect(record.inputTokens).toBeGreaterThanOrEqual(1_500);
    expect(record.inputTokens).toBeLessThan(1_600);
    expect(record.outputTokens).toBe(150);
    expect(record.cachedInputTokens).toBe(0);
    const usage = (await savedAnswer(storage))!.usage!;
    expect(usage).toMatchObject({ estimated: true, inputTokens: record.inputTokens, outputTokens: 150 });
    // Размер контекста есть и у оценки: по нему решается сжатие.
    expect(usage.contextTokens).toBe(record.inputTokens + 150);
  });

  it("провайдер сообщил числа — пометки нет", async () => {
    const { storage, written } = await recordingStorage();
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["ок"]), finishPart()]) }) });

    await readAll(startTurn(storage, model, { ownerId: "anna" }));

    expect(written[0]).toMatchObject({ inputTokens: 100, outputTokens: 30 });
    expect(written[0]!.estimated).toBeFalsy();
    expect((await savedAnswer(storage))!.usage).not.toHaveProperty("estimated");
  });
});

describe("«Стоп» посреди шага — недописанный шаг оценивается (FR-051)", () => {
  it("«Стоп» на первом шаге после текста: запись «примерно» по длине запроса и написанного", async () => {
    const { storage, written } = await recordingStorage();
    const stop = new AbortController();
    const source = controlledModel();
    const reader = startTurn(storage, source.model, { ownerId: "anna", instructions, abortSignal: stop.signal }).getReader();
    await source.opened;
    source.push(streamStart, { type: "text-start", id: "txt-0" }, { type: "text-delta", id: "txt-0", delta: "а".repeat(300) });
    await readUntil(reader, (chunk) => chunk.type === "text-delta");

    stop.abort();
    while (!(await reader.read()).done);

    expect((await savedAnswer(storage))?.status).toBe("stopped");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ estimated: true, outputTokens: 150, cachedInputTokens: 0 });
    expect(written[0]!.inputTokens).toBeGreaterThanOrEqual(1_500);
    expect(written[0]!.inputTokens).toBeLessThan(1_600);
  });

  it("«Стоп» на втором шаге: вход не меньше входа и выхода прошлого шага, кэш — как у прошлого шага", async () => {
    const { storage, written } = await recordingStorage();
    const stop = new AbortController();
    const { reader, push } = await secondStepUnderControl(storage, { abortSignal: stop.signal, instructions: "Ты помощник." });
    push(streamStart, { type: "text-start", id: "txt-0" }, { type: "text-delta", id: "txt-0", delta: "б".repeat(30) });
    await readUntil(reader, (chunk) => chunk.type === "text-delta");

    stop.abort();
    while (!(await reader.read()).done);

    expect(written).toHaveLength(1);
    const record = written[0]!;
    expect(record.estimated).toBe(true);
    // Первый шаг: 100 на входе (60 из кэша), 30 на выходе. Второй: вход не меньше 100 + 30, весь прошлый вход — из кэша.
    expect(record.inputTokens).toBeGreaterThanOrEqual(100 + 130);
    expect(record.cachedInputTokens).toBe(60 + 100);
    expect(record.outputTokens).toBe(30 + 15);
  });

  it("«Стоп» до первого куска шага, запрос уже открыт — шаг оценивается входом: вход оплачен (FR-051)", async () => {
    const { storage, written } = await recordingStorage();
    const stop = new AbortController();
    const { reader, push } = await secondStepUnderControl(storage, { abortSignal: stop.signal });
    push(streamStart);
    // Провайдер ответил на запрос (поток открыт), куска ответа ещё нет.
    await new Promise((resolve) => setImmediate(resolve));

    stop.abort();
    while (!(await reader.read()).done);

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ estimated: true, outputTokens: 30 });
    // Первый шаг: 100 на входе, 30 на выходе; второй — только вход, не меньше 100 + 30.
    expect(written[0]!.inputTokens).toBeGreaterThanOrEqual(100 + 130);
  });

  it("провайдер отказал до первого куска — шаг не оценивается: отказ не оплачивается", async () => {
    const { storage, written } = await recordingStorage();
    const { reader, push } = await secondStepUnderControl(storage, { logError: () => {} });
    push(streamStart, {
      type: "error",
      error: new APICallError({ message: "ответ 400", url: "https://provider.test", requestBodyValues: {}, statusCode: 400, responseBody: "bad" }),
    });

    while (!(await reader.read()).done);

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ inputTokens: 100, outputTokens: 30 });
    expect(written[0]!.estimated).toBeFalsy();
  });
});

describe("перезапуск посреди ответа: расход не теряется (FR-052)", () => {
  it("запись ответа по ходу несёт ещё не записанный расход хода вместе с оценкой идущего шага", async () => {
    const { storage, written } = await recordingStorage();
    const flushers: NonNullable<AgentTurnInput["flushers"]> = new Set();
    const { reader, push, end } = await secondStepUnderControl(storage, { flushers, instructions: "Ты помощник." });
    push(streamStart, { type: "text-start", id: "txt-0" }, { type: "text-delta", id: "txt-0", delta: "б".repeat(30) });
    await readUntil(reader, (chunk) => chunk.type === "text-delta");

    await Promise.all([...flushers].map((flushAnswer) => flushAnswer()));

    const usage = (await storage.getMessage("a1"))!.usage!;
    expect(usage.estimated).toBe(true);
    expect(usage.inputTokens).toBeGreaterThanOrEqual(100 + 130);
    expect(usage.outputTokens).toBe(30 + 15);
    // Шаги хода с провайдером — для ступеней цены при восстановлении: завершённый и идущий.
    expect(usage.pendingSteps).toEqual([
      expect.objectContaining({ providerId: "mock", inputTokens: 100, outputTokens: 30 }),
      expect.objectContaining({ providerId: "mock", outputTokens: 15, estimated: true }),
    ]);
    // В журнал расхода до конца хода ничего не пишется.
    expect(written).toEqual([]);

    push({ type: "text-end", id: "txt-0" }, finishPart());
    end();
    while (!(await reader.read()).done);
    // Ход записан в журнал: шагов в сообщении больше нет.
    expect((await storage.getMessage("a1"))!.usage!.pendingSteps).toBeUndefined();
  });

  it("продолжение после подтверждения: идущая запись несёт весь расход сообщения — до паузы и после", async () => {
    const { storage, written } = await recordingStorage();
    const before = { inputTokens: 500, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 };
    const message = { id: "a1", role: "assistant" as const, parts: [{ type: "text" as const, text: "Начало", state: "done" as const }] };
    await storage.insertMessage(
      newStoredMessage({ id: "a1", chatId: "chat-1", parentId: "u1", role: "assistant", status: "streaming", modelId: "mock-model", providerId: "mock", parts: message.parts, usage: before }),
    );
    const source = controlledModel();
    const stop = new AbortController();
    const flushers: NonNullable<AgentTurnInput["flushers"]> = new Set();
    const reader = startTurn(storage, source.model, {
      ownerId: "anna",
      abortSignal: stop.signal,
      flushers,
      resume: { message, usage: before },
      history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }, message],
    }).getReader();
    await source.opened;
    source.push(streamStart, { type: "text-start", id: "txt-1" }, { type: "text-delta", id: "txt-1", delta: "б".repeat(30) });
    await readUntil(reader, (chunk) => chunk.type === "text-delta");

    await Promise.all([...flushers].map((flushAnswer) => flushAnswer()));

    const streaming = (await storage.getMessage("a1"))!.usage!;
    expect(streaming).toMatchObject({ outputTokens: 50 + 15, estimated: true });
    expect(streaming.inputTokens).toBeGreaterThan(500);

    stop.abort();
    while (!(await reader.read()).done);
    // Конечная запись: в сообщении весь расход, в журнал — только расход этого хода.
    expect((await storage.getMessage("a1"))!.usage).toMatchObject({ outputTokens: 50 + 15 });
    expect(written).toHaveLength(1);
    expect(written[0]!.outputTokens).toBe(15);
  });
});

describe("createTurnUsage: оценка входа", () => {
  const noUsage = { inputTokens: undefined, outputTokens: undefined } as unknown as LanguageModelUsage;

  it("файл в запросе — как 4800 знаков, то есть 1600 токенов", () => {
    const usage = createTurnUsage();
    usage.beginAttempt({ instructions: "" }, "mock");
    usage.beforeStep(0, [{ role: "user", content: [{ type: "file", data: "iVBORw0KGgo=".repeat(10_000), mediaType: "image/png" }] }]);
    usage.finishStep(noUsage, []);
    expect(usage.steps()[0]).toMatchObject({ inputTokens: 1_600, estimated: true });
  });

  it("описания и схемы инструментов входят во вход", () => {
    const usage = createTurnUsage();
    usage.beginAttempt({ instructions: "", tools: { lookup: tool({ description: "д".repeat(300), inputSchema: z.object({ query: z.string() }) }) } }, "mock");
    usage.beforeStep(0, []);
    usage.finishStep(noUsage, []);
    expect(usage.steps()[0]!.inputTokens).toBeGreaterThan(100);
  });
});

describe("estimateTextTokens: оценка по письму — скорее больше, чем меньше", () => {
  const russian =
    "Привет! Подскажи, пожалуйста, какая погода будет завтра в Москве и стоит ли брать зонт, если я пойду гулять вечером.";
  const english = "Hello! Could you please tell me what the weather will be like in Moscow tomorrow and whether I need an umbrella.";
  const json = JSON.stringify({ query: "weather", city: "Moscow", days: [1, 2, 3], units: { temp: "C", wind: "m/s" } });

  it("русский: не меньше токена на 2,5 знака (у кириллицы 2–2,5 знака на токен)", () => {
    expect(estimateTextTokens(russian)).toBeGreaterThanOrEqual(Math.ceil(russian.length / 2.5));
  });

  it("английский: около 4 знаков на токен — оценка между «4» и «3» знаками на токен", () => {
    expect(estimateTextTokens(english)).toBeGreaterThanOrEqual(Math.ceil(english.length / 4));
    expect(estimateTextTokens(english)).toBeLessThanOrEqual(Math.ceil(english.length / 3));
  });

  it("русский плотнее английского той же длины, JSON плотнее английского", () => {
    const sameLength = (text: string) => text.repeat(10).slice(0, 300);
    expect(estimateTextTokens(sameLength(russian))).toBeGreaterThan(estimateTextTokens(sameLength(english)));
    expect(estimateTextTokens(sameLength(json))).toBeGreaterThan(estimateTextTokens(sameLength(english)));
  });

  it("иероглифы — не меньше токена на знак", () => {
    expect(estimateTextTokens("今天天气怎么样")).toBeGreaterThanOrEqual(7);
  });

  it("пусто — ноль", () => {
    expect(estimateTextTokens("")).toBe(0);
  });
});
