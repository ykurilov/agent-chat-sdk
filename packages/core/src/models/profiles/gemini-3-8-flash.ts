import type { ModelProfile } from "../model-catalog";

export const gemini38FlashProfile: ModelProfile = {
  id: "gemini-3.8-flash",
  displayName: "Gemini 3.8 Flash",
  contextWindowTokens: 1_000_000,
  acceptsImages: true,
  // Через OpenRouter картинку из результата инструмента видит у Google AI Studio; Google Vertex на такой запрос
  // отвечает ошибкой или пустым ответом, поэтому запрещён (замер всех хозяев модели в OpenRouter 2026-10-06, docs/research/openrouter-tool-images.md).
  toolResultImageProviders: ["openrouter"],
  reasoning: {
    replayPastTurns: true,
    // Провайдер отвергает запрос без рассуждений (HTTP 400), поэтому «Выкл» не предлагается.
    levels: ["minimal", "low", "medium", "high"],
    defaultLevel: "medium",
  },
  // Запрет стоит всегда, а не только при картинке: запрос одинаков в каждом ходе, кэш и выбранный хозяин не теряются.
  providerOptions: { openrouter: { provider: { ignore: ["google-vertex"] } } },
  providerModelIds: { openrouter: "google/gemini-3.8-flash" },
  // Цены: прайс-листы провайдеров на 2026-09-30, доллары за миллион токенов (docs/research/model-prices.md).
  // Цены записи в кэш нет: у OpenRouter поле `input_cache_write` (0,0416667 $) — плата за хранение, а не за запись,
  // она в 18 раз ниже цены входа. Запись считается по цене входа: расход не занижается.
  pricing: {
    openrouter: { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075 },
  },
};
