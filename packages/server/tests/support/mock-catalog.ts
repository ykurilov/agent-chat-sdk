import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ModelCatalog } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";

export const mockModelId = "mock-model";
export const mockEnv = { MOCK_API_KEY: "не-настоящий-ключ" };

export const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/** Модель-заглушка: «Привет!» после того, как тест отпустит `gate` (по умолчанию сразу). */
export function mockCatalog(gate: () => Promise<void> = async () => {}): ModelCatalog {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "txt-0" });
          controller.enqueue({ type: "text-delta", id: "txt-0", delta: "При" });
          await gate();
          controller.enqueue({ type: "text-delta", id: "txt-0", delta: "вет!" });
          controller.enqueue({ type: "text-end", id: "txt-0" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        },
      }),
    }),
  });
  return catalogWithModel(model);
}

/** Каталог с провайдером `mock`, который отвечает этой моделью. */
export function catalogWithModel(model: MockLanguageModelV4): ModelCatalog {
  return extendCatalog(standardCatalog, {
    addProviders: [
      {
        id: "mock",
        displayName: "Mock",
        apiKeyEnv: "MOCK_API_KEY",
        createLanguageModel: () => model,
        requestOptions: () => ({}),
      },
    ],
    addModels: [
      {
        id: mockModelId,
        displayName: "Mock Model",
        contextWindowTokens: 1000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { mock: "mock-v1" },
      },
    ],
  });
}

/** Ворота, которые держат ответ модели посередине. */
export function createGate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait: () => opened, open };
}
