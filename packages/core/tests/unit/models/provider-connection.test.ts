import { describe, expect, it } from "vitest";
import {
  createDeepSeekProvider,
  createFireworksProvider,
  createOpenRouterProvider,
  createTogetherProvider,
  environmentSecrets,
  extendCatalog,
  scrubSecrets,
  standardCatalog,
} from "../../../src";
import type { ProviderDescription } from "../../../src";
import { findModel, resolveLanguageModel } from "../../../src/models/model-catalog";

const proxyToken = "proxy-token-for-tests-0123456789";
const proxyHeaders = { "X-Proxy-Token": proxyToken };

interface SentRequest {
  url: string;
  headers: Headers;
}

function recordingFetch() {
  const requests: SentRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response("{}", { status: 500 });
  };
  return { fetch, requests };
}

/** Один запрос модели провайдера: куда ушёл и с какими заголовками. */
async function firstRequest(provider: ProviderDescription, providerModelId = "some/model"): Promise<SentRequest> {
  const { fetch, requests } = recordingFetch();
  const model = provider.createLanguageModel(providerModelId, "provider-key", { fetch });
  await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
    .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "привет" }] }] })
    .catch(() => undefined);
  return requests[0]!;
}

const builtIn = [
  { id: "openrouter", create: createOpenRouterProvider, standardUrl: "https://openrouter.ai/api/v1/chat/completions" },
  { id: "deepseek", create: createDeepSeekProvider, standardUrl: "https://api.deepseek.com/chat/completions" },
  { id: "fireworks", create: createFireworksProvider, standardUrl: "https://api.fireworks.ai/inference/v1/chat/completions" },
  { id: "together", create: createTogetherProvider, standardUrl: "https://api.together.xyz/v1/chat/completions" },
] as const;

const standardProvider = (id: string) => standardCatalog.providers.find((provider) => provider.id === id)!;

describe("встроенные провайдеры через прокси: свой адрес и заголовки", () => {
  for (const { id, create, standardUrl } of builtIn) {
    it(`${id}: без настроек запрос идёт прямо к провайдеру, как раньше`, async () => {
      const request = await firstRequest(standardProvider(id));
      expect(request.url).toBe(standardUrl);
      expect(request.headers.get("x-proxy-token")).toBeNull();
      expect((await firstRequest(create())).url).toBe(standardUrl);
    });

    it(`${id}: с baseURL и headers — на адрес прокси, с заголовком и ключом`, async () => {
      const baseURL = `https://proxy.example.com/${id}/v1`;
      const request = await firstRequest(create({ baseURL, headers: proxyHeaders }));
      expect(request.url).toBe(`${baseURL}/chat/completions`);
      expect(request.headers.get("x-proxy-token")).toBe(proxyToken);
      expect(request.headers.get("authorization")).toBe("Bearer provider-key");
    });
  }

  it("OpenRouter: заголовки прокси не мешают своим заголовкам запроса (x-session-id)", async () => {
    const provider = createOpenRouterProvider({ baseURL: "https://proxy.example.com/openrouter/api/v1", headers: proxyHeaders });
    expect(provider.requestOptions({ chatId: "chat-1" }).headers).toEqual({ "x-session-id": "chat-1" });
  });

  it("OpenRouter: сверка цены генерации тоже идёт через прокси, с заголовком", async () => {
    const provider = createOpenRouterProvider({ baseURL: "https://proxy.example.com/openrouter/api/v1/", headers: proxyHeaders });
    const requests: SentRequest[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response("", { status: 404 });
    };
    await provider.generationUsage!.lookup({ generationId: "gen 1", apiKey: "provider-key", fetch });
    expect(requests[0]!.url).toBe("https://proxy.example.com/openrouter/api/v1/generation?id=gen%201");
    expect(requests[0]!.headers.get("x-proxy-token")).toBe(proxyToken);
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer provider-key");
  });

  it("OpenRouter: правила хранения данных и прокси вместе", async () => {
    const provider = createOpenRouterProvider({ dataCollection: "deny", baseURL: "https://proxy.example.com/or/v1", headers: proxyHeaders });
    const bodies: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 500 });
    };
    const model = provider.createLanguageModel("z-ai/glm-5.3-flash", "k", { fetch });
    await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
      .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "привет" }] }] })
      .catch(() => undefined);
    expect(bodies[0]!.provider).toEqual({ sort: "throughput", data_collection: "deny" });
  });

  it("неверный адрес или заголовок — ошибка при сборке, без значения заголовка в тексте", () => {
    expect(() => createOpenRouterProvider({ baseURL: "proxy.example.com/openrouter" })).toThrow(/baseURL/);
    expect(() => createDeepSeekProvider({ baseURL: "ftp://proxy.example.com" })).toThrow(/baseURL/);
    expect(() => createTogetherProvider({ headers: { "X-Proxy-Token": undefined as unknown as string } })).toThrow(/X-Proxy-Token/);
    let message = "";
    try {
      createFireworksProvider({ headers: { "bad header": proxyToken } });
    } catch (failure) {
      message = (failure as Error).message;
    }
    expect(message).toMatch(/заголов/);
    expect(message).not.toContain(proxyToken);
  });

  it("короткое значение заголовка — ошибка при сборке: короткий токен не вычистился бы из журналов", () => {
    let message = "";
    try {
      createOpenRouterProvider({ headers: { "X-Proxy-Token": "abc123" } });
    } catch (failure) {
      message = (failure as Error).message;
    }
    expect(message).toMatch(/X-Proxy-Token.*8/);
    expect(message).not.toContain("abc123");
    expect(() => createDeepSeekProvider({ headers: { "X-Proxy-Token": "12345678" } })).not.toThrow();
  });

  it("Authorization в заголовках подключения (в любом регистре) — ошибка: ключ провайдера задаётся отдельно", () => {
    for (const name of ["Authorization", "authorization", "AUTHORIZATION"]) {
      for (const create of [createOpenRouterProvider, createDeepSeekProvider, createFireworksProvider, createTogetherProvider]) {
        expect(() => create({ headers: { [name]: "Bearer proxy-secret-0123" } })).toThrow(/Authorization/);
      }
    }
    expect(() => extendCatalog(standardCatalog, { connectProviders: { openrouter: { headers: { authorization: "Bearer proxy-secret-0123" } } } })).toThrow(/Authorization/);
  });
});

describe("каталог: connectProviders подключает встроенных провайдеров через прокси", () => {
  const connections = {
    openrouter: { baseURL: "https://proxy.example.com/openrouter/api/v1", headers: proxyHeaders },
    deepseek: { baseURL: "https://proxy.example.com/deepseek", headers: proxyHeaders },
  };

  it("провайдер остаётся на своём месте, модели и цены прежние", () => {
    const catalog = extendCatalog(standardCatalog, { connectProviders: connections });
    expect(catalog.providers.map((provider) => provider.id)).toEqual(standardCatalog.providers.map((provider) => provider.id));
    expect(catalog.models).toEqual(standardCatalog.models);
    const openrouter = catalog.providers.find((provider) => provider.id === "openrouter")!;
    expect(openrouter.apiKeyEnv).toBe("OPENROUTER_API_KEY");
    expect(openrouter.errorHints).toEqual(standardProvider("openrouter").errorHints);
    expect(openrouter.connection).toEqual(connections.openrouter);
  });

  it("любой ход по каталогу (чат, память, сжатие) идёт через прокси", async () => {
    const catalog = extendCatalog(standardCatalog, { connectProviders: connections });
    const modelId = standardCatalog.models.find((model) => model.providerModelIds.openrouter)!.id;
    const { fetch, requests } = recordingFetch();
    const model = resolveLanguageModel(findModel(catalog, modelId, "openrouter"), { OPENROUTER_API_KEY: "provider-key" }, fetch);
    await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
      .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "привет" }] }] })
      .catch(() => undefined);
    expect(requests[0]!.url).toBe("https://proxy.example.com/openrouter/api/v1/chat/completions");
    expect(requests[0]!.headers.get("x-proxy-token")).toBe(proxyToken);
  });

  it("сохраняет прежние настройки провайдера: правила хранения OpenRouter", () => {
    const base = extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ dataCollection: "deny" })] });
    const catalog = extendCatalog(base, { connectProviders: { openrouter: connections.openrouter } });
    expect(catalog.providers.find((provider) => provider.id === "openrouter")!.connection).toEqual(connections.openrouter);
  });

  it("неизвестный провайдер или провайдер без поддержки подключения — ошибка настройки", () => {
    expect(() => extendCatalog(standardCatalog, { connectProviders: { nope: { baseURL: "https://proxy.example.com" } } })).toThrow(/nope/);
    const custom: ProviderDescription = { ...standardProvider("deepseek"), id: "mine", connect: undefined };
    const withCustom = extendCatalog(standardCatalog, { addProviders: [custom] });
    expect(() => extendCatalog(withCustom, { connectProviders: { mine: { baseURL: "https://proxy.example.com" } } })).toThrow(/mine/);
  });

  it("копия встроенного провайдера со своей моделью не подключается молча стандартной: ошибка", () => {
    const own: ProviderDescription = { ...standardProvider("openrouter"), createLanguageModel: () => { throw new Error("своя модель"); } };
    const withOwn = extendCatalog(standardCatalog, { addProviders: [own] });
    expect(() => extendCatalog(withOwn, { connectProviders: { openrouter: connections.openrouter } })).toThrow(/openrouter.*не умеет/);
  });

  it("значения заголовков подключения — секреты: вычищаются из ошибок и журналов", () => {
    const catalog = extendCatalog(standardCatalog, { connectProviders: connections });
    const secrets = environmentSecrets({}, catalog);
    expect(secrets).toContain(proxyToken);
    expect(scrubSecrets(`proxy said: bad ${proxyToken}`, secrets)).toBe("proxy said: bad [скрыто]");
  });
});
