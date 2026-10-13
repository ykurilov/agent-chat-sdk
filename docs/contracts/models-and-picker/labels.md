# Contract: надписи — дополнения 003

Дополняет [001](../basic-agent-dialog/labels.md). В `ChatLabels` (`@ykurilov/agent-chat-react`)
добавляются:

```ts
interface ChatLabels {
  // …
  /** Названия уровней рассуждений; приложение заменяет как остальные надписи. */
  reasoningLevels: Record<ReasoningLevelId, string>
  /** Не удалось сохранить выбор модели. */
  modelChoiceFailed: string
  /** Не удалось получить список моделей. */
  modelMenuFailed: string
}
```

Русские значения: `off` «Выкл», `on` «Вкл», `minimal` «Минимальный», `low` «Низкий», `medium` «Средний»,
`high` «Высокий», `max` «Максимум»; `modelChoiceFailed` «Не удалось сменить модель»; `modelMenuFailed`
«Список моделей не загрузился». Названия моделей и провайдеров берутся из профилей и описаний
(`displayName`), не из надписей.
