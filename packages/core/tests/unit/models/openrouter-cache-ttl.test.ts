import { describe, expect, it } from "vitest";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { createOpenRouterProvider, openrouterProvider } from "../../../src/models/providers/openrouter";
import type { ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";

const message = (role: "user" | "assistant", id: string, text: string) => ({ id, role, parts: [{ type: "text" as const, text }] });

/** Тело запроса, который уйдёт в OpenRouter из настоящей сборки запроса к модели каталога. */
async function requestBody(catalogProvider: ProviderDescription, tail: { memory?: string } = {}): Promise<{ messages: Array<{ role: string; content: unknown; cache_control?: unknown }> }> {
  let body: { messages: Array<{ role: string; content: unknown; cache_control?: unknown }> } | undefined;
  const recordingFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 500 });
  };
  const catalog = extendCatalog(standardCatalog, { addProviders: [catalogProvider] });
  const request = await buildModelRequest({
    catalog,
    modelId: "gemini-3.8-flash",
    providerId: "openrouter",
    chatId: "c1",
    instructions: "Ты помощник.",
    history: [message("user", "u1", "Привет"), message("assistant", "a1", "Здравствуйте"), message("user", "u2", "Как дела?")],
    ...(tail.memory && {
      frozenContext: { current: { answerId: "a2", data: { blocks: [{ key: "memory", text: tail.memory, private: true }], sent: "all" as const, base: null } }, group: false },
    }),
    env: { OPENROUTER_API_KEY: "k" },
  });
  const model = catalogProvider.createLanguageModel("google/gemini-3.8-flash", "k", { fetch: recordingFetch });
  await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
    .doGenerate({
      prompt: [
        { role: "system", content: request.instructions && typeof request.instructions === "object" ? request.instructions.content : String(request.instructions), providerOptions: typeof request.instructions === "object" ? request.instructions.providerOptions : undefined },
        ...request.messages,
      ],
    })
    .catch(() => undefined);
  return body!;
}

/** Все значения `cache_control` в теле запроса, по порядку. */
function cacheControls(body: unknown): unknown[] {
  const found: unknown[] = [];
  JSON.stringify(body, (key, value) => {
    if (key === "cache_control") found.push(value);
    return value;
  });
  return found;
}

describe("OpenRouter: срок кэша меток (cacheTtl)", () => {
  it("по умолчанию метки без срока — запрос прежний, побайтно", async () => {
    const standard = await requestBody(openrouterProvider);
    const created = await requestBody(createOpenRouterProvider());
    const explicit5m = await requestBody(createOpenRouterProvider({ cacheTtl: "5m" }));
    expect(cacheControls(standard)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }]);
    expect(JSON.stringify(created)).toBe(JSON.stringify(standard));
    expect(JSON.stringify(explicit5m)).toBe(JSON.stringify(standard));
  });

  it('"1h" — срок в теле запроса у каждой метки: на инструкции и на последнем сообщении', async () => {
    const body = await requestBody(createOpenRouterProvider({ cacheTtl: "1h" }));
    expect(cacheControls(body)).toEqual([{ type: "ephemeral", ttl: "1h" }, { type: "ephemeral", ttl: "1h" }]);
  });

  it('"1h" — с застывшими блоками все метки с тем же сроком', async () => {
    const body = await requestBody(createOpenRouterProvider({ cacheTtl: "1h" }), { memory: "ПАМЯТЬ-1" });
    const marks = cacheControls(body);
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(marks.every((mark) => JSON.stringify(mark) === JSON.stringify({ type: "ephemeral", ttl: "1h" }))).toBe(true);
  });

  it.each(["2h", "1H", 60, null, ""])("неверный срок %j — понятная ошибка настройки", (cacheTtl) => {
    expect(() => createOpenRouterProvider({ cacheTtl: cacheTtl as never })).toThrow(/OpenRouter: cacheTtl.*"5m".*"1h"/);
  });

  it("переподключение (connect) и connectProviders сохраняют срок кэша", async () => {
    const reconnected = createOpenRouterProvider({ cacheTtl: "1h" }).connect!({ baseURL: "https://proxy.example/api/v1" });
    expect(cacheControls(await requestBody(reconnected))).toEqual([{ type: "ephemeral", ttl: "1h" }, { type: "ephemeral", ttl: "1h" }]);

    const catalog = extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ cacheTtl: "1h" })] });
    const proxied = extendCatalog(catalog, { connectProviders: { openrouter: { baseURL: "https://proxy.example/api/v1" } } });
    const provider = proxied.providers.find((candidate) => candidate.id === "openrouter")!;
    expect(provider.connection).toEqual({ baseURL: "https://proxy.example/api/v1" });
    expect(cacheControls(await requestBody(provider))).toEqual([{ type: "ephemeral", ttl: "1h" }, { type: "ephemeral", ttl: "1h" }]);
  });
});
