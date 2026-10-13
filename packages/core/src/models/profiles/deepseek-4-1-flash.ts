import type { ModelProfile } from "../model-catalog";

export const deepseek41FlashProfile: ModelProfile = {
  id: "deepseek-4.1-flash",
  displayName: "DeepSeek 4.1 Flash",
  contextWindowTokens: 1_000_000,
  acceptsImages: true,
  // Together даёт модель только с текстом (каталог Together, 2026-10-11): картинка туда не уходит.
  acceptsImagesByProvider: { together: false },
  // Картинку в результате инструмента видит у самого DeepSeek (проверено вживую 2026-10-05) и через OpenRouter у всех
  // хозяев, кроме запрещённых ниже: одни её не видят, другие отвергают запрос (замер всех хозяев модели в OpenRouter 2026-10-06, docs/research/openrouter-tool-images.md).
  toolResultImageProviders: ["deepseek", "openrouter"],
  reasoning: { replayPastTurns: true, levels: ["off", "on"], defaultLevel: "on" },
  // Запрет стоит всегда, а не только при картинке: запрос одинаков в каждом ходе, кэш и выбранный хозяин не теряются.
  providerOptions: { openrouter: { provider: { ignore: ["deepinfra", "open-inference", "phala", "sail-research", "venice"] } } },
  providerModelIds: {
    deepseek: "deepseek-flash",
    fireworks: "accounts/fireworks/models/deepseek-v4p1-flash",
    together: "deepseek-ai/DeepSeek-V4.1-Flash",
    openrouter: "deepseek/deepseek-v4.1-flash",
  },
  // Цены: прайс-листы провайдеров на 2026-09-30, доллары за миллион токенов (docs/research/model-prices.md).
  pricing: {
    // DeepSeek: цена вне пика, в часы пик (будни 01–04 и 06–10 UTC, api-docs.deepseek.com, проверено 2026-10-05) всё
    // вдвое, включая попадания в кэш. Праздники Китая (тоже вне пика) не заданы: расход в них чуть завышается.
    deepseek: {
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
      cachedInputPerMillion: 0.003,
      peakHours: {
        timeZone: "UTC",
        multiplier: 2,
        windows: [
          { days: [1, 2, 3, 4, 5], from: "01:00", to: "04:00" },
          { days: [1, 2, 3, 4, 5], from: "06:00", to: "10:00" },
        ],
      },
    },
    fireworks: { inputPerMillion: 0.3, outputPerMillion: 1.2, cachedInputPerMillion: 0.006 },
    together: { inputPerMillion: 0.3, outputPerMillion: 1.2, cachedInputPerMillion: 0.006 },
    // Платной записи в кэш у хозяев OpenRouter нет (ни `input_cache_write`, ни `input_cache_write_1h`, 2026-10-12): кэш
    // сам, записанное идёт по цене входа. Часовая цена — тоже цена входа: срок метки модель не читает.
    openrouter: { inputPerMillion: 0.3, outputPerMillion: 1.2, cachedInputPerMillion: 0.006, cacheWrite1hPerMillion: 0.3 },
  },
};
