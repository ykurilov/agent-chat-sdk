import { describe, expect, it } from "vitest";
import { modelAcceptsImages } from "../../../src";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { createModelCatalog } from "../../../src/models/model-catalog";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { buildModelMenu } from "../../../src/models/model-choice";
import { createOpenRouterProvider } from "../../../src/models/providers/openrouter";
import { standardCatalog } from "../../../src/models/standard-catalog";

const provider = (id: string, extra: Partial<ProviderDescription> = {}): ProviderDescription => ({
  id,
  displayName: id.toUpperCase(),
  apiKeyEnv: `${id.toUpperCase()}_KEY`,
  createLanguageModel: () => {
    throw new Error("не вызывается");
  },
  requestOptions: () => ({}),
  ...extra,
});

const seeing = (byProvider?: Record<string, boolean>): ModelProfile => ({
  id: "m",
  displayName: "M",
  contextWindowTokens: 1000,
  acceptsImages: true,
  ...(byProvider && { acceptsImagesByProvider: byProvider }),
  reasoning: { replayPastTurns: true },
  providerModelIds: { alpha: "m@alpha", beta: "m@beta" },
});

describe("зрение по паре «модель + провайдер»", () => {
  it("без отметок провайдеров — как у модели целиком", () => {
    expect(modelAcceptsImages(seeing(), "alpha")).toBe(true);
    expect(modelAcceptsImages({ ...seeing(), acceptsImages: false }, "alpha")).toBe(false);
  });

  it("отметка провайдера главнее отметки модели — в обе стороны", () => {
    const profile = seeing({ beta: false });
    expect(modelAcceptsImages(profile, "alpha")).toBe(true);
    expect(modelAcceptsImages(profile, "beta")).toBe(false);
    const blindButBeta = { ...seeing({ beta: true }), acceptsImages: false };
    expect(modelAcceptsImages(blindButBeta, "alpha")).toBe(false);
    expect(modelAcceptsImages(blindButBeta, "beta")).toBe(true);
  });

  it("каталог отказывает отметке провайдера, который модель не обслуживает", () => {
    expect(() => createModelCatalog({ models: [seeing({ gamma: false })], providers: [provider("alpha"), provider("beta"), provider("gamma")] })).toThrow(
      /«m».*«gamma».*не обслуживает/,
    );
  });

  it("маршрут OpenRouter берёт отметку провайдера-образца, своя отметка главнее", () => {
    const routes = [createOpenRouterProvider(), createOpenRouterProvider({ id: "openrouter-a", only: ["a"] }), createOpenRouterProvider({ id: "openrouter-b", only: ["b"] })];
    const profile: ModelProfile = { ...seeing({ openrouter: false, "openrouter-b": true }), providerModelIds: { openrouter: "vendor/m" } };
    const catalog = createModelCatalog({ models: [profile], providers: routes });
    const model = catalog.models[0]!;
    expect(modelAcceptsImages(model, "openrouter")).toBe(false);
    expect(modelAcceptsImages(model, "openrouter-a")).toBe(false);
    expect(modelAcceptsImages(model, "openrouter-b")).toBe(true);
  });

  it("убранный провайдер уходит и из отметок", () => {
    const catalog = extendCatalog(createModelCatalog({ models: [seeing({ beta: false })], providers: [provider("alpha"), provider("beta")] }), { removeProviders: ["beta"] });
    expect(catalog.models[0]!.acceptsImagesByProvider).toEqual({});
  });

  it("меню говорит о зрении для каждой пары, в том числе для скрытого выбора по умолчанию", () => {
    const catalog = createModelCatalog({
      models: [seeing({ beta: false })],
      providers: [provider("alpha"), provider("beta"), provider("hidden", { hiddenFromMenu: true })],
    });
    const withHidden = createModelCatalog({
      models: [{ ...seeing({ hidden: false }), providerModelIds: { alpha: "m@alpha", hidden: "m@hidden" } }],
      providers: [provider("alpha"), provider("hidden", { hiddenFromMenu: true })],
    });
    const env = { ALPHA_KEY: "k", BETA_KEY: "k", HIDDEN_KEY: "k" };
    const menu = buildModelMenu(catalog, env, { modelId: "m", providerId: "alpha" });
    expect(menu.providers.map((entry) => [entry.id, entry.models[0]!.acceptsImages])).toEqual([
      ["alpha", true],
      ["beta", false],
    ]);
    expect(buildModelMenu(withHidden, env, { modelId: "m", providerId: "hidden" }).defaultChoice.details?.acceptsImages).toBe(false);
  });
});

describe("стандартный каталог: кто видит картинку в сообщении", () => {
  it("через Together DeepSeek 4.1 Flash и GLM 5.3 Flash картинок не видят (каталог Together: только текст), у остальных провайдеров видят", () => {
    const seen = Object.fromEntries(
      standardCatalog.models.map((model) => [model.id, Object.fromEntries(Object.keys(model.providerModelIds).map((providerId) => [providerId, modelAcceptsImages(model, providerId)]))]),
    );
    expect(seen).toEqual({
      "deepseek-4.1-flash": { deepseek: true, fireworks: true, together: false, openrouter: true },
      "glm-5.3-flash": { fireworks: true, together: false, openrouter: true },
      "gpt-6-luna": { openrouter: true },
      "gemini-3.8-flash": { openrouter: true },
      "claude-haiku-5.5": { openrouter: true },
    });
  });
});
