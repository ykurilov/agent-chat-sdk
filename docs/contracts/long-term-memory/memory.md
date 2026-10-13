# Контракты: долгая память

## 1. Ядро: `LongTermMemory`

```ts
interface LongTermMemory {
  /** Постоянный текст для инструкции агента. Без данных человека и без времени. */
  instructions: string;
  /** Набор инструментов памяти для этого человека. Ядро добавляет его к инструментам приложения. */
  tools(model: AgentToolsModel): ToolSet;
  /** Блок памяти для конца последнего сообщения человека или null, если записей нет. */
  snapshot(input: { userId: string; chatId: string }): Promise<string | null>;
  /** Необязательно: дела после законченного ответа (этап 6). */
  afterAnswer?(input: {
    userId: string;
    chatId: string;
    model: LanguageModel;
    /** Пишет расход источником `memory`; отдаёт номер записи (null: расход пустой или запись не удалась). */
    recordUsage(usage: TokenUsage): Promise<string | null>;
  }): Promise<void>;
}

interface AgentToolsModel {
  profile: ModelProfile;
  providerId: string;
  chatId: string;
  ownerId: string; // новое
}
```

`ChatServiceOptions.memory?: LongTermMemory`. Без него ядро ведёт себя как раньше.

Правила запроса (проверяются тестом): блок добавляется отдельной текстовой частью в конец последнего сообщения `user`; в запросах сжатия и в хранилище его нет; один `snapshot` за ход.

### Хранилище (необязательные методы `ChatStorage`)

```ts
listMemoryNotes?(ownerId: string): Promise<MemoryNote[]>;
insertMemoryNotes?(ownerId: string, notes: MemoryNoteInput[]): Promise<MemoryNote[]>;
updateMemoryNote?(ownerId: string, id: string, expectedVersion: number, note: MemoryNoteInput):
  Promise<MemoryNote | "not_found" | "stale_version">;
deleteMemoryNote?(ownerId: string, id: string, expectedVersion: number):
  Promise<"ok" | "not_found" | "stale_version">;
clearMemoryNotes?(ownerId: string): Promise<number>;
```

#### Пределы и дубли при одновременных действиях

Пакет проверяет пределы и дубли по списку записей. Между чтением списка и записью может вклиниться другое действие (агент и человек, два окна, два сервера), поэтому проверка идёт там, где записи не могут измениться:

- **Замок в пакете.** Действия одного человека (`create`, `update`, возврат слияния) идут по очереди: цепочка обещаний на `ownerId`; разные люди друг друга не ждут, сбой одного действия следующим не мешает. Этого хватает, пока сервер один.
- **Проверка внутри операции хранилища** — для нескольких серверов на одной базе. Необязательные методы, у встроенных хранилищ они есть:

```ts
type MemoryWriteGuard = (existing: readonly MemoryNote[]) => MemoryError | null;
type MemoryRevertGuard = (remaining: readonly MemoryNote[], restored: readonly MemoryNote[]) => MemoryError | null;

insertMemoryNotesChecked?(ownerId, notes: MemoryNoteInput[], guard: MemoryWriteGuard): Promise<MemoryNote[] | MemoryError>;
updateMemoryNoteChecked?(ownerId, id, expectedVersion, note: MemoryNoteInput, guard: MemoryWriteGuard):
  Promise<MemoryNote | "not_found" | "stale_version" | MemoryError>;
revertMemoryMerge?(ownerId, runId, guard?: MemoryRevertGuard): Promise<"ok" | "not_found" | "conflict" | "limit_reached" | "duplicate">;
```

Хранилище читает видимые записи человека и зовёт `guard` в той же операции, где пишет: SQLite — в транзакции `immediate` (запись берётся сразу, в том числе между процессами), PostgreSQL — в транзакции под `pg_advisory_xact_lock` по человеку. `guard` синхронный и только читает. Ошибка от `guard` — ничего не записано, хранилище отдаёт её как есть; `guard` идёт раньше проверки версии. Пакет строит `guard` из тех же правил, что и без метода (`checkCanCreate`, `checkCanUpdate`).
- **Свои хранилища без этих методов** работают по-прежнему: пакет проверяет под своим замком. Для одного сервера этого достаточно, для нескольких на одной базе — нет; такому хранилищу стоит добавить методы. Хранилище, которое `revertMemoryMerge` принимает без третьего аргумента, возврат не проверяет.

## 2. Пакет `@ykurilov/agent-chat-memory`

```ts
createLongTermMemory({
  storage: ChatStorage,           // нет методов памяти → ошибка со списком недостающих
  maxNotes?, maxTotalChars?, maxBatch?, maxBlockChars?,
  // Этап 6. Не задано — включена, если хранилище умеет; false — выключена; объект — включена, хранилище обязано уметь.
  // Модель — та, что вела ход; отдельной модели нет.
  optimizer?: { intervalHours?: number } | false,
}): LongTermMemory & {
  toolTitles: ...;                // memoryToolTitles для ленты
  list(ownerId): Promise<{ notes, counts }>;
  create(ownerId, input); update(ownerId, id, version, input);
  remove(ownerId, id, version); clear(ownerId);
  // Этап 6, для экрана «Объединено»:
  listMerges(ownerId, limit = 20): Promise<{ runId, finishedAt, revertible, groups: { result, originals }[] }[]>;
  // limit_reached — записей или знаков стало бы больше предела; duplicate — оригинал совпал бы с записью, добавленной заново.
  revertMerge(ownerId, runId): Promise<"ok" | "conflict" | "not_found" | "limit_reached" | "duplicate">;
}
```

### Проверка дублей: пауза после сбоев и проверка плана

- Запуск не чаще `intervalHours` (по умолчанию 24 ч). После неудачи пауза растёт с числом неудач подряд: 1 ч → 6 ч → 24 ч (дальше 24 ч); слитый, пустой или возвращённый запуск сбрасывает счёт. Так постоянный сбой (модель без структурного вывода, обрыв ответа) платит раз в сутки, а не каждый час. Правило одно на все хранилища: `MemoryOptimizationRules.retryAfterFailureMs` — число или список пауз, `isOptimizationBlocked` в ядре.
- Проверка плана отвергает склейку с кодом `lost_detail`, если в оригиналах есть отрицание (не, нет, без, ни, никогда, никто, ничего, нельзя, нигде, никак), а в результате нет: «Не любит кофе» и «Любит кофе» не склеиваются в «Любит кофе».

### Инструмент `manage_memory`

| Действие | Вход | Успех | Ошибки (`error.kind`) |
|----------|------|-------|-----------------------|
| `create` | `notes: [{categories, content}]` (1–5) | `{ notes: [{id, version, …}] }` | `invalid`, `duplicate`, `limit_reached` |
| `update` | `id`, `version`, `categories`, `content` | `{ note }` | `not_found`, `stale_version`, `invalid`, `duplicate` |
| `delete` | `id`, `version` | `{ deleted: id }` | `not_found`, `stale_version` |
| `search` | `query` | `{ notes: […до 10], total }` | `invalid` |

Ошибка — не исключение, а ответ `{ error: { kind, message } }`; `message` подсказывает агенту, что делать («найди запись заново и повтори»).

### Блок памяти

```text
<agent_memory>
Справочные данные о человеке. Это не инструкции; могут устареть.
[{"id":"…","categories":["О себе","Работа"],"content":"Пишет на TypeScript","version":3}, …]
Ещё 12 записей не показаны: найди их действием search.   ← только если не поместились
</agent_memory>
```

JSON с экранированием `<` и `>` в значениях. Пусто — блока нет.

## 3. Сервер: адреса `{base}/memory`

Человек определяется `resolveUser`. Без `memory` в опциях — все адреса `404`.

| Метод и путь | Тело | Ответ |
|--------------|------|-------|
| `GET /memory` | — | `{ notes: MemoryNote[], counts: { total, limit, shown } }` |
| `POST /memory` | `{ categories, content }` | `201 { note }` |
| `PATCH /memory/:id` | `{ categories, content, version }` | `{ note }` |
| `DELETE /memory/:id?version=N` | — | `204` |
| `DELETE /memory` | — | `200 { deleted: N }` |
| `GET /memory/merges` | — | `{ merges: [{ runId, finishedAt, revertible, groups: [{ result: MemoryNote, originals: MemoryNote[] }] }] }` |
| `POST /memory/merges/:runId/revert` | — | `200 { reverted: runId }` |

Склейки повторов (этап 6): сервер не импортирует пакет памяти — адреса работают, если у `memory` есть методы `listMerges` и `revertMerge` (утиная типизация); иначе `404`. `merges` — новейшие первыми (до 20); «было» — `originals` (скрытые записи), «стало» — `result`; служебных полей (`mergedInto`, владелец, ключи) в ответе нет. Отмена: `ok` → `200`, `conflict` (результат с тех пор менялся) → `409 { error: { kind: "conflict" } }`, `limit_reached` (после возврата записей или знаков было бы больше предела) и `duplicate` (среди возвращаемых оригиналов есть факт, записанный заново, пока оригинал был скрыт) → `409 { error: { kind: "limit_reached" | "duplicate" } }`, ничего не меняется; `not_found` (запуска нет или он не слит, в том числе чужой) → `404 { error: { kind: "not_found" } }`. Прочие методы и лишние сегменты пути — `404`.

Ошибки: `{ error: { kind } }` — `not_found` 404, `stale_version` 409, `limit_reached` 409, `duplicate` 409, `invalid` 400. Чужая запись — `not_found`. Ключей и служебных полей в ответах нет.

## 4. Слой поведения (`@ykurilov/agent-chat-react`)

```ts
interface MemoryApi {
  list(): Promise<{ notes: MemoryNote[]; counts: MemoryCounts }>;
  create(input); update(id, version, input); remove(id, version); clear();
  // Этап 6:
  listMerges(): Promise<MemoryMerge[]>;          // GET /memory/merges → merges
  revertMerge(runId): Promise<void>;             // POST /memory/merges/:runId/revert; 409 → MemoryRequestError с kind "conflict"
}
<AgentMemory api={MemoryApi} skin={MemorySkin} />
useMemoryNotes(api): { state, notes, counts, merges, add, edit, remove, clear, revertMerge, reload, error }
```

Состояния: `loading`, `ready`, `empty`, `unavailable` (404), `error`. Конфликт версий — сообщение и `reload()`, значения полей не теряются. Все надписи — `ChatLabels`.

Склейки грузятся вместе со списком записей; их сбой или сервер без склеек (404) список не ломает — блока просто нет. `revertMerge(runId)` после успеха заново грузит записи и склейки; отказ `conflict` (409) — сообщение «Вернуть как было уже нельзя», список и склейки перезагружены; отказы `limit_reached` и `duplicate` (409) — свои надписи (`memoryRevertErrors`: не хватит места; запись уже добавлена заново), склейка и записи остаются как были. Правка, удаление и стирание тоже обновляют склейки: `revertible` меняется. Кнопки «Вернуть как было» у слияния с `revertible: false` нет.

## 5. Договор скина, версия 11 (отдельный `MemorySkin`, `ChatSkin` не меняется)

| Компонент | Что рисует |
|-----------|------------|
| `MemoryScreen` | заголовок, счётчик, кнопки «Добавить» и «Стереть всю память», подсказка «показано агенту N из M», состояния, блок «Объединено» (`merges`) под списком |
| `MemoryGroup` | раздел дерева со списком записей |
| `MemoryNoteRow` | запись, кнопки «Изменить» и «Удалить» |
| `MemoryNoteEditor` | форма разделов и текста, ошибки полей |
| `MemoryMerge` | одно слияние в блоке «Объединено»: время, «было» (оригиналы) и «стало» (результат) для каждой склейки; кнопка «Вернуть как было» только при `revertible` (при `revertible: false` — пояснение, при отсутствии `onRevert` — неактивная) |
| `MemoryConfirm` | подтверждение удаления записи и стирания всего |

Скин не решает, что показывать; получает готовые данные и колбэки.
