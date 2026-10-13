import { describe, expect, it } from "vitest";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { findModel, resolveLanguageModel } from "../../../src/models/model-catalog";
import type { ModelCatalog, ModelProfile } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";

const extraProfile: ModelProfile = {
  id: "extra-model",
  displayName: "Extra Model",
  contextWindowTokens: 128_000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true },
  providerModelIds: { deepseek: "deepseek-extra" },
};

describe("standardCatalog", () => {
  it("содержит профиль DeepSeek 4.1 Flash и провайдеров DeepSeek, Fireworks и Together", () => {
    expect(standardCatalog.models.map((model) => model.id)).toContain("deepseek-4.1-flash");
    expect(standardCatalog.providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(["deepseek", "fireworks", "together"]),
    );
  });
});

describe("extendCatalog", () => {
  it("добавляет модель", () => {
    const catalog = extendCatalog(standardCatalog, { addModels: [extraProfile] });
    expect(catalog.models.map((model) => model.id)).toContain("extra-model");
    expect(standardCatalog.models.map((model) => model.id)).not.toContain("extra-model");
  });

  it("убирает модель", () => {
    const catalog = extendCatalog(standardCatalog, { removeModels: ["deepseek-4.1-flash"] });
    expect(catalog.models.map((model) => model.id)).not.toContain("deepseek-4.1-flash");
  });

  it("отказывает профилю с провайдером, которого нет в каталоге", () => {
    const orphan: ModelProfile = { ...extraProfile, providerModelIds: { nowhere: "x" } };
    expect(() => extendCatalog(standardCatalog, { addModels: [orphan] })).toThrow(/nowhere/);
  });
});

/** Модель из каталога с ключами `env`; ошибки поиска модели и ключа приходят отсюда же. */
function resolve(catalog: ModelCatalog, modelId: string, providerId: string, env: Record<string, string | undefined>) {
  return resolveLanguageModel(findModel(catalog, modelId, providerId), env);
}

describe("resolveLanguageModel", () => {
  it.each([
    ["deepseek", "DEEPSEEK_API_KEY"],
    ["fireworks", "FIREWORKS_API_KEY"],
    ["together", "TOGETHER_API_KEY"],
  ])("без ключа %s в ошибке имя переменной %s, а значение чужого ключа не показано", (providerId, variable) => {
    const secret = "sk-secret-value-123";
    const env = { DEEPSEEK_API_KEY: secret, FIREWORKS_API_KEY: secret, TOGETHER_API_KEY: secret, [variable]: undefined };
    let message = "";
    try {
      resolve(standardCatalog, "deepseek-4.1-flash", providerId, env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(variable);
    expect(message).not.toContain(secret);
  });

  it("отказывает, если провайдер не обслуживает модель", () => {
    const catalog = extendCatalog(standardCatalog, { addModels: [extraProfile] });
    expect(() => resolve(catalog, "extra-model", "fireworks", { FIREWORKS_API_KEY: "k" })).toThrow(/fireworks/);
  });

  it("отказывает неизвестной модели", () => {
    expect(() => resolve(standardCatalog, "missing", "deepseek", {})).toThrow(/missing/);
  });

  it.each([
    ["fireworks", "FIREWORKS_API_KEY", "accounts/fireworks/models/deepseek-v4p1-flash"],
    ["together", "TOGETHER_API_KEY", "deepseek-ai/DeepSeek-V4.1-Flash"],
  ])("собирает модель провайдера %s с id из профиля", (providerId, variable, providerModelId) => {
    const model = resolve(standardCatalog, "deepseek-4.1-flash", providerId, { [variable]: "test-key" });
    expect(typeof model).toBe("object");
    expect((model as { modelId: string }).modelId).toBe(providerModelId);
  });
});
