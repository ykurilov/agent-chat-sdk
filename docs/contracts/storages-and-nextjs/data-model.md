# Data Model: 004

Сущности `Chat` и `StoredMessage` не меняются (см. [001 data-model](../basic-agent-dialog/data-model.md)).
Ниже — их раскладка в PostgreSQL. Схема базы: `agent_chat`.

## agent_chat.chats

| Поле | Тип | Заметки |
|---|---|---|
| id | text PK | |
| owner_id | text NOT NULL | |
| model_id, provider_id | text NOT NULL | |
| created_at, updated_at | text NOT NULL | ISO 8601 |

Индекс `chats_owner_updated_idx (owner_id, updated_at)`.

## agent_chat.messages

| Поле | Тип | Заметки |
|---|---|---|
| seq | bigint identity | порядок записи; в `StoredMessage` не попадает |
| id | text PK | |
| chat_id | text NOT NULL → chats.id ON DELETE CASCADE | |
| parent_id | text NULL | |
| role | text NOT NULL | `user` \| `assistant` |
| parts | json NOT NULL | |
| format_version | integer NOT NULL | |
| status | text NOT NULL | |
| model_id, provider_id | text NULL | |
| usage | json NULL | |
| reasoning_durations_ms | json NOT NULL | |
| error | json NULL | |
| created_at | text NOT NULL | ISO 8601 |

Индексы: `messages_chat_created_idx (chat_id, created_at, seq)`, `messages_streaming_idx (status) WHERE status = 'streaming'`.

## Журнал миграций

`agent_chat.__drizzle_migrations` (таблица Drizzle). Папка `drizzle/` в пакете, публикуется.
