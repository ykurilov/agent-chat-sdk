import type { ModelProfile } from "../model-catalog";

export const claudeHaiku55Profile: ModelProfile = {
  id: "claude-haiku-5.5",
  displayName: "Claude Haiku 5.5",
  contextWindowTokens: 1_000_000,
  // Потолок вывода у всех хозяев OpenRouter (`max_completion_tokens`, 2026-10-12). Без него в запросе нет `max_tokens`,
  // и на «Максимуме» рассуждения съедали весь вывод до предела по умолчанию: 69 621 из 71 803 токенов, ответа нет.
  maxOutputTokens: 128_000,
  acceptsImages: true,
  // Живая проверка 2026-10-11: через OpenRouter картинку из результата инструмента видят все хозяева (20 из 20:
  // Anthropic, Google, Amazon Bedrock, Claude Platform on AWS, Azure).
  toolResultImageProviders: ["openrouter"],
  reasoning: {
    // Рассуждения приходят открытым текстом с подписью; подпись нужна Anthropic, чтобы принять их обратно.
    replayPastTurns: true,
    // Живая проверка 2026-10-11: `minimal` не рассуждает вовсе (как «Выкл»), `max` шёл как `xhigh`. Смена уровня между
    // `low`…`max` кэш не сбрасывает; переход на «Выкл» и обратно — сбрасывает (правило Anthropic: включение рассуждений
    // меняет начало запроса).
    levels: ["off", "low", "medium", "high", "max"],
    // Жёсткий бюджет модель не держит (`tokenBudget` не ставим): проба 2026-10-12 — `reasoning.max_tokens` 2000 дал
    // 6082 токена рассуждений. Уровни идут силой (`effort`), а сила у Claude в OpenRouter — доля потолка вывода
    // (`xhigh` — 95 %): «Максимум» уходит как `high`, ответу остаётся пятая часть. Долю модель держит нестрого — проба
    // 2026-10-12 при потолке 8 000: `high` рассуждал все 8 000, — но рассуждает мельче, чем на `xhigh`.
    effortShareOfOutput: true,
    defaultLevel: "medium",
  },
  providerModelIds: { openrouter: "anthropic/claude-haiku-5.5" },
  // Кэш на час: запись дороже (0.20 против 0.125), но чат, где между ходами больше 5 минут, читает кэш, а не пишет заново.
  cacheTtl: "1h",
  // Цены OpenRouter на 2026-10-11, доллары за миллион токенов. От 100 тысяч токенов входа (`min_prompt_tokens`
  // OpenRouter) запрос целиком впятеро дороже.
  pricing: {
    openrouter: {
      inputPerMillion: 0.1,
      outputPerMillion: 0.5,
      cachedInputPerMillion: 0.01,
      cacheWritePerMillion: 0.125,
      cacheWrite1hPerMillion: 0.2,
      tiers: [{ inputTokensAbove: 99_999, inputPerMillion: 0.5, outputPerMillion: 2.5, cachedInputPerMillion: 0.05, cacheWritePerMillion: 0.625, cacheWrite1hPerMillion: 1 }],
    },
  },
};
