import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ModelCatalog } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";

export const exampleModelId = "example-model";
export const exampleProviderId = "example";
const chunkPauseMs = 250;
const chunks = ["Привет! ", "Это ", "ответ ", "по ", "частям. ", "Каждый ", "кусок ", "приходит ", "с ", "паузой, ", "чтобы ", "поток ", "было ", "видно."];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 14, text: 14, reasoning: 0 },
};

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Модель-заглушка: пишет фразу по кусочку каждые 250 мс. Настоящей модели и ключей пример не требует. */
function createExampleModel() {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "txt-0" });
          for (const delta of chunks) {
            if (abortSignal?.aborted) break;
            controller.enqueue({ type: "text-delta", id: "txt-0", delta });
            await pause(chunkPauseMs, abortSignal);
          }
          controller.enqueue({ type: "text-end", id: "txt-0" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        },
      }),
    }),
  });
}

/** Каталог стандартных моделей плюс модель примера. */
export function exampleCatalog(): ModelCatalog {
  return extendCatalog(standardCatalog, {
    addProviders: [
      {
        id: exampleProviderId,
        displayName: "Example",
        apiKeyEnv: "EXAMPLE_API_KEY",
        createLanguageModel: () => createExampleModel(),
        requestOptions: () => ({}),
      },
    ],
    addModels: [
      {
        id: exampleModelId,
        displayName: "Example Model",
        contextWindowTokens: 1000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { [exampleProviderId]: "example-v1" },
      },
    ],
  });
}
