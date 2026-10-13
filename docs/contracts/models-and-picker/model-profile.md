# Contract: профиль модели, провайдер, каталог — дополнения 003

Дополняет [договор 001](../basic-agent-dialog/model-profile.md). Всё ниже — в
`@ykurilov/agent-chat-core`. Ядро не ветвится по имени модели (принцип III).

```ts
type ReasoningLevelId = "off" | "on" | "minimal" | "low" | "medium" | "high" | "max"

interface ModelProfile {
  // …поля 001
  reasoning: {
    replayPastTurns: boolean
    levels: ReasoningLevelId[]            // [] — выбор уровня не показывается
    defaultLevel?: ReasoningLevelId       // обязателен при непустых levels
    encrypted?: boolean
  }
}

interface ReasoningRequest {
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "provider-default" // параметр SDK
  providerOptions?: ProviderOptionsByProvider
}

interface ProviderDescription {
  // …поля 001
  /**
   * Перевод уровня в запрос. Бросает Error на уровень, которого провайдер не умеет.
   * Необязательный: провайдер без него обслуживает только модели без уровней.
   */
  reasoningRequest?(level: ReasoningLevelId, model: { profile: ModelProfile; providerModelId: string }): ReasoningRequest
}

declare function extendCatalog(base: ModelCatalog, change: {
  addModels?: ModelProfile[]
  removeModels?: string[]
  addProviders?: ProviderDescription[]
  removeProviders?: string[]
  /** Закрепить id модели у провайдера: `{ "gpt-6-luna": { openrouter: "openai/gpt-6-luna-2026-09-30" } }` */
  pinModelVersions?: Record<string, Record<string, string>>
}): ModelCatalog
```

## Стандартный каталог

| Профиль (`id`) | Уровни (по умолчанию) | Шифр | DeepSeek | Fireworks | Together | OpenRouter |
|---|---|---|---|---|---|---|
| DeepSeek 4.1 Flash (`deepseek-4.1-flash`) | off, on (on) | нет | `deepseek-flash` | `accounts/fireworks/models/deepseek-v4p1-flash` | `deepseek-ai/DeepSeek-V4.1-Flash` | `deepseek/deepseek-v4.1-flash` |
| GLM 5.3 Flash (`glm-5.3-flash`) | low, medium, high (medium) | нет | — | `accounts/fireworks/models/glm-5p3-flash` | `zai-org/GLM-5.3-Flash` | `z-ai/glm-5.3-flash` |
| GPT 6 Luna (`gpt-6-luna`) | off, low, medium, high, max (medium) | да | — | — | — | `openai/gpt-6-luna` |
| Gemini 3.8 Flash (`gemini-3.8-flash`) | minimal, low, medium, high (medium) | нет | — | — | — | `google/gemini-3.8-flash` |

Точные id и размеры окна перепроверяются по живым каталогам в срезе 1; расхождение с таблицей —
правка таблицы и профиля вместе.

## Провайдеры

`fireworks`, `deepseek`, `together` — как в 001 плюс `reasoningRequest` (таблица R1). Новый
`openrouter`: `apiKeyEnv: "OPENROUTER_API_KEY"`, модель через `@openrouter/ai-sdk-provider` с
`provider.sort = "throughput"`, `reasoningRequest` по таблице R1 плюс `summary: "concise"` при
`profile.reasoning.encrypted`. Метка кэша `cache_control` на инструкции (`requestOptions().instructionsProviderOptions`,
инструкция уходит сообщением `system`): проверено вживую — Gemini через OpenRouter читает кэш только по ней (без метки
`cached_tokens` = 0 даже на одинаковых запросах), GPT кэширует само, метка ему не мешает.

## Запрос модели

`buildModelRequest` принимает выбор чата (`modelId`, `providerId`, `reasoning?`), берёт уровень
(`reasoning` или `defaultLevel` профиля; профиль без уровней — ничего), вызывает
`provider.reasoningRequest` и сливает результат с `providerOptions` профиля и `requestOptions`
провайдера. Рассуждения другой модели или другого провайдера из истории вырезаются как раньше.

## Проверки

- Модульные: каждый профиль × каждый его провайдер × каждый уровень переводится; уровень, которого
  провайдер не умеет, — ошибка при сборке каталога; `removeProviders`, `pinModelVersions`, свой профиль;
  `defaultLevel` вне `levels` — ошибка.
- Живые (`pnpm test:live model-matrix`): 9 пар из таблицы, три хода на пару (R11).
