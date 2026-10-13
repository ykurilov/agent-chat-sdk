# Контракт: лимиты расходов

## Ядро (`@ykurilov/agent-chat-core`)

```ts
type ModelPrice = { inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number; cacheWritePerMillion?: number }
// ModelProfile.pricing?: Record<providerId, ModelPrice>

type UsageRecord = {
  id: string; ownerId: string; chatId: string; messageId: string | null
  source: "answer" | "compaction"; modelId: string; providerId: string
  inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number
  outputTokens: number; reasoningTokens: number
  costUsd: number            // доллары по ценам модели на момент хода; 0, если цены нет (unpricedModels: "ignore")
  createdAt: Date            // начало хода (сжатия), не конец
}
// ChatStorage.insertUsageRecord(record): Promise<void>
// ChatStorage.sumUsage({ ownerId?, chatId?, since? }): Promise<UsageSum[]>  // по парам модель×провайдер; costUsd суммируется

type SpendingLimits = {
  assertWithinLimit(input: { userId: string; chatId: string }): Promise<void>  // бросает SpendingLimitReachedError
  status(input: { userId: string; chatId: string }): Promise<SpendingStatus>
}
type SpendingStatus = { state: "ok" | "warning" | "exhausted"; scope?: "user" | "chat"; period?: "month" | "day" | "none"; share?: number; resetsAt?: string | null }
```

Сжатие: запись расхода пишется и у сжатия, которое не удалось, но было оплачено. Ручное `compactNow` лимит не проверяет.

## Расширение (`@ykurilov/agent-chat-limits`)

```ts
createSpendingLimits({ storage, catalog, budget, period?, warnAt?, unpricedModels?, now?, logError? }): SpendingLimits & { getSpending }
budget: ({ userId, chatId? }) => { user?: number; chat?: number } | Promise<...>
```

## HTTP

- Отказ: `429 {"error":{"kind":"spending_limit_reached","scope","period","resetsAt"}}`.
- `GET {base}/:chatId/spending` → `{ state, scope?, period?, share?, resetsAt? }` (только с `limits`).

## Скин

`SpendingNotice({ id, state: "none" | "warning" | "exhausted", text })` — необязательный компонент договора (версия 8); рисуется в слоте
`Layout.notice` всегда, когда включены лимиты: область для диктора (`role="status"`) стоит в странице заранее, при `none` пуста и места не занимает;
`id` — на элемент, `tabIndex={-1}`. `Composer.sendingBlocked?: boolean` — лимит исчерпан, поле сделать неактивным (Тандем: `disabled`);
`Composer.sendingBlockedReasonId` — `id` надписи для `aria-describedby`. При остановке фокус из поля уходит на надпись, при снятии возвращается.

## Слой поведения

- `AgentChat.spendingLimits` / `useAgentChat({ spendingLimits })`: `GET …/spending` после загрузки истории и после каждого
  законченного ответа; исчерпание с `resetsAt` перечитывается по таймеру (не чаще раза в 5 с, если срок прошёл, а сервер ещё
  держит лимит); 404 и сбои чтения тихо игнорируются.
- Отказ 429 `spending_limit_reached` (работает и без `spendingLimits`): серия переподключений не запускается, лента
  сверяется с историей сервера, несохранённый текст возвращается в поле, состояние — «исчерпано». У правки (`edit()`) отказ — `refused`/`spending_limit`: редактор остаётся открытым с текстом, надпись `editErrors.spendingLimit`.
- Пока исчерпано: `canSubmit`, `canRetry`, `canRegenerate`, `canEdit` — `false`.
