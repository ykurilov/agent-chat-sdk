# Data Model: Автосжатие истории и поиск по старой переписке

## StoredCompaction

| Поле | Тип | Смысл |
|---|---|---|
| `id` | string (uuid) | id записи |
| `chatId` | string | чат |
| `fromMessageId` | string | первое сообщение диапазона (первое сообщение чата или начало диапазона прежней записи) |
| `throughMessageId` | string | последнее сообщение диапазона; после него — хвост |
| `summary` | string | Markdown-сводка |
| `summaryTokens` | number | размер сводки по данным провайдера (`outputTokens − reasoningTokens`) |
| `modelId`, `providerId` | string | кто сжимал |
| `usage` | TokenUsage \| null | расход на сжатие |
| `createdAt` | ISO-время | создание |

Правила: только добавляется; порядок `listCompactions` — порядок добавления; активная на ветке — последняя запись, чей
`throughMessageId` лежит на ветке.

## TokenUsage (расширение)

`contextTokens?: number` — вход + выход последнего шага ответа.

## Настройки ядра

```
CompactionSettings {
  thresholdTokens = 200_000
  tailTokens = 20_000
  summaryCeilingTokens = 20_000
  model?: { modelId, providerId }
  instruction?: string
}
```
Порог ответа = `min(thresholdTokens, 0.8 × contextWindowTokens)`; ожидание — от `0.9 × contextWindowTokens`.

## Ответ истории

`getHistory` → `{ chat, messages, running, compactions: CompactionMarker[], compacting: boolean }`,
`CompactionMarker = { id, fromMessageId, throughMessageId, summary, summaryTokens, createdAt }`.

## Состояние координатора (в памяти сервера)

На чат: `running: Promise | null`, `failedAt: number | null` (backoff 5 минут). После перезапуска пусто.
