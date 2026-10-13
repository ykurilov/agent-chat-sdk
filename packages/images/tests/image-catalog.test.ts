import { describe, expect, it } from "vitest";
import { aspectRatios, extendImageCatalog, standardImageCatalog } from "../src/index";
import type { ImageModelProfile, ImageProviderDescription } from "../src/index";

const modelOf = (id: string) => standardImageCatalog.models.find((model) => model.id === id)!;

describe("стандартный каталог картинок (FR-037)", () => {
  it("провайдер Runware первым: ключ из RUNWARE_API_KEY, адрес по умолчанию", () => {
    expect(standardImageCatalog.providers.map((provider) => provider.id)).toEqual(["runware", "kie"]);
    const runware = standardImageCatalog.providers[0]!;
    expect(runware.apiKeyEnv).toBe("RUNWARE_API_KEY");
    expect(runware.baseURL).toBe("https://api.runware.ai/v1");
  });

  it("пять моделей Runware, GPT Image 2 первой, id у Runware по research.md, раздел 9; модели KIE — после них", () => {
    const runwareModels = standardImageCatalog.models.filter((model) => model.providerModelIds.runware !== undefined);
    expect(standardImageCatalog.models.slice(0, 5)).toEqual(runwareModels);
    expect(runwareModels.map((model) => [model.id, model.providerModelIds.runware])).toEqual([
      ["gpt-image-2", "openai:gpt-image@2"],
      ["gpt-image-2.5-flare", "openai:gpt-image@2.5-flare"],
      ["gpt-image-2.5-sunburst", "openai:gpt-image@2.5-sunburst"],
      ["seedream-5-flash", "bytedance:seedream@5.0-flash"],
      ["seedream-5-lite", "bytedance:seedream@5.0-lite"],
    ]);
  });

  it("низшее качество: у GPT Image 2 — providerSettings.openai, у GPT Image 2.5 — settings", () => {
    expect(modelOf("gpt-image-2").providerSettings).toEqual({ providerSettings: { openai: { quality: "low" } } });
    expect(modelOf("gpt-image-2.5-flare").providerSettings).toEqual({ settings: { quality: "low" } });
    expect(modelOf("gpt-image-2.5-sunburst").providerSettings).toEqual({ settings: { quality: "low" } });
  });

  it("GPT Image: наименьший размер каждой пропорции — шаг 16, не меньше 655 360 пикселей, 1:1 — 816×816", () => {
    for (const id of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      const sizes = modelOf(id).aspectRatios;
      expect(sizes["1:1"]).toEqual({ width: 816, height: 816 });
      for (const ratio of aspectRatios) {
        const { width, height } = sizes[ratio];
        expect(width % 16, `${id} ${ratio}`).toBe(0);
        expect(height % 16, `${id} ${ratio}`).toBe(0);
        expect(width * height, `${id} ${ratio}`).toBeGreaterThanOrEqual(655_360);
        const [w, h] = ratio.split(":").map(Number) as [number, number];
        expect(Math.abs(width / height - w / h) / (w / h), `${id} ${ratio}`).toBeLessThan(0.01);
      }
      // Наименьшие пары с шагом 16, пропорцией точнее 1 % и площадью не меньше предела.
      expect(sizes).toEqual({
        "1:1": { width: 816, height: 816 },
        "3:2": { width: 1008, height: 672 },
        "2:3": { width: 672, height: 1008 },
        "16:9": { width: 1088, height: 608 },
        "9:16": { width: 608, height: 1088 },
      });
    }
  });

  it("Seedream: разрешение 1K — площадь от 0,92 Мп", () => {
    for (const id of ["seedream-5-flash", "seedream-5-lite"]) {
      for (const ratio of aspectRatios) {
        const { width, height } = modelOf(id).aspectRatios[ratio];
        expect(width * height, `${id} ${ratio}`).toBeGreaterThanOrEqual(921_600);
        expect(width * height, `${id} ${ratio}`).toBeLessThan(1_200_000);
      }
    }
  });

  it("у каждой модели есть запасная цена картинки больше нуля", () => {
    for (const model of standardImageCatalog.models) expect(model.pricePerImageUsd, model.id).toBeGreaterThan(0);
  });
});

const ownModel: ImageModelProfile = {
  id: "my-model",
  displayName: "Моя модель",
  providerModelIds: { mine: "mine:1" },
  aspectRatios: modelOf("gpt-image-2").aspectRatios,
  pricePerImageUsd: 0.01,
};
const ownProvider: ImageProviderDescription = {
  id: "mine",
  displayName: "Мой провайдер",
  apiKeyEnv: "MINE_KEY",
  generate: async () => [{ url: "https://mine.test/1.png" }],
};

describe("extendImageCatalog (FR-036)", () => {
  it("убирает модели, добавляет свои модель и провайдера; исходный каталог не меняется", () => {
    const catalog = extendImageCatalog(standardImageCatalog, { removeModels: ["seedream-5-lite"], addModels: [ownModel], addProviders: [ownProvider] });
    expect(catalog.models.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "seedream-5-flash",
      "z-image",
      "seedream-5-flash-kie",
      "seedream-5-flash-layers",
      "my-model",
    ]);
    expect(catalog.providers.map((provider) => provider.id)).toEqual(["runware", "kie", "mine"]);
    expect(standardImageCatalog.models).toHaveLength(8);
    expect(standardImageCatalog.providers).toHaveLength(2);
  });

  it("модель с тем же id заменяет прежнюю", () => {
    const cheaper = { ...modelOf("gpt-image-2"), pricePerImageUsd: 0.001 };
    const catalog = extendImageCatalog(standardImageCatalog, { addModels: [cheaper] });
    expect(catalog.models.filter((model) => model.id === "gpt-image-2")).toEqual([cheaper]);
  });

  it("connectProviders: прокси через baseURL и headers, остальное у провайдера прежнее", () => {
    const catalog = extendImageCatalog(standardImageCatalog, {
      connectProviders: { runware: { baseURL: "https://proxy.test/runware", headers: { "x-proxy-token": "секрет-прокси" } } },
    });
    const runware = catalog.providers[0]!;
    expect(runware.baseURL).toBe("https://proxy.test/runware");
    expect(runware.headers).toEqual({ "x-proxy-token": "секрет-прокси" });
    expect(runware.apiKeyEnv).toBe("RUNWARE_API_KEY");
    expect(runware.generate).toBe(standardImageCatalog.providers[0]!.generate);
    expect(standardImageCatalog.providers[0]!.baseURL).toBe("https://api.runware.ai/v1");
  });

  it("несогласованная правка — ошибка настройки", () => {
    expect(() => extendImageCatalog(standardImageCatalog, { removeModels: ["нет-такой"] })).toThrow(/нет-такой/);
    expect(() => extendImageCatalog(standardImageCatalog, { connectProviders: { nobody: { baseURL: "https://x.test" } } })).toThrow(/nobody/);
    expect(() => extendImageCatalog(standardImageCatalog, { addModels: [ownModel] })).toThrow(/mine/);
  });
});
