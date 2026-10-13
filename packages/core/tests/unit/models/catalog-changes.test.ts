import { describe, expect, it } from "vitest";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { findModel } from "../../../src/models/model-catalog";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { buildModelMenu } from "../../../src/models/model-choice";
import { standardCatalog } from "../../../src/models/standard-catalog";

const allKeys: Record<string, string> = {
  DEEPSEEK_API_KEY: "k",
  FIREWORKS_API_KEY: "k",
  TOGETHER_API_KEY: "k",
  OPENROUTER_API_KEY: "k",
};
const defaultChoice = { modelId: "deepseek-4.1-flash", providerId: "deepseek" };

const ownProvider: ProviderDescription = {
  id: "own-gateway",
  displayName: "Свой шлюз",
  apiKeyEnv: "OWN_GATEWAY_KEY",
  createLanguageModel: () => {
    throw new Error("не для этого теста");
  },
  requestOptions: () => ({}),
};

const ownModel: ModelProfile = {
  id: "own-model",
  displayName: "Своя модель",
  contextWindowTokens: 64_000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true },
  providerModelIds: { "own-gateway": "own/model-v1" },
};

const menuModels = (catalog: ReturnType<typeof extendCatalog>, env: Record<string, string> = allKeys) =>
  buildModelMenu(catalog, env, defaultChoice).providers.map((provider) => [provider.id, provider.models.map((model) => model.id)]);

describe("extendCatalog: убрать провайдеров", () => {
  it("убранного провайдера нет в каталоге и в меню, модели остаются у остальных", () => {
    const catalog = extendCatalog(standardCatalog, { removeProviders: ["together", "openrouter"] });
    expect(catalog.providers.map((provider) => provider.id)).toEqual(["fireworks", "deepseek"]);
    expect(catalog.models.find((model) => model.id === "deepseek-4.1-flash")?.providerModelIds).not.toHaveProperty("together");
    expect(menuModels(catalog).map(([id]) => id)).toEqual(["fireworks", "deepseek"]);
  });

  it("модель, которую обслуживал только убранный провайдер, исчезает из каталога и меню", () => {
    const catalog = extendCatalog(standardCatalog, { removeProviders: ["openrouter"] });
    expect(catalog.models.map((model) => model.id)).toEqual(["deepseek-4.1-flash", "glm-5.3-flash"]);
    expect(menuModels(catalog).flatMap(([, models]) => models)).not.toContain("gpt-6-luna");
  });

  it("исходный каталог не меняется", () => {
    const before = structuredClone(standardCatalog.models);
    extendCatalog(standardCatalog, { removeProviders: ["openrouter"] });
    expect(standardCatalog.models).toEqual(before);
    expect(standardCatalog.providers.map((provider) => provider.id)).toContain("openrouter");
  });

  it("убрать провайдера, которого нет в каталоге, — ошибка настройки", () => {
    expect(() => extendCatalog(standardCatalog, { removeProviders: ["нет-такого"] })).toThrow(/нет-такого/);
  });
});

describe("extendCatalog: закрепить версию модели", () => {
  it("у провайдера берётся закреплённый id, остальные провайдеры и модели не меняются", () => {
    const pinned = "openai/gpt-6-luna-2026-09-30";
    const catalog = extendCatalog(standardCatalog, { pinModelVersions: { "gpt-6-luna": { openrouter: pinned } } });
    expect(findModel(catalog, "gpt-6-luna", "openrouter").providerModelId).toBe(pinned);
    expect(findModel(catalog, "deepseek-4.1-flash", "openrouter").providerModelId).toBe(
      findModel(standardCatalog, "deepseek-4.1-flash", "openrouter").providerModelId,
    );
    expect(findModel(standardCatalog, "gpt-6-luna", "openrouter").providerModelId).not.toBe(pinned);

    expect(catalog.models.find((model) => model.id === "gpt-6-luna")?.providerModelIds).toEqual({ openrouter: pinned });
  });

  it("закрепление можно вместе с добавлением своей модели", () => {
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [ownProvider],
      addModels: [ownModel],
      pinModelVersions: { "own-model": { "own-gateway": "own/model-v2" } },
    });
    expect(findModel(catalog, "own-model", "own-gateway").providerModelId).toBe("own/model-v2");
  });

  it.each([
    ["неизвестная модель", { "нет-такой": { openrouter: "x" } }, /нет-такой/],
    ["неизвестный провайдер", { "gpt-6-luna": { нет: "x" } }, /нет/],
    ["провайдер не обслуживает модель", { "gpt-6-luna": { fireworks: "x" } }, /fireworks/],
    ["пустой id", { "gpt-6-luna": { openrouter: "" } }, /пуст/],
  ])("%s — ошибка настройки", (_name, pins, message) => {
    expect(() => extendCatalog(standardCatalog, { pinModelVersions: pins })).toThrow(message);
  });
});

describe("extendCatalog: свои модели и провайдеры", () => {
  it("своя модель со своим профилем и провайдер попадают в меню", () => {
    const catalog = extendCatalog(standardCatalog, { addProviders: [ownProvider], addModels: [ownModel] });
    const menu = menuModels(catalog, { ...allKeys, OWN_GATEWAY_KEY: "k" });
    expect(menu.find(([id]) => id === "own-gateway")).toEqual(["own-gateway", ["own-model"]]);
  });

  it("провайдер без ключа в меню не попадает", () => {
    const catalog = extendCatalog(standardCatalog, { addProviders: [ownProvider], addModels: [ownModel] });
    expect(menuModels(catalog).map(([id]) => id)).not.toContain("own-gateway");
  });

  it("removeModels убирает модель у всех провайдеров", () => {
    const catalog = extendCatalog(standardCatalog, { removeModels: ["glm-5.3-flash"] });
    expect(menuModels(catalog).flatMap(([, models]) => models)).not.toContain("glm-5.3-flash");
  });
});
