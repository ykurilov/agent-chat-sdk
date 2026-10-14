# Data Model: Долгая память

## MemoryNote (ядро, `memory/long-term-memory.ts`)

| Поле | Тип | Правило |
|------|-----|---------|
| `id` | строка | выдаётся хранилищем, уникален |
| `categories` | строки[1..3] | каждая 1–60 знаков после обрезки пробелов, без «/» |
| `content` | строка | 1–500 знаков после схлопывания пробелов |
| `version` | целое ≥ 1 | 1 при создании, +1 при каждой правке |
| `createdAt`, `updatedAt` | время | ставит хранилище |

`ownerId` — свойство хранилища, наружу в записи не выдаётся.

**Ключ дубля**: `categories.join("/")` + `content`, в нижнем регистре, пробелы схлопнуты.

## MemoryNoteInput

`{ categories, content }` — то, что даёт агент или человек; проверяется в `note-rules` до записи.

## Пределы (настройки `createLongTermMemory`)

| Настройка | По умолчанию |
|-----------|--------------|
| `maxNotes` | 200 |
| `maxTotalChars` | 48 000 (сумма длин разделов и текстов) |
| `maxBatch` | 5 |
| `maxBlockChars` | 12 000 |
| `searchLimit` | 10 |

## Таблица `memory_notes`

| Столбец | SQLite | PostgreSQL |
|---------|--------|------------|
| `id` | text PK | text PK |
| `owner_id` | text NOT NULL | text NOT NULL |
| `categories` | text (JSON) NOT NULL | jsonb NOT NULL |
| `content` | text NOT NULL | text NOT NULL |
| `version` | integer NOT NULL DEFAULT 1 | integer NOT NULL DEFAULT 1 |
| `created_at`, `updated_at` | integer (мс) | timestamptz |

Индекс `(owner_id, updated_at)`. Внешнего ключа на чаты нет: удаление чата память не затрагивает. Миграции: SQLite `0009_memory_notes`, PostgreSQL `0008_memory_notes`.

## Методы `ChatStorage` (необязательные)

- `listMemoryNotes(ownerId)` → записи, новейшие по `updatedAt` первыми (равные — по `createdAt`, затем `id`).
- `insertMemoryNotes(ownerId, inputs)` → записи; все или ни одной.
- `updateMemoryNote(ownerId, id, expectedVersion, input)` → запись | `not_found` | `stale_version`.
- `deleteMemoryNote(ownerId, id, expectedVersion)` → `ok` | `not_found` | `stale_version`.
- `clearMemoryNotes(ownerId)` → число удалённых; стирает и служебные строки расширения (этап 6).

Пределы и дубли проверяет пакет; хранилище отвечает за атомарность, владельца и версию.

## Этап 6 (дополнение, отдельная миграция)

- В `memory_notes`: `merged_into` (nullable id результата; у скрытых оригиналов).
- Таблица `memory_optimization_runs`: `id`, `owner_id`, `started_at`, `finished_at`, `status` (`running` | `applied` | `no_changes` | `failed` | `reverted`), `groups` (JSON: результат, оригиналы, версия результата на момент слияния), `error`, `usage_record_id`.
- Список, блок и поиск игнорируют строки с `merged_into`; удаление результата и стирание памяти удаляют их.

## Состояния и переходы записи

создана (v1) → обновлена (v+1) → удалена. Этап 6: обычная → скрыта (`merged_into`) → возвращена (`merged_into` = null) или удалена вместе с результатом.
