import type { ModelProfile } from "../model-catalog";

export const deepseek41FlashProfile: ModelProfile = {
  id: "deepseek-4.1-flash",
  displayName: "DeepSeek 4.1 Flash",
  contextWindowTokens: 1_000_000,
  acceptsImages: true,
  // 1017: картинка в результате инструмента проверена у DeepSeek, OpenRouter и Fireworks 2026-10-22.
  // Together: новый id в каталоге; живой вызов вернул 402, отметка сохранена по замеру предыдущей версии.
  // Запрет хозяев ниже сохранён по ранним замерам (docs/research/openrouter-tool-images.md);
  // проверка обычного маршрута 1017 не заменяет отдельного замера каждого хозяина.
  toolResultImageProviders: ["deepseek", "together", "fireworks", "openrouter"],
  reasoning: { replayPastTurns: true, levels: ["off", "on"], defaultLevel: "on" },
  // Запрет стоит всегда, а не только при картинке: запрос одинаков в каждом ходе, кэш и выбранный хозяин не теряются.
  providerOptions: { openrouter: { provider: { ignore: ["deepinfra", "open-inference", "phala", "sail-research", "venice"] } } },
  // В словаре модели есть склеенный токен «?\n\n». Together по умолчанию хвост не режет и изредка (≈1 ответ из 1400)
  // берёт его в конце вместо «?» и конца ответа: модель не останавливается, пишет «user…» за собеседника, вторые
  // рассуждения и новый ответ, а каша в истории провоцирует повтор. 0,05 отсекает такие слова (у них ≤0,6 % при ≥95 % у «?»):
  // прогон 35 учеников обучающего приложения — каши 0 из 1036 ответов (было 2 случая). Уходит к Together и OpenRouter;
  // DeepSeek напрямую обрезки не принимает.
  sampling: { minP: 0.05 },
  // 1017: прямой DeepSeek обновляет alias сам; остальные провайдеры используют датированный id.
  providerModelIds: {
    deepseek: "deepseek-flash",
    fireworks: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
    together: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    openrouter: "deepseek/deepseek-v4.1-flash-1017",
  },
  // Цены за миллион токенов: каталоги провайдеров 2026-10-22.
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
    // Платной записи в кэш у хозяев OpenRouter нет (ни `input_cache_write`, ни `input_cache_write_1h`, 2026-10-22): кэш
    // сам, записанное идёт по цене входа. Часовая цена — тоже цена входа: срок метки модель не читает.
    openrouter: {
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
      cachedInputPerMillion: 0.003,
      cacheWrite1hPerMillion: 0.15,
      // Каталог OpenRouter pricing.overrides: то же расписание пика, что у прямого DeepSeek.
      peakHours: {
        timeZone: "UTC",
        multiplier: 2,
        windows: [
          { days: [1, 2, 3, 4, 5], from: "01:00", to: "04:00" },
          { days: [1, 2, 3, 4, 5], from: "06:00", to: "10:00" },
        ],
      },
    },
  },
};
