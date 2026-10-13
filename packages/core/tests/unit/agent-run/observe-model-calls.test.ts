import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, generateText, jsonSchema, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import type { ModelCallEvent, ModelCallPurpose, TurnObserver } from "../../../src/agent-run/turn-observer";
import type { AgentChatMessage } from "../../../src/conversation/types";
import {
  controlledModel,
  finishPart,
  generateResult,
  mockCatalog,
  mockEnv,
  mockModelId,
  mockUsage,
  reasoningParts,
  streamOf,
  streamStart,
  textParts,
} from "../support/mock-model";

const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000, cachedInputPerMillion: 500_000 };
const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }];

const lookup = tool({
  description: "Ищет по базе",
  inputSchema: jsonSchema<{ query: string }>({ type: "object", properties: { query: { type: "string" } } }),
  execute: async () => "нашёл",
});

function recordingObserver() {
  const calls: ModelCallEvent[] = [];
  const observer: TurnObserver = { modelCall: (event) => calls.push(event), toolCall: () => {} };
  return { observer, calls };
}

async function requestWith(
  model: MockLanguageModelV4,
  observer: TurnObserver | undefined,
  extra: { purpose?: ModelCallPurpose; logError?: (message: string) => void; tools?: boolean } = {},
) {
  return buildModelRequest({
    catalog: mockCatalog({ mock: model }, { pricing }),
    modelId: mockModelId,
    providerId: "mock",
    chatId: "chat-1",
    instructions: "Ты помощник.",
    ...(extra.tools !== false && { tools: { lookup } }),
    history,
    env: mockEnv,
    logError: extra.logError ?? (() => {}),
    ...(observer && { observe: { observer, ownerId: "anna", messageId: "a1", purpose: extra.purpose ?? "answer" } }),
  });
}

const busy = () =>
  new APICallError({
    message: "ответ 503",
    url: "https://provider.test",
    requestBodyValues: {},
    statusCode: 503,
    responseBody: "busy",
    responseHeaders: { "retry-after-ms": "1" },
    isRetryable: true,
  });

describe("observeModelCalls: поток", () => {
  it("законченное обращение: что ушло, что пришло, расход и цена", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: streamOf([
          streamStart,
          ...reasoningParts("думаю"),
          ...textParts(["При", "вет"]),
          { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: '{"query":"чай"}' },
          finishPart("tool-calls"),
        ]),
      }),
    });
    const { observer, calls } = recordingObserver();
    const request = await requestWith(model, observer);
    await streamText({ ...request, maxOutputTokens: 500, temperature: 0.3 }).consumeStream();

    expect(calls).toHaveLength(1);
    const event = calls[0]!;
    expect(event).toMatchObject({
      chatId: "chat-1",
      ownerId: "anna",
      messageId: "a1",
      purpose: "answer",
      attempt: 1,
      modelId: mockModelId,
      providerId: "mock",
      status: "complete",
      error: null,
    });
    expect(typeof event.callId).toBe("string");
    expect(event.request.instructions).toEqual({ role: "system", content: "Ты помощник." });
    expect(event.request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Привет" }] }]);
    expect(event.request.tools).toEqual([
      { name: "lookup", description: "Ищет по базе", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    ]);
    expect(event.request.settings).toMatchObject({ maxOutputTokens: 500, temperature: 0.3 });
    // Заголовки (там ключи) и служебное SDK в событие не попадают.
    expect(event.request.settings).not.toHaveProperty("headers");
    expect(event.request.settings).not.toHaveProperty("abortSignal");
    expect(event.request.settings).not.toHaveProperty("prompt");
    expect(event.response).toEqual({
      text: "Привет",
      reasoning: "думаю",
      toolCalls: [{ toolCallId: "call-1", toolName: "lookup", input: { query: "чай" } }],
      finishReason: "tool-calls",
    });
    expect(event.usage).toEqual({ inputTokens: 100, cachedInputTokens: 60, cacheWriteTokens: 0, outputTokens: 30, reasoningTokens: 10 });
    // 40 обычных по 1 $ + 60 из кэша по 0,5 $ + 30 выхода по 2 $ за токен.
    expect(event.costUsd).toBeCloseTo(40 + 30 + 60, 6);
    expect(event.startedAt).toBeInstanceOf(Date);
    expect(event.firstChunkMs).toEqual(expect.any(Number));
    expect(event.durationMs).toBeGreaterThanOrEqual(event.firstChunkMs!);
  });

  it("провайдер упал первым запросом — два события: попытка 1 со сбоем и попытка 2", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        if (call++ === 0) throw busy();
        return { stream: streamOf([streamStart, ...textParts(["Ок"]), finishPart()]) };
      },
    });
    const { observer, calls } = recordingObserver();
    await streamText(await requestWith(model, observer)).consumeStream();

    expect(calls.map(({ attempt, status }) => ({ attempt, status }))).toEqual([
      { attempt: 1, status: "error" },
      { attempt: 2, status: "complete" },
    ]);
    expect(calls[0]!.error).toContain("503");
    expect(calls[0]!.usage).toBeNull();
    expect(calls[0]!.costUsd).toBeNull();
    expect(calls[0]!.firstChunkMs).toBeNull();
    expect(calls[0]!.callId).not.toBe(calls[1]!.callId);
    // Обе попытки — один и тот же запрос.
    expect(calls[1]!.request).toEqual(calls[0]!.request);
  });

  it("шаги одного хода — каждый с попытки 1", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () =>
        call++ === 0
          ? { stream: streamOf([streamStart, { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: '{"query":"x"}' }, finishPart("tool-calls")]) }
          : { stream: streamOf([streamStart, ...textParts(["Готово"]), finishPart()]) },
    });
    const { observer, calls } = recordingObserver();
    await streamText({ ...(await requestWith(model, observer)), stopWhen: stepCountIs(3) }).consumeStream();
    expect(calls.map((event) => event.attempt)).toEqual([1, 1]);
    // Второй шаг видит вызов и результат инструмента в сообщениях.
    expect(JSON.stringify(calls[1]!.request.messages)).toContain("нашёл");
  });

  it("обрыв потока отменой — статус aborted", async () => {
    const controlled = controlledModel();
    const { observer, calls } = recordingObserver();
    const abort = new AbortController();
    let textSeen!: () => void;
    const seen = new Promise<void>((resolve) => (textSeen = resolve));
    const result = streamText({
      ...(await requestWith(controlled.model, observer)),
      abortSignal: abort.signal,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") textSeen();
      },
    });
    const consumed = result.consumeStream();
    await controlled.opened;
    controlled.push(streamStart, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Нач" });
    await seen;
    expect(calls).toHaveLength(0);
    abort.abort();
    await consumed;
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ status: "aborted", attempt: 1 });
    expect(calls[0]!.response.text).toBe("Нач");
  });

  it("отказ провайдера посреди потока — статус error", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: streamOf([streamStart, ...textParts(["Нач"]), { type: "error", error: new Error("провайдер отказал") } as LanguageModelV4StreamPart]),
      }),
    });
    const { observer, calls } = recordingObserver();
    await streamText({ ...(await requestWith(model, observer)), onError: () => {} }).consumeStream();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "error", error: "провайдер отказал" });
  });

  it("бросок наблюдателя не ломает ответ: уходит в logError", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ок"]), finishPart()]) }) });
    const logError = vi.fn();
    const observer: TurnObserver = {
      modelCall: () => {
        throw new Error("журнал упал");
      },
      toolCall: () => {},
    };
    const result = streamText(await requestWith(model, observer, { logError }));
    expect(await result.text).toBe("Ок");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("журнал упал"));
  });

  it("ядро не меняет prompt после отправки: замороженный запрос проходит, событие не меняется до конца хода", async () => {
    const deepFreeze = (value: unknown): void => {
      if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
      Object.freeze(value);
      for (const field of Object.values(value)) deepFreeze(field);
    };
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async (params: LanguageModelV4CallOptions) => {
        // Всё, что ушло провайдеру, заморожено: попытка ядра или SDK поменять это потом бросит ошибку.
        deepFreeze(params.prompt);
        deepFreeze(params.tools);
        deepFreeze(params.providerOptions);
        return call++ === 0
          ? { stream: streamOf([streamStart, { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: '{"query":"x"}' }, finishPart("tool-calls")]) }
          : { stream: streamOf([streamStart, ...textParts(["Готово"]), finishPart()]) };
      },
    });
    const seen: string[] = [];
    const events: ModelCallEvent[] = [];
    const observer: TurnObserver = {
      modelCall: (event) => {
        seen.push(JSON.stringify(event.request));
        events.push(event);
      },
      toolCall: () => {},
    };
    const result = streamText({ ...(await requestWith(model, observer)), stopWhen: stepCountIs(3) });
    expect(await result.text).toBe("Готово");
    expect(events.map((event) => JSON.stringify(event.request))).toEqual(seen);
  });
});

describe("observeModelCalls: без потока (generate)", () => {
  it("сводка: назначение, текст, расход", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("Сводка", { output: 20 }) });
    const { observer, calls } = recordingObserver();
    const request = await requestWith(model, observer, { purpose: "compaction", tools: false });
    await generateText({ model: request.model, instructions: request.instructions, messages: request.messages });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      purpose: "compaction",
      attempt: 1,
      status: "complete",
      response: { text: "Сводка", reasoning: "", toolCalls: [], finishReason: "stop" },
      usage: { inputTokens: 100, cachedInputTokens: 60, cacheWriteTokens: 0, outputTokens: 20, reasoningTokens: 0 },
    });
    expect(calls[0]!.request.tools).toEqual([]);
  });

  it("сбой первой попытки — две попытки с номерами", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (call++ === 0) throw busy();
        return generateResult("Сводка");
      },
    });
    const { observer, calls } = recordingObserver();
    const request = await requestWith(model, observer, { purpose: "compaction", tools: false });
    await generateText({ model: request.model, instructions: request.instructions, messages: request.messages, maxRetries: 0 });
    expect(calls.map(({ attempt, status }) => ({ attempt, status }))).toEqual([
      { attempt: 1, status: "error" },
      { attempt: 2, status: "complete" },
    ]);
  });
});

describe("без наблюдателя", () => {
  it("модель не обёрнута ничем лишним: запрос тот же, что с наблюдателем", async () => {
    const answer = () => new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ок"]), finishPart()]) }) });
    const plain = answer();
    const observed = answer();
    await streamText(await requestWith(plain, undefined)).consumeStream();
    await streamText(await requestWith(observed, recordingObserver().observer)).consumeStream();
    const sent = (model: MockLanguageModelV4) => JSON.stringify(model.doStreamCalls.map(({ abortSignal: _abortSignal, ...call }) => call));
    expect(sent(observed)).toBe(sent(plain));
    expect(mockUsage.inputTokens.total).toBe(100);
  });
});
