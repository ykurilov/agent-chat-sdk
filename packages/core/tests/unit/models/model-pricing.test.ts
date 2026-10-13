import { describe, expect, it } from "vitest";
import { createModelCatalog } from "../../../src/models/model-catalog";
import type { ModelPrice, ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";

const provider = (id = "acme"): ProviderDescription => ({
  id,
  displayName: id,
  apiKeyEnv: `${id.toUpperCase()}_API_KEY`,
  createLanguageModel: () => {
    throw new Error("не вызывается");
  },
  requestOptions: () => ({}),
});

const price: ModelPrice = { inputPerMillion: 0.3, outputPerMillion: 1.2, cachedInputPerMillion: 0.006 };

const profile = (pricing?: ModelProfile["pricing"]): ModelProfile => ({
  id: "acme-model",
  displayName: "Acme Model",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true },
  providerModelIds: { acme: "acme-v1" },
  ...(pricing ? { pricing } : {}),
});

describe("createModelCatalog: цены", () => {
  it("принимает профиль с ценой у своего провайдера и без цен вовсе", () => {
    expect(() => createModelCatalog({ models: [profile({ acme: price })], providers: [provider()] })).not.toThrow();
    expect(() => createModelCatalog({ models: [profile()], providers: [provider()] })).not.toThrow();
  });

  it("отказывает в цене у провайдера, который модель не обслуживает", () => {
    expect(() => createModelCatalog({ models: [profile({ ghost: price })], providers: [provider()] })).toThrow(/acme-model.*ghost/);
  });

  it.each([
    ["отрицательная цена входа", { ...price, inputPerMillion: -1 }],
    ["цена выхода не число", { ...price, outputPerMillion: Number.NaN }],
    ["бесконечная цена кэша", { ...price, cachedInputPerMillion: Number.POSITIVE_INFINITY }],
    ["отрицательная цена записи кэша", { ...price, cacheWritePerMillion: -0.1 }],
    ["отрицательная цена часовой записи кэша", { ...price, cacheWrite1hPerMillion: -0.1 }],
    ["часовая цена ступени не число", { ...price, tiers: [{ inputTokensAbove: 1000, inputPerMillion: 1, outputPerMillion: 1, cacheWrite1hPerMillion: Number.NaN }] }],
    ["отрицательная цена ступени", { ...price, tiers: [{ inputTokensAbove: 1000, inputPerMillion: -1, outputPerMillion: 1 }] }],
    ["порог ступени не целое положительное", { ...price, tiers: [{ inputTokensAbove: 0, inputPerMillion: 1, outputPerMillion: 1 }] }],
    ["две ступени с одним порогом", { ...price, tiers: [1, 1].map(() => ({ inputTokensAbove: 1000, inputPerMillion: 1, outputPerMillion: 1 })) }],
  ])("отказывает: %s", (_name, broken) => {
    expect(() => createModelCatalog({ models: [profile({ acme: broken })], providers: [provider()] })).toThrow(/acme-model.*acme/);
  });
});

describe("стандартный каталог: цены", () => {
  it("у каждой пары «модель × провайдер» есть цена", () => {
    const missing = standardCatalog.models.flatMap((model) =>
      Object.keys(model.providerModelIds)
        .filter((providerId) => !model.pricing?.[providerId])
        .map((providerId) => `${model.id} × ${providerId}`),
    );
    expect(missing).toEqual([]);
  });

  it("цена кэша не выше цены входа", () => {
    for (const model of standardCatalog.models) {
      for (const [providerId, modelPrice] of Object.entries(model.pricing ?? {})) {
        expect(modelPrice.cachedInputPerMillion ?? 0, `${model.id} × ${providerId}`).toBeLessThanOrEqual(modelPrice.inputPerMillion);
      }
    }
  });

  it("цена записи в кэш не ниже цены входа: меньшая цена — это плата за хранение, расход занижался бы", () => {
    for (const model of standardCatalog.models) {
      for (const [providerId, modelPrice] of Object.entries(model.pricing ?? {})) {
        if (modelPrice.cacheWritePerMillion === undefined) continue;
        expect(modelPrice.cacheWritePerMillion, `${model.id} × ${providerId}`).toBeGreaterThanOrEqual(modelPrice.inputPerMillion);
      }
    }
  });
});

describe("GPT 6 Luna: длинный контекст дороже", () => {
  it("выше 272 тысяч токенов входа — вход и кэш вдвое, выход в полтора раза дороже", () => {
    const luna = standardCatalog.models.find((model) => model.id === "gpt-6-luna")!.pricing!.openrouter!;
    expect(luna.tiers).toEqual([
      { inputTokensAbove: 272_000, inputPerMillion: 0.2, outputPerMillion: 0.75, cachedInputPerMillion: 0.02, cacheWritePerMillion: 0.25, cacheWrite1hPerMillion: 0.25 },
    ]);
  });
});

describe("extendCatalog: цены убранных провайдеров", () => {
  it("уходят вместе с провайдером, цены остальных остаются", async () => {
    const { extendCatalog } = await import("../../../src/models/catalog-changes");
    const trimmed = extendCatalog(standardCatalog, { removeProviders: ["together"] });
    const deepseek = trimmed.models.find((model) => model.id === "deepseek-4.1-flash")!;
    expect(Object.keys(deepseek.pricing ?? {}).sort()).toEqual(["deepseek", "fireworks", "openrouter"]);
  });
});

describe("часы пик в цене", () => {
  const withPeak = (peakHours: unknown): ModelProfile => ({
    id: "peaky",
    displayName: "Peaky",
    contextWindowTokens: 1000,
    acceptsImages: false,
    reasoning: { replayPastTurns: true },
    providerModelIds: { acme: "acme-v1" },
    pricing: { acme: { inputPerMillion: 1, outputPerMillion: 1, peakHours } as ModelPrice },
  });
  const build = (peakHours: unknown) => createModelCatalog({ providers: [provider()], models: [withPeak(peakHours)] });

  it("правильное расписание принимается", () => {
    expect(() => build({ multiplier: 2, windows: [{ days: [1, 5], from: "01:00", to: "04:30" }] })).not.toThrow();
  });

  it.each([
    ["множитель не число", { multiplier: -1, windows: [{ days: [1], from: "01:00", to: "02:00" }] }],
    ["нет окон", { multiplier: 2, windows: [] }],
    ["день вне 1–7", { multiplier: 2, windows: [{ days: [0], from: "01:00", to: "02:00" }] }],
    ["время не ЧЧ:ММ", { multiplier: 2, windows: [{ days: [1], from: "1", to: "02:00" }] }],
    ["пустое окно", { multiplier: 2, windows: [{ days: [1], from: "02:00", to: "02:00" }] }],
    ["пояс не IANA", { multiplier: 2, timeZone: "Mars/Base", windows: [{ days: [1], from: "01:00", to: "02:00" }] }],
    ["дата-исключение не ГГГГ-ММ-ДД", { multiplier: 2, windows: [{ days: [1], from: "01:00", to: "02:00" }], exceptDates: ["7 октября"] }],
  ])("%s — ошибка при создании каталога", (_name, peakHours) => {
    expect(() => build(peakHours)).toThrow(/часы пик|час/i);
  });
});

describe("DeepSeek 4.1 Flash у DeepSeek: цена по времени запроса", () => {
  it("база непиковая, в часы пик (будни 01–04 и 06–10 UTC) вдвое", () => {
    const price = standardCatalog.models.find((model) => model.id === "deepseek-4.1-flash")!.pricing!.deepseek!;
    expect(price).toMatchObject({ inputPerMillion: 0.15, outputPerMillion: 0.6, cachedInputPerMillion: 0.003 });
    expect(price.peakHours).toMatchObject({ multiplier: 2, timeZone: "UTC" });
    expect(price.peakHours!.windows).toEqual([
      { days: [1, 2, 3, 4, 5], from: "01:00", to: "04:00" },
      { days: [1, 2, 3, 4, 5], from: "06:00", to: "10:00" },
    ]);
  });
});
