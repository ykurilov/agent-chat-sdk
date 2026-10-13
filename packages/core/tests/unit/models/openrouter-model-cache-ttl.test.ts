import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelCatalog, ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { createOpenRouterProvider, openrouterProvider } from "../../../src/models/providers/openrouter";
import { standardCatalog } from "../../../src/models/standard-catalog";

const message = (role: "user" | "assistant", id: string, text: string) => ({ id, role, parts: [{ type: "text" as const, text }] });
const HOUR = { type: "ephemeral", ttl: "1h" };
const FIVE_MINUTES = { type: "ephemeral" };

/** Тело запроса в OpenRouter из настоящей сборки запроса к модели каталога. */
async function requestBody(catalog: ModelCatalog, modelId: string, providerId = "openrouter"): Promise<unknown> {
  let body: unknown;
  const recordingFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 500 });
  };
  const request = await buildModelRequest({
    catalog,
    modelId,
    providerId,
    chatId: "c1",
    instructions: "Ты помощник.",
    history: [message("user", "u1", "Привет"), message("assistant", "a1", "Здравствуйте"), message("user", "u2", "Как дела?")],
    env: { OPENROUTER_API_KEY: "k" },
  });
  const provider = catalog.providers.find((candidate) => candidate.id === providerId)!;
  const profile = catalog.models.find((candidate) => candidate.id === modelId)!;
  const model = provider.createLanguageModel(profile.providerModelIds[providerId]!, "k", { fetch: recordingFetch });
  const instructions = request.instructions as { content: string; providerOptions?: never };
  await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
    .doGenerate({ prompt: [{ role: "system", content: instructions.content, providerOptions: instructions.providerOptions }, ...request.messages] })
    .catch(() => undefined);
  return body;
}

function cacheControls(body: unknown): unknown[] {
  const found: unknown[] = [];
  JSON.stringify(body, (key, value) => {
    if (key === "cache_control") found.push(value);
    return value;
  });
  return found;
}

const withProvider = (provider: ProviderDescription) => extendCatalog(standardCatalog, { addProviders: [provider] });
const profileOf = (catalog: ModelCatalog, id: string) => catalog.models.find((model) => model.id === id)!;
const otherOpenRouterModels = standardCatalog.models.filter((model) => model.providerModelIds.openrouter && model.id !== "claude-haiku-5.5");

describe("OpenRouter: срок кэша по модели", () => {
  it("Haiku 5.5 в standardCatalog — часовые метки: на инструкции и на последнем сообщении", async () => {
    expect(cacheControls(await requestBody(standardCatalog, "claude-haiku-5.5"))).toEqual([HOUR, HOUR]);
  });

  it.each(otherOpenRouterModels.map((model) => model.id))("%s — метки без срока, опции запроса те же, что без профиля (побайтно)", async (modelId) => {
    const profile = profileOf(standardCatalog, modelId);
    expect(JSON.stringify(openrouterProvider.requestOptions({ chatId: "c1", profile }))).toBe(JSON.stringify(openrouterProvider.requestOptions({ chatId: "c1" })));
    expect(cacheControls(await requestBody(standardCatalog, modelId))).toEqual([FIVE_MINUTES, FIVE_MINUTES]);
  });

  it("срок провайдера `cacheTtl` главнее срока из профиля: явные 5 минут — Haiku тоже без срока", async () => {
    const catalog = withProvider(createOpenRouterProvider({ cacheTtl: "5m" }));
    expect(cacheControls(await requestBody(catalog, "claude-haiku-5.5"))).toEqual([FIVE_MINUTES, FIVE_MINUTES]);
  });

  it("`cacheTtlByModel` главнее всего: у Haiku 5 минут при часе у остальных, у Gemini час без срока провайдера", async () => {
    const catalog = withProvider(createOpenRouterProvider({ cacheTtl: "1h", cacheTtlByModel: { "claude-haiku-5.5": "5m" } }));
    expect(cacheControls(await requestBody(catalog, "claude-haiku-5.5"))).toEqual([FIVE_MINUTES, FIVE_MINUTES]);
    expect(cacheControls(await requestBody(catalog, "gpt-6-luna"))).toEqual([HOUR, HOUR]);
    const geminiHour = withProvider(createOpenRouterProvider({ cacheTtlByModel: { "gemini-3.8-flash": "1h" } }));
    expect(cacheControls(await requestBody(geminiHour, "gemini-3.8-flash"))).toEqual([HOUR, HOUR]);
    expect(cacheControls(await requestBody(geminiHour, "claude-haiku-5.5"))).toEqual([HOUR, HOUR]);
  });

  it("свой профиль с `cacheTtl: \"1h\"` — часовые метки у стандартного OpenRouter", async () => {
    const own: ModelProfile = { ...profileOf(standardCatalog, "gemini-3.8-flash"), id: "own-gemini", cacheTtl: "1h" };
    const catalog = extendCatalog(standardCatalog, { addModels: [own] });
    expect(cacheControls(await requestBody(catalog, "own-gemini"))).toEqual([HOUR, HOUR]);
  });

  it("маршрут OpenRouter (servesModelsOf) берёт срок из профиля так же", async () => {
    const catalog = withProvider(createOpenRouterProvider({ id: "openrouter-google", only: ["google-vertex"] }));
    expect(cacheControls(await requestBody(catalog, "claude-haiku-5.5", "openrouter-google"))).toEqual([HOUR, HOUR]);
  });

  it("переподключение через прокси сохраняет `cacheTtlByModel`", async () => {
    const catalog = extendCatalog(withProvider(createOpenRouterProvider({ cacheTtlByModel: { "gpt-6-luna": "1h" } })), {
      connectProviders: { openrouter: { baseURL: "https://proxy.example/api/v1" } },
    });
    expect(cacheControls(await requestBody(catalog, "gpt-6-luna"))).toEqual([HOUR, HOUR]);
  });

  it("id модели совпал с именем из прототипа объекта (`toString`) — срок не берётся оттуда", () => {
    const provider = createOpenRouterProvider({ cacheTtlByModel: { "gpt-6-luna": "1h" } });
    const profile = { ...profileOf(standardCatalog, "gemini-3.8-flash"), id: "toString" };
    expect(provider.cacheTtlFor!(profile)).toBe("5m");
    expect(provider.requestOptions({ chatId: "c1", profile }).lastMessageProviderOptions).toEqual({ openrouter: { cacheControl: FIVE_MINUTES } });
  });

  it.each([{ x: "2h" }, { x: 60 }, ["1h"], "1h"])("неверный `cacheTtlByModel` %j — понятная ошибка настройки", (cacheTtlByModel) => {
    expect(() => createOpenRouterProvider({ cacheTtlByModel: cacheTtlByModel as never })).toThrow(/OpenRouter: cacheTtlByModel/);
  });

  it("неверный срок в профиле — ошибка при сборке каталога", () => {
    const bad = { ...profileOf(standardCatalog, "gemini-3.8-flash"), id: "bad", cacheTtl: "2h" } as unknown as ModelProfile;
    expect(() => extendCatalog(standardCatalog, { addModels: [bad] })).toThrow(/«bad».*cacheTtl/);
  });
});

describe("каталог: срок записи кэша в цене модели", () => {
  const haikuPrice = (catalog: ModelCatalog, providerId = "openrouter") => profileOf(catalog, "claude-haiku-5.5").pricing![providerId]!;

  it("Haiku у OpenRouter — цена с отметкой часовой записи; у других моделей цена прежняя", () => {
    expect(haikuPrice(standardCatalog).cacheWriteTtl).toBe("1h");
    for (const model of otherOpenRouterModels) expect(model.pricing?.openrouter?.cacheWriteTtl).toBeUndefined();
  });

  it("явные 5 минут у провайдера — отметки нет; маршрут с часом — отметка только у маршрута", () => {
    const fiveMinutes = withProvider(createOpenRouterProvider({ cacheTtl: "5m" }));
    expect(haikuPrice(fiveMinutes).cacheWriteTtl).toBeUndefined();
    const route = extendCatalog(fiveMinutes, { addProviders: [createOpenRouterProvider({ id: "openrouter-hour", cacheTtl: "1h" })] });
    expect(haikuPrice(route).cacheWriteTtl).toBeUndefined();
    expect(haikuPrice(route, "openrouter-hour").cacheWriteTtl).toBe("1h");
    const luna = profileOf(route, "gpt-6-luna").pricing!;
    expect(luna["openrouter-hour"]!.cacheWriteTtl).toBe("1h");
    expect(luna.openrouter!.cacheWriteTtl).toBeUndefined();
  });

  it("повторная сборка каталога не копит отметку: вернули 5 минут — отметка ушла", () => {
    const hour = withProvider(createOpenRouterProvider({ cacheTtl: "1h" }));
    expect(profileOf(hour, "gpt-6-luna").pricing!.openrouter!.cacheWriteTtl).toBe("1h");
    const back = extendCatalog(hour, { addProviders: [createOpenRouterProvider()] });
    expect(profileOf(back, "gpt-6-luna").pricing!.openrouter!.cacheWriteTtl).toBeUndefined();
    expect(haikuPrice(back).cacheWriteTtl).toBe("1h");
  });
});
