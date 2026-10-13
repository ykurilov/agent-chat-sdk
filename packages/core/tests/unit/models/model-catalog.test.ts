import { describe, expect, it } from "vitest";
import { createModelCatalog } from "../../../src/models/model-catalog";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";

const provider = (overrides: Partial<ProviderDescription> = {}): ProviderDescription => ({
  id: "acme",
  displayName: "Acme",
  apiKeyEnv: "ACME_API_KEY",
  createLanguageModel: () => {
    throw new Error("не вызывается");
  },
  requestOptions: () => ({}),
  reasoningRequest: (level) => ({ providerOptions: { acme: { level } } }),
  ...overrides,
});

const profile = (reasoning: Partial<ModelProfile["reasoning"]> = {}, id = "acme-model"): ModelProfile => ({
  id,
  displayName: "Acme Model",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true, levels: ["low", "high"], defaultLevel: "low", ...reasoning },
  providerModelIds: { acme: "acme-v1" },
});

describe("createModelCatalog: уровни рассуждений", () => {
  it("принимает профиль с уровнями и уровнем по умолчанию", () => {
    expect(() => createModelCatalog({ models: [profile()], providers: [provider()] })).not.toThrow();
  });

  it("принимает профиль без уровней: выбора уровня нет", () => {
    const withoutLevels = profile({ levels: undefined, defaultLevel: undefined });
    expect(() => createModelCatalog({ models: [withoutLevels], providers: [provider({ reasoningRequest: undefined })] })).not.toThrow();
    const emptyLevels = profile({ levels: [], defaultLevel: undefined });
    expect(() => createModelCatalog({ models: [emptyLevels], providers: [provider()] })).not.toThrow();
  });

  it("отказывает профилю с уровнями без уровня по умолчанию", () => {
    const broken = profile({ defaultLevel: undefined });
    expect(() => createModelCatalog({ models: [broken], providers: [provider()] })).toThrow(/acme-model.*по умолчанию/);
  });

  it("отказывает, если уровень по умолчанию не входит в уровни модели", () => {
    const broken = profile({ defaultLevel: "max" });
    expect(() => createModelCatalog({ models: [broken], providers: [provider()] })).toThrow(/max.*acme-model/);
  });

  it("отказывает, если провайдер не умеет уровень профиля", () => {
    const picky = provider({
      reasoningRequest: (level) => {
        if (level === "high") throw new Error("high не поддерживается");
        return {};
      },
    });
    expect(() => createModelCatalog({ models: [profile()], providers: [picky] })).toThrow(/acme.*acme-model.*high/);
  });

  it("отказывает, если у провайдера нет перевода уровней, а у модели они есть", () => {
    const silent = provider({ reasoningRequest: undefined });
    expect(() => createModelCatalog({ models: [profile()], providers: [silent] })).toThrow(/acme.*уровн/);
  });

  it("отказывает повторяющимся id моделей и провайдеров", () => {
    expect(() => createModelCatalog({ models: [profile(), profile()], providers: [provider()] })).toThrow(/acme-model/);
    expect(() => createModelCatalog({ models: [profile()], providers: [provider(), provider()] })).toThrow(/acme/);
  });
});
