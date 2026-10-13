# @ykurilov/agent-chat-memory

Долгая память агента: заметки о человеке и его правила («отвечай на ты», «не предлагай npm») переживают чаты.
Агент сам решает, что запомнить, по ходу разговора; человек видит записи на экране памяти и правит их.
Отдельное расширение: приложению, которому память не нужна, она не нужна и в сборке.

```bash
pnpm add @ykurilov/agent-chat-memory
```

## Подключение

Сервер: память собирается из хранилища чатов и передаётся обработчику. Адреса `{base}/memory` для экрана появляются сами.

```ts
import { createLongTermMemory } from "@ykurilov/agent-chat-memory";

const memory = createLongTermMemory({ storage }); // SQLite, PostgreSQL или хранилище в памяти

createChatHandler({
  // …остальное как в docs/getting-started.md, шаг 4
  storage,
  memory,
});
```

Ядро (`createChatService({ …, memory })`) принимает то же самое; обработчик только передаёт опцию дальше.

Браузер: экран памяти и названия строк вызова.

```tsx
import { AgentMemory, ChatLabelsProvider, createMemoryApi, russianLabels } from "@ykurilov/agent-chat-react";
import { tandemMemorySkin } from "@ykurilov/agent-chat-skin-tandem";
import { withMemoryToolTitles } from "@ykurilov/agent-chat-memory/labels";
import { useMemo } from "react";

function MemoryPage() {
  const memoryApi = useMemo(() => createMemoryApi({ api: "/api/chat" }), []); // один раз: при смене объекта список грузится заново
  return <AgentMemory api={memoryApi} skin={tandemMemorySkin} />;
}

// В ленте чата вызов инструмента называется «Работа с памятью», а не `manage_memory`:
<ChatLabelsProvider labels={withMemoryToolTitles(russianLabels)}>…</ChatLabelsProvider>;
// по-английски: withMemoryToolTitles(englishLabels, englishMemoryToolTitles)
```

Оба словаря есть и в корне пакета: `import { englishMemoryToolTitles, memoryToolTitles } from "@ykurilov/agent-chat-memory"`.

`./labels` — отдельная точка входа без кода сервера: безопасна в браузерной сборке. Подпись можно вложить в другие:
`withMemoryToolTitles(withHistorySearchTitles(russianLabels))`.

## Что делает подключение

- К инструкции агента добавляется постоянный текст о памяти (один раз), к инструментам — `manage_memory`. Имя инструмента занято: одноимённый инструмент приложения — ошибка при создании.
- Записи человека попадают в вопрос первого хода чата: шапка `<agent_memory>` и по блоку на запись. Как файл правил в Claude Code, память читается один раз на чат: в идущем чате она не перечитывается, и новые, изменённые и удалённые записи (в том числе записанные самим агентом — их он видит в переписке) на каждом ходе не досылаются. Память читается заново: в новом чате, после сжатия истории, при правке первого сообщения или «Переделать» первого ответа, в первом личном ходе после группового и в ходе после сбоя чтения. Если после сжатия в хвосте остался прошлый ответ, в новый вопрос идут новые и изменённые записи и строка `[Больше не действует: «memory:<id>»]` про удалённые. Запись, которая не влезла в `maxBlockChars`, — не удалённая: `blocks()` отдаёт её как `{ key: "memory:<id>", hidden: true }`, и модель, видевшая её раньше, получает строку `[Не показано ради места, но по-прежнему действует: «memory:<id>»]`.
- Поэтому начало запроса от хода к ходу то же, и кэш модели сохраняется: правка одной записи стоит одной строки, а не всего блока. В историю на экране, в сжатие и в поиск по переписке блок не попадает; он хранится служебной частью ответа. Проверяет тест в ядре.
- Сбой чтения памяти не ломает ответ: ход идёт без блока, ошибка в журнале сервера. Следующий ход того же чата попробует прочитать память снова.
- Хранилище без методов памяти отклоняется при создании (`MemoryStorageNotSupportedError` со списком недостающих методов).

## Инструмент `manage_memory`

| Действие | Вход | Ответ |
|---|---|---|
| `create` | `notes: [{ categories, content }]`, от 1 до 5 записей | `{ notes }` |
| `update` | `id`, `version`, `categories`, `content` | `{ note }` |
| `delete` | `id`, `version` | `{ deleted }` |
| `search` | `query` | `{ notes, total }`, до 10 записей |

Ошибка приходит ответом `{ error: { kind, message } }`, а не исключением: `invalid`, `duplicate`, `limit_reached`, `not_found`, `stale_version`.
В `message` подсказка, что делать дальше («найди запись заново и повтори»). `id` и `version` агент берёт из блока памяти или из поиска.

Запись: от 1 до 3 разделов (до 60 знаков, без «/») и текст до 500 знаков. Дубль (тот же текст в том же разделе, без учёта регистра и лишних пробелов) отклоняется.

## Пределы

`maxNotes` 200 записей на человека, `maxTotalChars` 48 000 знаков на все записи, `maxBatch` 5 записей в одном `create`, `maxBlockChars` 12 000 знаков в блоке запроса.
Не поместилось в блок — в нём самые недавно изменённые, остальные агент находит поиском (строка «Ещё N записей не показаны»), а экран памяти пишет, сколько показано агенту.

## Адреса сервера

Человек определяется `resolveUser`. Без опции `memory` все адреса отвечают `404`.

| Запрос | Ответ |
|---|---|
| `GET {base}/memory` | `{ notes, counts: { total, limit, shown } }` |
| `POST {base}/memory` с `{ categories, content }` | `201 { note }` |
| `PATCH {base}/memory/:id` с `{ categories, content, version }` | `{ note }` |
| `DELETE {base}/memory/:id?version=N` | `204` |
| `DELETE {base}/memory` (стереть всю память) | `{ deleted: N }` |

| `GET {base}/memory/merges` | `{ merges }`: склейки, которые ещё можно вернуть |
| `POST {base}/memory/merges/:runId/revert` | `{ reverted: runId }` |

Ошибки: `not_found` 404 (чужая запись — тоже 404), `stale_version`, `limit_reached` и `duplicate` — 409, `invalid` — 400.
Адреса склеек отвечают `404`, если хранилище склейку не умеет. Возврат склейки отвечает `409` с `{ error: { kind } }`: `conflict` (записи после склейки менялись),
`limit_reached` (после возврата записей стало бы больше предела) или `duplicate` (одну из записей уже добавили заново). Экран пишет, что делать.

## Склейка повторов

После ответа агента память раз в сутки просит ту же модель, что вела ход, найти в записях человека повторы. Модель предлагает группы, код каждую проверяет
(состав, пределы, не потерялись ли цифры, даты, имена и отрицание: «не любит кофе» и «любит кофе» не склеиваются) и применяет только годные.
Экран памяти показывает раздел «Объединено» с исходными записями и кнопкой «Вернуть как было». Отдельной модели для проверки нет.

```ts
createLongTermMemory({ storage });                                   // включена, если хранилище умеет
createLongTermMemory({ storage, optimizer: { intervalHours: 12 } }); // раз в 12 часов; хранилище обязано уметь
createLongTermMemory({ storage, optimizer: false });                 // выключена
```

**Пауза после сбоев.** Если запуск не удался (модель не дала разбираемый ответ, обрыв, отказ проверки), следующий ждёт час, после второго подряд сбоя — 6 часов,
после третьего и дальше — сутки. Удачный запуск (даже «повторов нет») сбрасывает счёт. Запуск, который завис и потерял право на работу, тоже считается сбоем.

## Одновременные действия

Пределы и дубли проверяются под замком на человека: два вызова подряд (агент и экран, две вкладки) не проскочат мимо `maxNotes`, `maxTotalChars` и проверки дублей.
Возврат склейки проверяет пределы и дубли так же, как обычное добавление.

## Свой скин экрана памяти

Договор скина версии 11: отдельный `MemorySkin` (`MemoryScreen`, `MemoryGroup`, `MemoryNoteRow`, `MemoryNoteEditor`, `MemoryConfirm`),
`ChatSkin` не менялся. Скин рисует готовые данные и зовёт колбэки; все надписи берёт из `useChatLabels()`. Подробно — `docs/contracts/long-term-memory/memory.md`, раздел 5.

## Хранилища

SQLite и PostgreSQL получают таблицы сами при открытии базы: записи памяти — SQLite `0009`, PostgreSQL `0008`; склейка повторов — SQLite `0010`, PostgreSQL `0009`.
Хранилище в памяти тоже умеет. Своему хранилищу нужны пять необязательных методов `ChatStorage` и общие тесты `describeChatStorageContract`:
`listMemoryNotes`, `insertMemoryNotes`, `updateMemoryNote`, `deleteMemoryNote`, `clearMemoryNotes`. Удаление чата память не трогает.

Для склейки нужны ещё шесть: `claimMemoryOptimizationRun`, `finishMemoryOptimizationRun`, `applyMemoryMerge`, `revertMemoryMerge`, `listMemoryOptimizationRuns`, `listMergedMemoryNotes`.
Без них склейка тихо выключена (или ошибка, если задана опция `optimizer`).

Чтобы пределы держались и при нескольких серверах, у хранилища есть два необязательных метода: `insertMemoryNotesChecked` и `updateMemoryNoteChecked`.
Они зовут проверку внутри своей транзакции (SQLite — транзакция, PostgreSQL — `pg_advisory_xact_lock` на человека). У `revertMemoryMerge` тоже есть необязательная проверка.
Своё хранилище без этих методов работает как раньше, а пределы держит замок внутри одного процесса; при нескольких серверах общий предел тогда не гарантирован.
Правила — `docs/contracts/long-term-memory/memory.md`.
