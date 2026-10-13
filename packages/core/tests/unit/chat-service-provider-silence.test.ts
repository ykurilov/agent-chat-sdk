import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import { extendCatalog } from "../../src/models/catalog-changes";
import type { ModelCatalog } from "../../src/models/model-catalog";
import { createDeepSeekProvider } from "../../src/models/providers/deepseek";
import { createFireworksProvider } from "../../src/models/providers/fireworks";
import { createOpenRouterProvider } from "../../src/models/providers/openrouter";
import { createTogetherProvider } from "../../src/models/providers/together";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const user = (id: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text: "Привет" }] });

/** Модель по сценарию: `silent` — поток открыт, но молчит до отмены. */
function scriptedModel(scripts: Array<"silent" | string>) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const script = scripts[call++] ?? "silent";
      if (script !== "silent") return { stream: streamOf([streamStart, ...textParts([script]), finishPart()]) };
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue(streamStart);
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          },
        }),
      };
    },
  });
}

/** Каталог заглушек, где у провайдеров свои сроки молчания (как от фабрики провайдера). */
function withProviderSilence(catalog: ModelCatalog, silence: Record<string, { firstChunkMs?: number; betweenChunksMs?: number }>): ModelCatalog {
  return { ...catalog, providers: catalog.providers.map((provider) => (silence[provider.id] ? { ...provider, modelSilenceTimeout: silence[provider.id] } : provider)) };
}

const finalStatus = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === "message-metadata" ? [(chunk.messageMetadata as { status?: string }).status] : [])).filter(Boolean).at(-1);

afterEach(() => {
  vi.useRealTimers();
});

describe("срок молчания модели у поставщика", () => {
  it("фабрики провайдеров принимают общее поле modelSilenceTimeout и проверяют его", () => {
    const silence = { firstChunkMs: 3_000 };
    for (const create of [createTogetherProvider, createFireworksProvider, createDeepSeekProvider, createOpenRouterProvider]) {
      expect(create({ modelSilenceTimeout: silence }).modelSilenceTimeout).toEqual(silence);
      expect(create().modelSilenceTimeout).toBeUndefined();
      expect(() => create({ modelSilenceTimeout: { firstChunkMs: 500 } })).toThrow(/modelSilenceTimeout\.firstChunkMs/);
    }
    expect(createTogetherProvider({ modelSilenceTimeout: false }).modelSilenceTimeout).toBe(false);
  });

  it("провайдер, собранный вручную: extendCatalog проверяет срок той же проверкой, что фабрики", () => {
    const handBuilt = { ...createTogetherProvider(), id: "my-together" };
    expect(() => extendCatalog(standardCatalog, { addProviders: [{ ...handBuilt, modelSilenceTimeout: { firstChunkMs: 500 } }] })).toThrow(
      /my-together: modelSilenceTimeout\.firstChunkMs/,
    );
    expect(() => extendCatalog(standardCatalog, { addProviders: [{ ...handBuilt, modelSilenceTimeout: "долго" as never }] })).toThrow(/my-together: modelSilenceTimeout/);
    const ok = extendCatalog(standardCatalog, { addProviders: [{ ...handBuilt, modelSilenceTimeout: { firstChunkMs: 3_000 } }] });
    expect(ok.providers.find((provider) => provider.id === "my-together")?.modelSilenceTimeout).toEqual({ firstChunkMs: 3_000 });
  });

  it("подключение через прокси (connectProviders) сохраняет срок поставщика", () => {
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [createTogetherProvider({ modelSilenceTimeout: { firstChunkMs: 3_000 } })],
      connectProviders: { together: { baseURL: "https://proxy.example.com/together/v1" } },
    });
    const together = catalog.providers.find((provider) => provider.id === "together")!;
    expect(together.modelSilenceTimeout).toEqual({ firstChunkMs: 3_000 });
    expect(together.connection?.baseURL).toBe("https://proxy.example.com/together/v1");
  });

  it("свой срок перекрывает общий: быстрый поставщик сдаётся за 3 с, запасной ждёт 30 с (providerFallback)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fast = scriptedModel(["silent", "silent"]);
    const backup = scriptedModel(["silent", "Ответил запасной."]);
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: withProviderSilence(mockCatalog({ mock: fast, "mock-backup": backup }), { mock: { firstChunkMs: 3_000 }, "mock-backup": { firstChunkMs: 30_000 } }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      // Общий срок длиннее: без срока поставщика быстрый ждал бы 90 с.
      agent: { instructions: "Ты помощник.", modelSilenceTimeout: { firstChunkMs: 90_000 } },
      compaction: false,
      env: mockEnv,
      logError: () => {},
    });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1")));

    // Две попытки быстрого по 3 с и пауза повтора (1 с, разброс до 25%) — ход ушёл к запасному.
    await vi.advanceTimersByTimeAsync(2 * 3_000 + 1_250 + 500);
    expect(fast.doStreamCalls).toHaveLength(2);
    expect(backup.doStreamCalls).toHaveLength(1);
    // Запасной молчит 25 с — это ещё в его сроке.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(backup.doStreamCalls).toHaveLength(1);
    // Его 30 с вышли: тихий повтор у него же отвечает.
    await vi.advanceTimersByTimeAsync(5_000 + 1_250);
    expect(backup.doStreamCalls).toHaveLength(2);
    expect(finalStatus(await reading)).toBe("complete");
  });
});
