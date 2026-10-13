import type { ModelProfile } from "../model-catalog";

export const glm53FlashProfile: ModelProfile = {
  id: "glm-5.3-flash",
  displayName: "GLM 5.3 Flash",
  contextWindowTokens: 1_000_000,
  acceptsImages: true,
  // Together даёт модель только с текстом (каталог Together, 2026-10-11): картинка туда не уходит.
  acceptsImagesByProvider: { together: false },
  // Через OpenRouter картинку в результате инструмента видит у всех хозяев, кроме запрещённых ниже: одни её не видят
  // или выдумывают, другие отвергают запрос (замер всех хозяев модели в OpenRouter 2026-10-06, docs/research/openrouter-tool-images.md).
  toolResultImageProviders: ["openrouter"],
  reasoning: {
    replayPastTurns: true,
    // Провайдеры отвергают запрос без рассуждений (HTTP 400), поэтому «Выкл» не предлагается.
    levels: ["low", "medium", "high"],
    defaultLevel: "medium",
  },
  // Запрет стоит всегда, а не только при картинке: запрос одинаков в каждом ходе, кэш и выбранный хозяин не теряются.
  providerOptions: { openrouter: { provider: { ignore: ["cloudflare", "deepinfra", "open-inference", "sail-research", "venice"] } } },
  providerModelIds: {
    fireworks: "accounts/fireworks/models/glm-5p3-flash",
    together: "zai-org/GLM-5.3-Flash",
    openrouter: "z-ai/glm-5.3-flash",
  },
  // Цены: прайс-листы провайдеров на 2026-09-30, доллары за миллион токенов (docs/research/model-prices.md).
  pricing: {
    fireworks: { inputPerMillion: 0.15, outputPerMillion: 0.5, cachedInputPerMillion: 0.03 },
    together: { inputPerMillion: 0.15, outputPerMillion: 0.5, cachedInputPerMillion: 0.03 },
    // Платной записи в кэш у хозяев OpenRouter нет (2026-10-12): записанное — по цене входа, часовое тоже.
    openrouter: { inputPerMillion: 0.15, outputPerMillion: 0.5, cachedInputPerMillion: 0.03, cacheWrite1hPerMillion: 0.15 },
  },
};
