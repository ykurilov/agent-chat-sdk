import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";

/** Шаг модели: текст ответа или вызов инструмента (после него ход продолжится следующим шагом). */
export type ModelStep = { text: string } | { tool: { name: string; input: unknown; id?: string } };

/** Ход стоит 0,015 $: 10 токенов входа и 5 выхода по 1000 $ за миллион. */
export const TURN_COST_USD = 0.015;
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/**
 * Модель по сценарию: шаги отдаются по очереди, без сценария — «Ответ N». Все запросы к модели сохраняются:
 * по ним проверяется, что ушло агенту (память, инструменты, сообщение человека).
 */
export function createScriptedModel() {
  const steps: ModelStep[] = [];
  /** Свои шаги для запросов, где есть метка (например, инструкция помощника): помощник и основной агент идут вперемешку. */
  const marked = new Map<string, ModelStep[]>();
  const calls: LanguageModelV4CallOptions[] = [];
  let answered = 0;

  function partsOf(step: ModelStep): LanguageModelV4StreamPart[] {
    if ("text" in step) {
      return [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: step.text },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ];
    }
    const id = step.tool.id ?? `call-${answered}`;
    return [
      { type: "tool-call", toolCallId: id, toolName: step.tool.name, input: JSON.stringify(step.tool.input) },
      { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
    ];
  }

  /** Следующий шаг для запроса: из своей очереди метки или из общей. */
  function nextStep(options: LanguageModelV4CallOptions): ModelStep {
    calls.push(options);
    answered++;
    const prompt = JSON.stringify(options.prompt);
    const own = [...marked.entries()].find(([marker]) => prompt.includes(marker))?.[1];
    return (own ?? steps).shift() ?? { text: `Ответ ${answered}` };
  }

  const model = new MockLanguageModelV4({
    // Помощники зовут модель без потока.
    doGenerate: async (options) => {
      const step = nextStep(options);
      if ("text" in step) return { content: [{ type: "text", text: step.text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
      const toolCallId = step.tool.id ?? `call-${answered}`;
      return {
        content: [{ type: "tool-call", toolCallId, toolName: step.tool.name, input: JSON.stringify(step.tool.input) }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      const step = nextStep(options);
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const part of partsOf(step)) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });

  const catalog = extendCatalog(standardCatalog, {
    addProviders: [{ id: "mock", displayName: "Mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
    addModels: [
      {
        id: "mock-model",
        displayName: "Mock",
        contextWindowTokens: 100_000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { mock: "mock-v1" },
        pricing: { mock: { inputPerMillion: 1000, outputPerMillion: 1000 } },
      },
    ],
  });

  return {
    catalog,
    calls,
    /** Следующие ответы модели по порядку. */
    script(...next: ModelStep[]) {
      steps.push(...next);
    },
    /** Ответы модели на запросы, в которых есть `marker`. */
    scriptWhen(marker: string, ...next: ModelStep[]) {
      marked.set(marker, [...(marked.get(marker) ?? []), ...next]);
    },
    /** Весь текст последнего запроса к модели (инструкция и сообщения). */
    lastPromptText(): string {
      return JSON.stringify(calls.at(-1)?.prompt ?? []);
    },
    /** Имена инструментов последнего запроса. */
    lastToolNames(): string[] {
      return (calls.at(-1)?.tools ?? []).map((tool) => tool.name);
    },
  };
}

export type ScriptedModel = ReturnType<typeof createScriptedModel>;
