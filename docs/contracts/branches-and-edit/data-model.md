# Data Model: ветки и правка

## StoredBranchSelection (ядро)

| Поле | Тип | Смысл |
|---|---|---|
| `id` | string | id записи |
| `chatId` | string | чат |
| `messageId` | string | выбранное сообщение (сосед на развилке) |
| `selectedAt` | string (ISO) | момент выбора; не меньше касания всех соседей + 1 мс |

Правила: только добавляется; порядок — порядок добавления; удаляется вместе с чатом (каскад базы).

## Касание и ветка

```
touchedAt(m) = max(m.createdAt, max{ s.selectedAt : s.messageId = m.id })
child(parent) = argmax touchedAt среди потомков parent (ничья — записанный позже)
branch = root → child → child → …
```

## BranchFork (выход)

```ts
interface BranchFork { messageId: string; siblingIds: string[] }   // siblingIds по времени создания, включая messageId
```

Есть у каждого сообщения текущей ветки, у которого `siblingIds.length > 1`.

## SQLite

`branch_selections(id text pk, chat_id text fk cascade, message_id text, selected_at text, seq integer)`; индексы
`(chat_id, seq)`, уникальный `seq`.

## PostgreSQL

`agent_chat.branch_selections(id text pk, chat_id text fk cascade, message_id text, selected_at timestamp/text как у
`compactions`, seq bigserial-подобный)` — по образцу `compactions`.
