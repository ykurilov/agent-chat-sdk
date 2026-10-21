import { describe, expect, it } from "vitest";
import { standardCatalog } from "../../../src/models/standard-catalog";

/** Таблица FR-001: у каких провайдеров какая модель и с каким id. */
const expected = {
  "deepseek-4.1-flash": {
    displayName: "DeepSeek 4.1 Flash",
    levels: ["off", "on"],
    defaultLevel: "on",
    encrypted: false,
    providers: {
      deepseek: "deepseek-flash",
      fireworks: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
      together: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
      openrouter: "deepseek/deepseek-v4.1-flash-1017",
    },
  },
  "glm-5.3-flash": {
    displayName: "GLM 5.3 Flash",
    levels: ["low", "medium", "high"],
    defaultLevel: "medium",
    encrypted: false,
    providers: {
      fireworks: "accounts/fireworks/models/glm-5p3-flash",
      together: "zai-org/GLM-5.3-Flash",
      openrouter: "z-ai/glm-5.3-flash",
    },
  },
  "gpt-6-luna": {
    displayName: "GPT 6 Luna",
    levels: ["off", "low", "medium", "high", "max"],
    defaultLevel: "medium",
    encrypted: true,
    providers: { openrouter: "openai/gpt-6-luna" },
  },
  "gemini-3.8-flash": {
    displayName: "Gemini 3.8 Flash",
    levels: ["minimal", "low", "medium", "high"],
    defaultLevel: "medium",
    encrypted: false,
    providers: { openrouter: "google/gemini-3.8-flash" },
  },
  "claude-haiku-5.5": {
    displayName: "Claude Haiku 5.5",
    levels: ["off", "low", "medium", "high", "max"],
    defaultLevel: "medium",
    encrypted: false,
    providers: { openrouter: "anthropic/claude-haiku-5.5" },
  },
} as const;

describe("standardCatalog", () => {
  it("содержит ровно пять моделей и четыре провайдера", () => {
    expect(standardCatalog.models.map((model) => model.id).sort()).toEqual(Object.keys(expected).sort());
    expect(standardCatalog.providers.map((provider) => provider.id).sort()).toEqual(
      ["deepseek", "fireworks", "openrouter", "together"],
    );
  });

  it.each(Object.entries(expected))("%s: уровни, шифр и id у провайдеров по таблице", (id, want) => {
    const model = standardCatalog.models.find((candidate) => candidate.id === id)!;
    expect(model.displayName).toBe(want.displayName);
    expect(model.reasoning.levels).toEqual(want.levels);
    expect(model.reasoning.defaultLevel).toBe(want.defaultLevel);
    expect(model.reasoning.encrypted ?? false).toBe(want.encrypted);
    expect(model.reasoning.replayPastTurns).toBe(true);
    expect(model.providerModelIds).toEqual(want.providers);
  });

  it("GLM и Gemini не предлагают «Выкл»: провайдеры отвергают запрос без рассуждений", () => {
    for (const id of ["glm-5.3-flash", "gemini-3.8-flash"]) {
      expect(standardCatalog.models.find((model) => model.id === id)!.reasoning.levels).not.toContain("off");
    }
  });

  it("ключи провайдеров берутся из своих переменных окружения", () => {
    const envByProvider = Object.fromEntries(standardCatalog.providers.map((provider) => [provider.id, provider.apiKeyEnv]));
    expect(envByProvider).toEqual({
      deepseek: "DEEPSEEK_API_KEY",
      fireworks: "FIREWORKS_API_KEY",
      together: "TOGETHER_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    });
  });
});

describe("картинка в результате инструмента (живые замеры через OpenRouter)", () => {
  it("видят GPT 6 Luna, Gemini 3.8 Flash и Claude Haiku 5.5 через OpenRouter, DeepSeek 4.1 Flash — у DeepSeek, Together, Fireworks и через OpenRouter, GLM 5.3 Flash — через OpenRouter", () => {
    const seen = Object.fromEntries(standardCatalog.models.map((model) => [model.id, model.toolResultImageProviders ?? []]));
    expect(seen).toEqual({
      "deepseek-4.1-flash": ["deepseek", "together", "fireworks", "openrouter"],
      "glm-5.3-flash": ["openrouter"],
      "gpt-6-luna": ["openrouter"],
      "gemini-3.8-flash": ["openrouter"],
      "claude-haiku-5.5": ["openrouter"],
    });
    for (const model of standardCatalog.models.filter((candidate) => candidate.toolResultImageProviders?.length)) {
      expect(model.acceptsImages).toBe(true);
      for (const providerId of model.toolResultImageProviders!) expect(model.providerModelIds).toHaveProperty(providerId);
    }
  });

  it("через OpenRouter модели не попадают к хозяевам, которые картинку в результате инструмента не видят или отвергают (замер 2026-10-06)", () => {
    const ignored = Object.fromEntries(standardCatalog.models.map((model) => [model.id, model.providerOptions?.openrouter]));
    expect(ignored).toEqual({
      "deepseek-4.1-flash": { provider: { ignore: ["deepinfra", "open-inference", "phala", "sail-research", "venice"] } },
      "glm-5.3-flash": { provider: { ignore: ["cloudflare", "deepinfra", "open-inference", "sail-research", "venice"] } },
      "gpt-6-luna": undefined,
      "gemini-3.8-flash": { provider: { ignore: ["google-vertex"] } },
      "claude-haiku-5.5": undefined,
    });
  });
});

describe("Claude Haiku 5.5", () => {
  const haiku = standardCatalog.models.find((model) => model.id === "claude-haiku-5.5")!;

  it("контекст миллион токенов, видит картинки, кэш на час по умолчанию", () => {
    expect(haiku.contextWindowTokens).toBe(1_000_000);
    expect(haiku.acceptsImages).toBe(true);
    expect(haiku.cacheTtl).toBe("1h");
  });

  it("цены OpenRouter 2026-10-11: запись на 5 минут и на час, ступень от 100 тысяч токенов входа", () => {
    expect(haiku.pricing?.openrouter).toEqual({
      inputPerMillion: 0.1,
      outputPerMillion: 0.5,
      cachedInputPerMillion: 0.01,
      cacheWritePerMillion: 0.125,
      cacheWrite1hPerMillion: 0.2,
      tiers: [{ inputTokensAbove: 99_999, inputPerMillion: 0.5, outputPerMillion: 2.5, cachedInputPerMillion: 0.05, cacheWritePerMillion: 0.625, cacheWrite1hPerMillion: 1 }],
      cacheWriteTtl: "1h",
    });
  });
});

describe("DeepSeek 4.1 Flash 1017", () => {
  const model = standardCatalog.models.find((candidate) => candidate.id === "deepseek-4.1-flash")!;

  it("сохраняет контекст 1M и цены Together/Fireworks; OpenRouter использует новый тариф", () => {
    expect(model.contextWindowTokens).toBe(1_000_000);
    for (const provider of ["together", "fireworks"]) {
      expect(model.pricing?.[provider]).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, cachedInputPerMillion: 0.006 });
    }
    expect(model.pricing?.openrouter).toEqual({
      inputPerMillion: 0.15, outputPerMillion: 0.6, cachedInputPerMillion: 0.003, cacheWrite1hPerMillion: 0.15,
      peakHours: model.pricing?.deepseek?.peakHours,
    });
    expect(model.pricing?.openrouter?.cacheWritePerMillion).toBeUndefined();
  });
});
