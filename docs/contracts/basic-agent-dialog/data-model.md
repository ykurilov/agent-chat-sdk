# Data Model: Базовый диалог с агентом

Хранимые сущности — `Chat` и `StoredMessage`. Профиль модели, описание провайдера и
инструмент живут в коде, не в базе. Идущий ответ живёт в памяти процесса.

## Chat — чат

| Поле | Тип | Правила |
|---|---|---|
| `id` | string | Создаёт сервер (`crypto.randomUUID()`); клиенту не доверяем |
| `ownerId` | string | Id пользователя от приложения. Каждое действие сверяет его с текущим (FR-024) |
| `modelId` | string | Id профиля модели, например `deepseek-4.1-flash`. Модель последнего хода |
| `providerId` | string | Id провайдера, например `deepseek` или `fireworks` (FR-022a). Провайдер последнего хода |

Модель и провайдер на каждый ход выбирает приложение (`resolveModel`). Ядро записывает
выбор в ответ агента и обновляет `modelId`/`providerId` чата. Смена провайдера посреди чата
допустима: рассуждения другого провайдера новой модели не отправляются (R2).
| `createdAt` | ISO-время | |
| `updatedAt` | ISO-время | Обновляется при каждом новом сообщении |

## StoredMessage — сообщение

Обёртка над `UIMessage` SDK. Части хранятся как есть, одной колонкой JSON.

| Поле | Тип | Правила |
|---|---|---|
| `id` | string | Id сообщения SDK |
| `chatId` | string | Ссылка на `Chat` |
| `parentId` | string \| null | Предыдущее сообщение; `null` только у первого (FR-019) |
| `role` | `user` \| `assistant` | `system` не хранится: инструкция приходит из приложения |
| `parts` | `UIMessage['parts']` (JSON) | Текст, рассуждения (с `providerMetadata`), вызовы и результаты инструментов, `step-start` |
| `formatVersion` | integer | Версия формата сообщений; в срезе `1` = формат `ai` 7 (FR-019) |
| `status` | см. ниже | Только у ответа агента; у сообщения собеседника — `complete` |
| `modelId` | string \| null | У ответа агента — профиль, которым он написан |
| `providerId` | string \| null | У ответа агента — провайдер |
| `usage` | `TokenUsage` \| null | Итог хода (FR-020) |
| `reasoningDurationsMs` | `Record<string, number>` | Длительность каждой части рассуждений по её id (FR-006) |
| `error` | `{ kind: ChatErrorKind }` \| null | Вид ошибки, без сырого текста провайдера |
| `createdAt` | ISO-время | |

`TokenUsage`: `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens` — все
number, по данным провайдера (`totalUsage` SDK).

`ChatErrorKind`: `overloaded` \| `rate_limited` \| `insufficient_funds` \| `invalid_key` \|
`other`.

В браузер сообщение идёт как `UIMessage`: поля `modelId`, `providerId`, `usage`,
`reasoningDurationsMs`, `status`, `error` — в `metadata`; `chatId`, `parentId`,
`formatVersion` клиенту не нужны.

### Состояния ответа агента

```text
streaming ──► complete      ход закончен сам
    │
    ├──────► stopped        собеседник нажал «стоп» (FR-003)
    ├──────► error          ошибка провайдера после тихих повторов (FR-016)
    └──────► interrupted    сервер перезапустился посреди хода (FR-015)
```

- Из конечных состояний (`complete`, `stopped`, `error`, `interrupted`) переходов нет.
- Пока `streaming`, разрешено только дописывать `parts`, `usage`, `reasoningDurationsMs`
  (FR-021).
- Пустой ответ (только рассуждения, без текста) — это `complete` с частями `reasoning`;
  интерфейс показывает отметку «ответа нет» (Edge Cases).

### «Повторить» без дубля (FR-017)

Повтор создаёт новое сообщение агента с тем же `parentId` — сообщением собеседника.
Сообщение собеседника не копируется. Прежний ответ с ошибкой остаётся в базе как соседняя
ветка. В срезе лента показывает последнюю ветку: у каждого сообщения берётся самый поздний
потомок. Переключение веток — следующий срез.

## Правила проверки

- Текст сообщения собеседника после обрезки пробелов не пустой; длина не больше 100 000
  символов.
- В чате одновременно не больше одного идущего ответа; вторая отправка — отказ `409`.
- `parentId` новой реплики собеседника — последний ответ агента текущей ветки; клиент id
  родителя не передаёт, сервер вычисляет сам.
- Чтение `formatVersion` больше известной — ошибка; меньше — переходник поднимает формат
  при чтении, база не переписывается (принцип IV). В срезе версия одна, переходников нет.

## Не хранится

- **Профиль модели и описание провайдера** — код ([contracts/model-profile.md](./model-profile.md)).
- **Инструменты** — передаются приложением при создании обработчика.
- **Идущий ответ** (`RunningAnswer`, в памяти): `chatId`, `messageId`, буфер кусков
  `UIMessageChunk[]`, множество слушателей, `AbortController`, время начала. Удаляется из
  реестра, когда ответ записан в конечном состоянии.

## Таблицы SQLite

```text
chats     (id PK, owner_id, model_id, provider_id, created_at, updated_at)
          INDEX (owner_id, updated_at)
messages  (id PK, chat_id FK→chats, parent_id NULL, role, parts JSON, format_version,
           status, model_id NULL, provider_id NULL, usage JSON NULL,
           reasoning_durations_ms JSON, error JSON NULL, created_at)
          INDEX (chat_id, created_at)
          INDEX (status) WHERE status = 'streaming'
```
