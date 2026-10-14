import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../../src/chat-service";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { cachePriceWarnings } from "../../../src/models/model-catalog";
import type { ModelProfile } from "../../../src/models/model-catalog";
import { createOpenRouterProvider } from "../../../src/models/providers/openrouter";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";

const haiku = standardCatalog.models.find((model) => model.id === "claude-haiku-5.5")!;
const withHaikuPrice = (price: NonNullable<ModelProfile["pricing"]>[string]): ModelProfile => ({ ...haiku, pricing: { openrouter: price } });

describe("предупреждения о цене записи в кэш", () => {
  it("стандартный каталог — без предупреждений", () => {
    expect(cachePriceWarnings(standardCatalog)).toEqual([]);
  });

  it("у цены есть часовая запись, а у ступени нет — предупреждение про ступень", () => {
    const { tiers, ...base } = haiku.pricing!.openrouter!;
    const { cacheWrite1hPerMillion: _hour, ...tierWithoutHour } = tiers![0]!;
    const catalog = extendCatalog(standardCatalog, { addModels: [withHaikuPrice({ ...base, tiers: [tierWithoutHour] })] });
    expect(cachePriceWarnings(catalog)).toEqual([expect.stringMatching(/claude-haiku-5\.5.*openrouter.*ступен.*99999.*cacheWrite1hPerMillion/)]);
  });

  it("настройка провайдера делает модель часовой, а часовой цены нет — предупреждение: запись по цене 5 минут", () => {
    const catalog = extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ cacheTtlByModel: { "gemini-3.8-flash": "1h" } })] });
    expect(cachePriceWarnings(catalog)).toEqual([expect.stringMatching(/gemini-3\.8-flash.*openrouter.*на час.*cacheWrite1hPerMillion.*cacheWritePerMillion/)]);
  });

  it("служба чата пишет предупреждения в журнал при запуске", () => {
    const logError = vi.fn();
    createChatService({
      storage: createInMemoryChatStorage(),
      catalog: extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ cacheTtl: "1h" })] }),
      agent: { instructions: "Ты помощник." },
      env: { OPENROUTER_API_KEY: "k" },
      logError,
    });
    const logged = logError.mock.calls.map(([message]) => String(message));
    expect(logged.filter((message) => /на час/.test(message)).length).toBeGreaterThanOrEqual(1);
    expect(logged.some((message) => /gemini-3\.8-flash/.test(message))).toBe(true);
  });

  it("час для всех моделей OpenRouter: часовая цена есть у всех, кроме Gemini (у OpenRouter её нет)", () => {
    // Конструктор приложений 0.46.0: предупреждали DeepSeek, GPT и Haiku. У Haiku стандартного каталога часовая цена есть с 0.43.
    const catalog = extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ cacheTtl: "1h" })] });
    expect(cachePriceWarnings(catalog)).toEqual([expect.stringMatching(/«gemini-3\.8-flash»/)]);
  });
});
