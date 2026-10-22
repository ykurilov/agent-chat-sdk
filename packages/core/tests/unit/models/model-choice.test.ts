import { describe, expect, it, vi } from "vitest";
import type { ModelCatalog, ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { createModelCatalog } from "../../../src/models/model-catalog";
import {
  buildModelMenu,
  effectiveChoiceOfChat,
  InvalidModelChoiceError,
  resolveDefaultChoice,
  validateModelChoice,
} from "../../../src/models/model-choice";

const provider = (id: string): ProviderDescription => ({
  id,
  displayName: id.toUpperCase(),
  apiKeyEnv: `${id.toUpperCase()}_KEY`,
  createLanguageModel: () => {
    throw new Error("не вызывается");
  },
  requestOptions: () => ({}),
  reasoningRequest: () => ({}),
});

const model = (id: string, providers: string[], levels?: ModelProfile["reasoning"]["levels"]): ModelProfile => ({
  id,
  displayName: `Модель ${id}`,
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: levels ? { replayPastTurns: true, levels, defaultLevel: levels[0]! } : { replayPastTurns: true },
  providerModelIds: Object.fromEntries(providers.map((providerId) => [providerId, `${id}@${providerId}`])),
});

/** m1 с уровнями у обоих провайдеров, m2 без уровней только у beta, m3 только у gamma (у него нет ключа). */
const catalog: ModelCatalog = createModelCatalog({
  models: [model("m1", ["alpha", "beta"], ["low", "high"]), model("m2", ["beta"]), model("m3", ["gamma"], ["on", "off"])],
  providers: [provider("alpha"), provider("beta"), provider("gamma")],
});
const env = { ALPHA_KEY: "k", BETA_KEY: "k" };

describe("validateModelChoice", () => {
  it("принимает модель, которую провайдер обслуживает и у которого есть ключ; уровень остаётся", () => {
    expect(validateModelChoice(catalog, env, { modelId: "m1", providerId: "beta", reasoning: "high" })).toEqual({
      modelId: "m1",
      providerId: "beta",
      reasoning: "high",
    });
  });

  it("без уровня подставляет уровень по умолчанию модели; у модели без уровней уровня нет", () => {
    expect(validateModelChoice(catalog, env, { modelId: "m1", providerId: "alpha" }).reasoning).toBe("low");
    expect(validateModelChoice(catalog, env, { modelId: "m2", providerId: "beta" })).toEqual({ modelId: "m2", providerId: "beta" });
  });

  it.each([
    ["неизвестная модель", { modelId: "nope", providerId: "alpha" }],
    ["неизвестный провайдер", { modelId: "m1", providerId: "nope" }],
    ["провайдер не обслуживает модель", { modelId: "m2", providerId: "alpha" }],
    ["у провайдера нет ключа", { modelId: "m3", providerId: "gamma" }],
    ["уровня нет у модели", { modelId: "m1", providerId: "alpha", reasoning: "max" }],
    ["уровень у модели без уровней", { modelId: "m2", providerId: "beta", reasoning: "low" }],
  ])("отказывает: %s", (_case, choice) => {
    expect(() => validateModelChoice(catalog, env, choice)).toThrow(InvalidModelChoiceError);
  });
});

describe("resolveDefaultChoice", () => {
  it("берёт заданный выбор, если он допустим", () => {
    expect(resolveDefaultChoice(catalog, env, { modelId: "m2", providerId: "beta" }, vi.fn())).toEqual({
      modelId: "m2",
      providerId: "beta",
    });
  });

  it("не задан: первая модель каталога у первого провайдера с ключом", () => {
    expect(resolveDefaultChoice(catalog, env, undefined, vi.fn())).toEqual({ modelId: "m1", providerId: "alpha", reasoning: "low" });
    expect(resolveDefaultChoice(catalog, { BETA_KEY: "k" }, undefined, vi.fn())).toEqual({
      modelId: "m1",
      providerId: "beta",
      reasoning: "low",
    });
  });

  it("у заданного выбора нет ключа: выбор остаётся, ошибка про ключ придёт при ответе", () => {
    const logError = vi.fn();
    expect(resolveDefaultChoice(catalog, {}, { modelId: "m2", providerId: "beta" }, logError)).toEqual({ modelId: "m2", providerId: "beta" });
    expect(logError).not.toHaveBeenCalled();
  });

  it("заданной модели нет в каталоге: запись в журнал и первая доступная", () => {
    const logError = vi.fn();
    expect(resolveDefaultChoice(catalog, env, { modelId: "gone", providerId: "alpha" }, logError)).toMatchObject({
      modelId: "m1",
      providerId: "alpha",
    });
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0]![0]).toMatch(/gone/);
  });

  it("ни у одного провайдера нет ключа: первая модель у первого провайдера, ошибка ключа придёт при ответе", () => {
    expect(resolveDefaultChoice(catalog, {}, undefined, vi.fn())).toMatchObject({ modelId: "m1", providerId: "alpha" });
  });
});

describe("effectiveChoiceOfChat", () => {
  const fallback = { modelId: "m2", providerId: "beta" };

  it("сохранённый допустимый выбор остаётся как есть", () => {
    const chat = { modelId: "m1", providerId: "beta", reasoning: "high" };
    expect(effectiveChoiceOfChat(catalog, env, chat, fallback)).toEqual(chat);
  });

  it("модели больше нет, провайдер без ключа или провайдер её не даёт: выбор по умолчанию", () => {
    expect(effectiveChoiceOfChat(catalog, env, { modelId: "gone", providerId: "alpha" }, fallback)).toEqual(fallback);
    expect(effectiveChoiceOfChat(catalog, env, { modelId: "m3", providerId: "gamma" }, fallback)).toEqual(fallback);
    expect(effectiveChoiceOfChat(catalog, env, { modelId: "m2", providerId: "alpha" }, fallback)).toEqual(fallback);
  });

  it("уровня нет у модели или он не сохранён: модель та же, уровень по умолчанию модели", () => {
    expect(effectiveChoiceOfChat(catalog, env, { modelId: "m1", providerId: "beta", reasoning: "max" }, fallback)).toEqual({
      modelId: "m1",
      providerId: "beta",
      reasoning: "low",
    });
    expect(effectiveChoiceOfChat(catalog, env, { modelId: "m1", providerId: "beta" }, fallback).reasoning).toBe("low");
  });
});

describe("buildModelMenu", () => {
  const defaultChoice = { modelId: "m1", providerId: "alpha", reasoning: "low" };

  it("провайдеры с моделями и уровнями; провайдер без ключа не попадает", () => {
    const menu = buildModelMenu(catalog, env, defaultChoice);
    expect(menu.providers.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
    expect(menu.providers[1]!.models).toEqual([
      { id: "m1", displayName: "Модель m1", acceptsImages: false, reasoning: { levels: ["low", "high"], defaultLevel: "low" } },
      { id: "m2", displayName: "Модель m2", acceptsImages: false, reasoning: { levels: [], defaultLevel: null } },
    ]);
    expect(menu.defaultChoice).toEqual(defaultChoice);
  });

  it("провайдер без моделей в каталоге в меню не попадает", () => {
    const lonely = createModelCatalog({ models: [model("m1", ["alpha"])], providers: [provider("alpha"), provider("beta")] });
    expect(buildModelMenu(lonely, env, { modelId: "m1", providerId: "alpha" }).providers.map((entry) => entry.id)).toEqual(["alpha"]);
  });

  it("не содержит ключей, имён переменных окружения и адресов", () => {
    const text = JSON.stringify(buildModelMenu(catalog, { ALPHA_KEY: "секрет-альфа", BETA_KEY: "секрет-бета" }, defaultChoice));
    expect(text).not.toMatch(/секрет|_KEY|https?:/);
  });
});

describe("меню моделей и картинки", () => {
  it("у каждой модели в меню сказано, видит ли она картинки", () => {
    const seeing: ModelProfile = { ...model("see", ["alpha"]), acceptsImages: true };
    const menuCatalog = createModelCatalog({ models: [seeing, model("blind", ["alpha"])], providers: [provider("alpha")] });
    const menu = buildModelMenu(menuCatalog, { ALPHA_KEY: "k" }, { modelId: "see", providerId: "alpha" });
    expect(menu.providers[0]!.models.map((item) => [item.id, item.acceptsImages])).toEqual([
      ["see", true],
      ["blind", false],
    ]);
  });
});

it("публичное меню: группа, описание, метки и базовые цены из каталога, без внутренних настроек", () => {
  const profile = { ...model("priced", ["alpha"]), menu: { group: "Для текста", description: "Работа с документами", tags: ["текст"], internal: "не публиковать" }, pricing: { alpha: { inputPerMillion: 0.2, outputPerMillion: 0.8, cachedInputPerMillion: 0.02 } } };
  const priced = createModelCatalog({ models: [profile], providers: [provider("alpha")] });
  const item = buildModelMenu(priced, env, { modelId: "priced", providerId: "alpha" }).providers[0]!.models[0]!;
  expect(item).toMatchObject({ group: "Для текста", description: "Работа с документами", tags: ["текст"], price: { inputPerMillion: 0.2, outputPerMillion: 0.8 } });
  expect(item).not.toHaveProperty("internal");
  expect(item.price).not.toHaveProperty("cachedInputPerMillion");
});
