import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { TODAY_PREFIX } from "../../../src/agent-run/today";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelCatalog, ModelPrice, ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";

export const mockModelId = "mock-model";
export const mockProviderIds = ["mock", "mock-backup"] as const;

export const mockUsage = {
  inputTokens: { total: 100, noCache: 40, cacheRead: 60, cacheWrite: 0 },
  outputTokens: { total: 30, text: 20, reasoning: 10 },
};

export const streamStart: LanguageModelV4StreamPart = { type: "stream-start", warnings: [] };

export function finishPart(reason: "stop" | "tool-calls" = "stop"): LanguageModelV4StreamPart {
  return { type: "finish", finishReason: { unified: reason, raw: reason }, usage: mockUsage };
}

export function reasoningParts(reasoning = "думаю", id = "reasoning-0"): LanguageModelV4StreamPart[] {
  return [
    { type: "reasoning-start", id },
    { type: "reasoning-delta", id, delta: reasoning },
    { type: "reasoning-end", id },
  ];
}

export function textParts(deltas: string[], id = "txt-0"): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id },
    ...deltas.map((delta): LanguageModelV4StreamPart => ({ type: "text-delta", id, delta })),
    { type: "text-end", id },
  ];
}

/** Рассуждение, затем текст по кускам, затем конец. */
export function reasoningAndTextParts(text: string[], reasoning = "думаю"): LanguageModelV4StreamPart[] {
  return [streamStart, ...reasoningParts(reasoning), ...textParts(text), finishPart()];
}

export function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

export function mockModel(
  stream: (options: { abortSignal?: AbortSignal }) => ReadableStream<LanguageModelV4StreamPart>,
): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doStream: async (options) => ({ stream: stream(options) }) });
}

/** Модель, которая отвечает «ответ» (размер контекста после каждого ответа — по списку `contexts`, последний повторяется), а на запрос сжатия отдаёт `summary`. */
export function summarizingModel(summary: string, contexts: number[] = [100, 300, 400]): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const context = contexts[call++] ?? contexts.at(-1)!;
      return {
        stream: streamOf([
          streamStart,
          ...textParts(["ответ"]),
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: context, noCache: context, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          },
        ]),
      };
    },
    doGenerate: async () => generateResult(summary, { output: 20 }),
  });
}

/** Модель, чьим потоком управляет тест: куски идут по `push`, `opened` — когда ход открыл поток. */
export function controlledModel() {
  let controller!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
  let opened!: () => void;
  const model = mockModel(
    ({ abortSignal }) =>
      new ReadableStream({
        start(streamController) {
          controller = streamController;
          abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          opened();
        },
      }),
  );
  return {
    model,
    opened: new Promise<void>((resolve) => {
      opened = resolve;
    }),
    push: (...parts: LanguageModelV4StreamPart[]) => parts.forEach((part) => controller.enqueue(part)),
    end: () => controller.close(),
  };
}

/** Каталог с двумя провайдерами-заглушками одной модели: модели задаёт тест. */
/** Третий провайдер модели: есть в каталоге, только если для него задана модель. */
export const thirdProviderId = "mock-third";

export function mockCatalog(
  models: Partial<Record<(typeof mockProviderIds)[number] | typeof thirdProviderId, MockLanguageModelV4>>,
  options: { pricing?: ModelPrice } = {},
): ModelCatalog {
  const providerIds: string[] = models[thirdProviderId] ? [...mockProviderIds, thirdProviderId] : [...mockProviderIds];
  const providers: ProviderDescription[] = providerIds.map((id) => ({
    id,
    displayName: id,
    apiKeyEnv: "MOCK_API_KEY",
    createLanguageModel: () => {
      const model = models[id as keyof typeof models];
      if (!model) throw new Error(`для провайдера ${id} модель не задана`);
      return model;
    },
    requestOptions: () => ({}),
  }));
  return extendCatalog(standardCatalog, {
    addProviders: providers,
    addModels: [
      {
        id: mockModelId,
        displayName: "Mock Model",
        contextWindowTokens: 1000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: Object.fromEntries(providerIds.map((id) => [id, "mock-v1"])),
        ...(options.pricing && { pricing: Object.fromEntries(providerIds.map((id) => [id, options.pricing!])) }),
      },
    ],
  });
}

export const mockEnv = { MOCK_API_KEY: "не-настоящий-ключ" };

export async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

/** Итог `doGenerate` (запрос без потока, например сжатие): текст, причина конца и расход. */
export function generateResult(
  text: string,
  options: { finish?: "stop" | "length"; output?: number; reasoning?: number; input?: number } = {},
) {
  const { finish = "stop", output = 30, reasoning = 0, input = 100 } = options;
  return {
    content: text === "" ? [] : [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: input, noCache: input - 60, cacheRead: 60, cacheWrite: 0 },
      outputTokens: { total: output, text: output - reasoning, reasoning },
    },
    warnings: [],
  };
}

/**
 * Тексты запроса без части с сегодняшней датой: она в хвосте каждого запроса службы и меняется по дням. Для тестов,
 * которые проверяют не дату, а историю и пометки; саму дату проверяет `run-agent-turn-date.test.ts`.
 */
export const withoutToday = (texts: string[]): string[] => texts.filter((text) => !text.startsWith(TODAY_PREFIX));

/**
 * Части ответа без застывших блоков хода: часть с ними первая в каждом ответе хода. Для тестов, которые проверяют не
 * блоки, а слова, шаги и инструменты; сами блоки проверяет `run-agent-turn-frozen-context.test.ts`.
 */
export const withoutFrozenContext = <P extends { type: string }>(parts: readonly P[]): P[] =>
  parts.filter((part) => part.type !== FROZEN_CONTEXT_PART_TYPE);
