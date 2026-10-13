import { describe, expect, it } from "vitest";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { createModelCatalog } from "../../../src/models/model-catalog";
import { createOpenRouterProvider } from "../../../src/models/providers/openrouter";
import type { ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";

async function providerRouting(provider: ProviderDescription, openrouterOptions?: Record<string, unknown>): Promise<unknown> {
  let body: Record<string, unknown> | undefined;
  const recordingFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 500 });
  };
  const model = provider.createLanguageModel("deepseek/deepseek-v4.1-flash", "test-key", { fetch: recordingFetch });
  await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
    .doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "привет" }] }],
      ...(openrouterOptions && { providerOptions: { openrouter: openrouterOptions } }),
    })
    .catch(() => undefined);
  return body!.provider;
}

describe("OpenRouter: маршрутизация из настроек подключения", () => {
  it("maxPrice — потолок цены в долларах за миллион токенов (provider.max_price)", async () => {
    const routing = await providerRouting(createOpenRouterProvider({ maxPrice: { completionPerMillion: 1.3 } }));
    expect(routing).toEqual({ sort: "throughput", max_price: { completion: 1.3 } });
  });

  it("maxPrice — все поля: вход, выход, запрос, картинка", async () => {
    const routing = await providerRouting(createOpenRouterProvider({
      maxPrice: { promptPerMillion: 0.5, completionPerMillion: 1.3, requestUsd: 0.01, imageUsd: 0.02 },
    }));
    expect(routing).toEqual({ sort: "throughput", max_price: { prompt: 0.5, completion: 1.3, request: 0.01, image: 0.02 } });
  });

  it("sort — сортировка хозяев модели настраивается и выключается", async () => {
    expect(await providerRouting(createOpenRouterProvider({ sort: "price" }))).toEqual({ sort: "price" });
    expect(await providerRouting(createOpenRouterProvider({ sort: "latency" }))).toEqual({ sort: "latency" });
    expect(await providerRouting(createOpenRouterProvider({ sort: false }))).toBeUndefined();
  });

  it("stickyProvider — по умолчанию номер чата идёт заголовком x-session-id, false — без заголовка", () => {
    const sticky = createOpenRouterProvider().requestOptions!({ chatId: "chat-1" } as never);
    expect(sticky.headers).toEqual({ "x-session-id": "chat-1" });
    const loose = createOpenRouterProvider({ stickyProvider: false }).requestOptions!({ chatId: "chat-1" } as never);
    expect(loose.headers).toBeUndefined();
  });

  it("переподключение (connect) сохраняет настройки маршрутизации", async () => {
    const provider = createOpenRouterProvider({ maxPrice: { completionPerMillion: 1.3 }, sort: "price", ignore: ["venice"], stickyProvider: false });
    const reconnected = provider.connect!({ baseURL: "https://proxy.example/api/v1" });
    expect(await providerRouting(reconnected)).toEqual({ sort: "price", max_price: { completion: 1.3 }, ignore: ["venice"] });
    expect(reconnected.requestOptions!({ chatId: "chat-1" } as never).headers).toBeUndefined();
  });

  it("ignore — хозяева, которым запрос не уходит (provider.ignore)", async () => {
    const routing = await providerRouting(createOpenRouterProvider({ ignore: ["venice"] }));
    expect(routing).toEqual({ sort: "throughput", ignore: ["venice"] });
  });

  it("маршрут из опций запроса (запрет из профиля модели) сливается с настройками подключения, а не затирает их", async () => {
    const provider = createOpenRouterProvider({ maxPrice: { completionPerMillion: 1.3 }, sort: "price", ignore: ["venice"] });
    const routing = await providerRouting(provider, { provider: { ignore: ["wafer", "venice"] }, reasoning: { enabled: true } });
    expect(routing).toEqual({ sort: "price", max_price: { completion: 1.3 }, ignore: ["venice", "wafer"] });
  });

  it("запрет из опций запроса без своих настроек подключения — сортировка по скорости остаётся", async () => {
    expect(await providerRouting(createOpenRouterProvider(), { provider: { ignore: ["wafer"] } })).toEqual({
      sort: "throughput",
      ignore: ["wafer"],
    });
    expect(await providerRouting(createOpenRouterProvider({ sort: false }), { provider: { ignore: ["wafer"] } })).toEqual({
      ignore: ["wafer"],
    });
  });

  it("ошибочный потолок цены — ошибка при создании, а не в первом запросе", () => {
    expect(() => createOpenRouterProvider({ maxPrice: { completionPerMillion: -1 } })).toThrow(/maxPrice/);
  });
});

describe("OpenRouter: маршруты (only, order, allowFallbacks, requireParameters, свой id)", () => {
  it("only, order, allowFallbacks, requireParameters — поля provider.only, order, allow_fallbacks, require_parameters", async () => {
    const routing = await providerRouting(
      createOpenRouterProvider({ only: ["together"], order: ["together", "fireworks"], allowFallbacks: false, requireParameters: true }),
    );
    // Задан order — сортировки по умолчанию нет: она могла бы переставить хозяев.
    expect(routing).toEqual({ only: ["together"], order: ["together", "fireworks"], allow_fallbacks: false, require_parameters: true });
  });

  it("order без своей сортировки — sort не ставится; сортировка, заданная приложением явно, остаётся", async () => {
    expect(await providerRouting(createOpenRouterProvider({ order: ["together"] }))).toEqual({ order: ["together"] });
    expect(await providerRouting(createOpenRouterProvider({ order: ["together"], sort: "price" }))).toEqual({ sort: "price", order: ["together"] });
    // Переподключение не превращает «по умолчанию» в явную сортировку.
    const reconnected = createOpenRouterProvider({ order: ["together"] }).connect!({ baseURL: "https://proxy.example/api/v1" });
    expect(await providerRouting(reconnected)).toEqual({ order: ["together"] });
  });

  it("один хозяин и в only, и в ignore — ошибка при создании", () => {
    expect(() => createOpenRouterProvider({ only: ["together", "venice"], ignore: ["venice"] })).toThrow(/only.*ignore.*venice/);
  });

  it("все хозяева only запрещены профилем модели — понятная ошибка, запрос не уходит", async () => {
    let requests = 0;
    const countingFetch: typeof fetch = async () => {
      requests += 1;
      return new Response("{}", { status: 500 });
    };
    const model = createOpenRouterProvider({ only: ["venice"] }).createLanguageModel("deepseek/deepseek-v4.1-flash", "test-key", { fetch: countingFetch });
    const request = (model as unknown as { doGenerate(options: unknown): Promise<unknown> }).doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "привет" }] }],
      providerOptions: { openrouter: { provider: { ignore: ["venice"] } } },
    });
    await expect(request).rejects.toThrow(/only.*venice.*ignore/);
    expect(requests).toBe(0);
  });

  it("allowFallbacks: true и пустые списки идут как есть или не идут вовсе", async () => {
    expect(await providerRouting(createOpenRouterProvider({ allowFallbacks: true, only: [], order: [] }))).toEqual({ sort: "throughput", allow_fallbacks: true });
  });

  it("запрет хозяев из профиля модели сливается с only маршрута", async () => {
    const routing = await providerRouting(createOpenRouterProvider({ only: ["together"], allowFallbacks: false }), { provider: { ignore: ["venice"] } });
    expect(routing).toEqual({ sort: "throughput", only: ["together"], allow_fallbacks: false, ignore: ["venice"] });
  });

  it("id и displayName — свой провайдер каталога; по умолчанию openrouter / OpenRouter", () => {
    expect(createOpenRouterProvider()).toMatchObject({ id: "openrouter", displayName: "OpenRouter" });
    const route = createOpenRouterProvider({ id: "openrouter-together", displayName: "OpenRouter → Together", only: ["together"] });
    expect(route).toMatchObject({ id: "openrouter-together", displayName: "OpenRouter → Together", apiKeyEnv: "OPENROUTER_API_KEY", servesModelsOf: "openrouter" });
    expect(createOpenRouterProvider({ id: "openrouter-fast" }).displayName).toBe("OpenRouter");
    expect(createOpenRouterProvider().servesModelsOf).toBeUndefined();
  });

  it("неверный id или список хозяев — ошибка при создании", () => {
    expect(() => createOpenRouterProvider({ id: "" })).toThrow(/id/);
    expect(() => createOpenRouterProvider({ only: ["together", 1 as unknown as string] })).toThrow(/only/);
    expect(() => createOpenRouterProvider({ order: "together" as unknown as string[] })).toThrow(/order/);
  });

  it("переподключение через прокси сохраняет id, имя и маршрут", async () => {
    const route = createOpenRouterProvider({ id: "openrouter-together", displayName: "Together", only: ["together"], allowFallbacks: false, requireParameters: true });
    const reconnected = route.connect!({ baseURL: "https://proxy.example/api/v1" });
    expect(reconnected).toMatchObject({ id: "openrouter-together", displayName: "Together", servesModelsOf: "openrouter" });
    expect(await providerRouting(reconnected)).toEqual({ sort: "throughput", only: ["together"], allow_fallbacks: false, require_parameters: true });
  });

  it("маршрут в каталоге обслуживает модели OpenRouter: те же id, цены и отметка картинки в результате инструмента", () => {
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [
        createOpenRouterProvider({ id: "openrouter-together", only: ["together"], allowFallbacks: false }),
        createOpenRouterProvider({ id: "openrouter-fast", ignore: ["together"], sort: "latency" }),
      ],
    });
    const deepseek = catalog.models.find((model) => model.id === "deepseek-4.1-flash")!;
    expect(deepseek.providerModelIds["openrouter-together"]).toBe(deepseek.providerModelIds.openrouter);
    expect(deepseek.providerModelIds["openrouter-fast"]).toBe(deepseek.providerModelIds.openrouter);
    expect(deepseek.pricing?.["openrouter-together"]).toEqual(deepseek.pricing?.openrouter);
    expect(deepseek.toolResultImageProviders).toEqual(expect.arrayContaining(["openrouter", "openrouter-together", "openrouter-fast"]));
    // Модели без OpenRouter маршрут не обслуживает; порядок провайдеров модели прежний — маршруты в конце.
    expect(Object.keys(deepseek.providerModelIds)[0]).toBe(Object.keys(standardCatalog.models.find((model) => model.id === "deepseek-4.1-flash")!.providerModelIds)[0]);
    for (const model of catalog.models) {
      expect(Boolean(model.providerModelIds["openrouter-together"])).toBe(Boolean(model.providerModelIds.openrouter));
    }
  });

  it("закреплённая версия модели у openrouter переходит и на маршрут; своя запись маршрута главнее", () => {
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [createOpenRouterProvider({ id: "openrouter-together" })],
      pinModelVersions: { "deepseek-4.1-flash": { openrouter: "deepseek/deepseek-v4.1-flash-0731" } },
    });
    expect(catalog.models.find((model) => model.id === "deepseek-4.1-flash")!.providerModelIds["openrouter-together"]).toBe("deepseek/deepseek-v4.1-flash-0731");
    const own = extendCatalog(catalog, { pinModelVersions: { "deepseek-4.1-flash": { "openrouter-together": "deepseek/own" } } });
    expect(own.models.find((model) => model.id === "deepseek-4.1-flash")!.providerModelIds["openrouter-together"]).toBe("deepseek/own");
  });

  it("маршрут без провайдера openrouter в каталоге — ошибка каталога", () => {
    expect(() =>
      createModelCatalog({ models: [], providers: [createOpenRouterProvider({ id: "openrouter-together" })] }),
    ).toThrow(/openrouter-together.*openrouter/);
  });
});
