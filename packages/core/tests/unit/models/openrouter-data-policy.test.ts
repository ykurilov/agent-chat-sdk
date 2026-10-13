import { describe, expect, it } from "vitest";
import { extendCatalog, standardCatalog } from "../../../src";
import { createOpenRouterProvider, openrouterProvider } from "../../../src/models/providers/openrouter";
import type { ProviderDescription } from "../../../src/models/model-catalog";

/** Тела запросов, которые модель провайдера отправила бы в OpenRouter. */
async function requestBodies(provider: ProviderDescription, turns = 1): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  const recordingFetch: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 500 });
  };
  const model = provider.createLanguageModel("z-ai/glm-5.3-flash", "test-key", { fetch: recordingFetch });
  for (let turn = 0; turn < turns; turn++) {
    await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
      .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "привет" }] }] })
      .catch(() => undefined);
  }
  return bodies;
}

describe("OpenRouter: запрет хранить данные", () => {
  it("по умолчанию запрос прежний, побайтно: только сортировка по скорости", async () => {
    const [standard] = await requestBodies(openrouterProvider);
    const [created] = await requestBodies(createOpenRouterProvider());
    expect(standard!.provider).toEqual({ sort: "throughput" });
    expect(JSON.stringify(created)).toBe(JSON.stringify(standard));
  });

  it("dataCollection: deny — к модели ходят только хозяева, которые не хранят запросы; так в каждом ходе", async () => {
    const bodies = await requestBodies(createOpenRouterProvider({ dataCollection: "deny" }), 2);
    expect(bodies[0]!.provider).toEqual({ sort: "throughput", data_collection: "deny" });
    expect(JSON.stringify(bodies[0])).toBe(JSON.stringify(bodies[1]));
  });

  it("zeroDataRetention — только хозяева без хранения вовсе (ZDR)", async () => {
    const [body] = await requestBodies(createOpenRouterProvider({ dataCollection: "deny", zeroDataRetention: true }));
    expect(body!.provider).toEqual({ sort: "throughput", data_collection: "deny", zdr: true });
  });

  it("подключается заменой провайдера в каталоге, остальное как у стандартного", () => {
    const catalog = extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ dataCollection: "deny" })] });
    const provider = catalog.providers.find((candidate) => candidate.id === "openrouter")!;
    expect(provider.apiKeyEnv).toBe(openrouterProvider.apiKeyEnv);
    expect(provider.errorHints).toEqual(openrouterProvider.errorHints);
  });
});
