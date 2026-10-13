import type { ModelProfile } from "../model-catalog";

export const gpt6LunaProfile: ModelProfile = {
  id: "gpt-6-luna",
  displayName: "GPT 6 Luna",
  contextWindowTokens: 1_000_000,
  acceptsImages: true,
  // Живая проверка: через OpenRouter картинку из результата инструмента видит всегда (8 из 8).
  toolResultImageProviders: ["openrouter"],
  reasoning: {
    replayPastTurns: true,
    levels: ["off", "low", "medium", "high", "max"],
    defaultLevel: "medium",
    // Рассуждения приходят зашифрованными: человеку виден только пересказ, шифр возвращается самой модели.
    encrypted: true,
  },
  providerModelIds: { openrouter: "openai/gpt-6-luna" },
  // Цены: прайс-листы провайдеров на 2026-09-30, доллары за миллион токенов (docs/research/model-prices.md).
  // Выше 272 тысяч токенов входа запрос целиком дороже: вход и кэш вдвое, выход в полтора раза (как в каталоге pi-mono).
  pricing: {
    openrouter: {
      inputPerMillion: 0.1,
      outputPerMillion: 0.5,
      cachedInputPerMillion: 0.01,
      cacheWritePerMillion: 0.125,
      // Часовой записи у OpenAI нет (у всех хозяев OpenRouter нет `input_cache_write_1h`, 2026-10-12): метку со сроком
      // модель не читает, запись идёт по обычной цене. Часовая цена — та же.
      cacheWrite1hPerMillion: 0.125,
      tiers: [{ inputTokensAbove: 272_000, inputPerMillion: 0.2, outputPerMillion: 0.75, cachedInputPerMillion: 0.02, cacheWritePerMillion: 0.25, cacheWrite1hPerMillion: 0.25 }],
    },
  },
};
