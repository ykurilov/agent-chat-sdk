# Contract: профиль модели и описание провайдера

Объявлены в `@ykurilov/agent-chat-core`. Особенности модели — в профиле, особенности
провайдера — в описании провайдера (FR-022). Ядро не ветвится по имени модели (принцип III).

```ts
interface ModelProfile {
  id: string                       // "deepseek-4.1-flash"
  displayName: string              // "DeepSeek 4.1 Flash"
  contextWindowTokens: number
  acceptsImages: boolean
  reasoning: {
    /** Возвращать ли рассуждения прошлых ходов (FR-008). Внутри хода — всегда. */
    replayPastTurns: boolean
  }
  /** Id модели у каждого провайдера. Провайдеры вне списка модель не обслуживают. */
  providerModelIds: Record<string, string>   // { deepseek: "deepseek-flash", fireworks: "…" }
  /** Опции провайдера именно для этой модели, если нужны. */
  providerOptions?: Record<string, Record<string, unknown>>
}

interface ProviderDescription {
  id: string                       // "deepseek" | "fireworks"
  displayName: string
  /** Ключ читается из окружения сервера по этому имени. */
  apiKeyEnv: string                // "DEEPSEEK_API_KEY"
  createLanguageModel(providerModelId: string, apiKey: string): LanguageModel
  /** Поля под кэш и прочие постоянные опции запроса (FR-023, SC-009). */
  requestOptions(ctx: { chatId: string }): {
    providerOptions?: Record<string, Record<string, unknown>>
    headers?: Record<string, string>
  }
  /** Подсказки для вида ошибки по телу ответа, если кода HTTP мало. */
  errorHints?: Array<{ match: RegExp; kind: ChatErrorKind }>
}

interface ModelCatalog {
  models: ModelProfile[]
  providers: ProviderDescription[]
}

/** Каталог стандартных моделей ядра; приложение может расширить или сузить его. */
declare const standardCatalog: ModelCatalog
declare function extendCatalog(base: ModelCatalog, change: {
  addModels?: ModelProfile[]; removeModels?: string[]; addProviders?: ProviderDescription[]
}): ModelCatalog
```

## Каталог среза

| Профиль | DeepSeek | Fireworks |
|---|---|---|
| DeepSeek 4.1 Flash | `deepseek-flash`; кэш автоматический | `accounts/fireworks/models/deepseek-v4p1-flash`; `promptCacheKey = chatId`, `x-session-affinity: chatId`, `reasoningHistory: "preserved"` |

`replayPastTurns: true` — рассуждения прошлых ходов возвращаются по умолчанию.

## Проверки

- Модульная: профиль без провайдера в каталоге → ошибка при сборке каталога.
- Живая (`pnpm test:live`), на каждую пару профиль × провайдер (FR-029):
  1. ход с двумя вызовами инструмента подряд проходит без ошибки провайдера (SC-005, 10 из 10);
  2. в запросе второго шага есть рассуждения первого шага (перехват тела запроса через
     `fetch` провайдера) (FR-007);
  3. второй ход в чате: `cacheReadTokens > 0` (SC-009).
