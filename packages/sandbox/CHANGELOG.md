# @ykurilov/agent-chat-sandbox

## 0.83.0

### Patch Changes

- Updated dependencies [bad76a9]
  - @ykurilov/agent-chat-core@0.83.0
  - @ykurilov/agent-chat-server@0.83.0
  - @ykurilov/agent-chat-react@0.83.0

## 0.82.1

### Patch Changes

- @ykurilov/agent-chat-core@0.82.1
  - @ykurilov/agent-chat-react@0.82.1
  - @ykurilov/agent-chat-server@0.82.1

## 0.82.0

### Patch Changes

- @ykurilov/agent-chat-core@0.82.0
  - @ykurilov/agent-chat-react@0.82.0
  - @ykurilov/agent-chat-server@0.82.0

## 0.81.0

### Patch Changes

- 038b6e2: Исправления аудита клиентской зоны. `useAgentChat` без `key` при смене чата больше не переносит в новый чат дела прежнего: «Стоп», ответ на подтверждение или виджет, передачу поправок и сорвавшуюся голосовую замену; новый чат не остаётся «занятым», повторное открытие того же чата начинается с чистого состояния. Песочница не зовёт хуки приложения, которые пишут данные (`onStateChanged`, `onTurnFinished`, `onModelChosen`), ни в песочном чате, ни в копии чата человека; `newChatGreeting` и `modelMenu` решаются для настоящего админа. Вложения: удаление человеком и чистка брошенных больше не убирают файл, который отправляемое сообщение уже отметило; `confirmUserParts` отказывает `AttachmentRejectedError` (`attachment_not_found` — файла нет или отметка не записана, `attachment_unavailable` — сбой хранилища), а не отмечает молча.
  
  ### Как обновить приложение
  
  Обновите пакеты SDK одной версией. Со встроенными хранилищами вложений (`createDiskAttachmentStorage`, `createMemoryAttachmentStorage`) ничего менять не нужно. Своё хранилище (`AttachmentStorage`, например S3) должно получить метод `removeUnattached(id): Promise<boolean>` — удалить файл, только если он не прикреплён, атомарно с `markAttached` того же файла; `removeUnattachedOlderThan` должен следовать тому же правилу. Без метода `createAttachments` бросает ошибку при запуске. Проверьте хранилище обновлённым `describeAttachmentStorageContract`. Если песочница полагалась на `onStateChanged`, `onTurnFinished` или `onModelChosen` в песочных чатах — в песочнице они больше не зовутся. [Подробности](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/audit-client.md).
- Updated dependencies [038b6e2]
- Updated dependencies [58204d2]
  - @ykurilov/agent-chat-react@0.81.0
  - @ykurilov/agent-chat-core@0.81.0
  - @ykurilov/agent-chat-server@0.81.0

## 0.80.1

### Patch Changes

- Updated dependencies [d59ae4e]
  - @ykurilov/agent-chat-core@0.80.1
  - @ykurilov/agent-chat-server@0.80.1
  - @ykurilov/agent-chat-react@0.80.1

## 0.80.0

### Patch Changes

- Updated dependencies [2cc8429]
  - @ykurilov/agent-chat-core@0.80.0
  - @ykurilov/agent-chat-server@0.80.0
  - @ykurilov/agent-chat-react@0.80.0

## 0.79.1

### Patch Changes

- @ykurilov/agent-chat-core@0.79.1
  - @ykurilov/agent-chat-react@0.79.1
  - @ykurilov/agent-chat-server@0.79.1

## 0.79.0

### Patch Changes

- Updated dependencies [88886de]
  - @ykurilov/agent-chat-core@0.79.0
  - @ykurilov/agent-chat-server@0.79.0
  - @ykurilov/agent-chat-react@0.79.0

## 0.78.0

### Patch Changes

- @ykurilov/agent-chat-core@0.78.0
  - @ykurilov/agent-chat-react@0.78.0
  - @ykurilov/agent-chat-server@0.78.0

## 0.77.0

### Patch Changes

- Updated dependencies [f4c13da]
  - @ykurilov/agent-chat-core@0.77.0
  - @ykurilov/agent-chat-server@0.77.0
  - @ykurilov/agent-chat-react@0.77.0

## 0.76.0

### Patch Changes

- @ykurilov/agent-chat-core@0.76.0
  - @ykurilov/agent-chat-react@0.76.0
  - @ykurilov/agent-chat-server@0.76.0

## 0.75.0

### Patch Changes

- Updated dependencies [dfb9869]
  - @ykurilov/agent-chat-react@0.75.0
  - @ykurilov/agent-chat-core@0.75.0
  - @ykurilov/agent-chat-server@0.75.0

## 0.74.0

### Minor Changes

- 3140c17: Одуванчик получил композицию «Студия» и отдельный вход /sandbox с оформлением песочницы по умолчанию. Чат и журнал прокручиваются независимо; приветствие появляется только в загруженном пустом чате. В договорах скинов добавлены необязательные empty и busy, прежние скины совместимы. История песочницы сохраняет признаки транспорта, поэтому чат без фона не опрашивает несуществующий /tasks.
  
  ### Как обновить приложение
  
  Обновить все пакеты SDK одной версией. Для песочницы импортировать AgentSandbox из @ykurilov/agent-chat-skin-oduvanchik/sandbox, убрать прежние явные скины Тандема и подключить один CSS Одуванчика. У контейнера задать высоту и min-height: 0 у flex/grid-предков. Для сохранения Тандема оставить его импорты, явные скины и CSS. Сервер, доступ и данные не меняются. Подробности: https://github.com/ykurilov/agent-chat-sdk/blob/main/skins/oduvanchik/README.md

### Patch Changes

- Updated dependencies [3140c17]
  - @ykurilov/agent-chat-react@0.74.0
  - @ykurilov/agent-chat-core@0.74.0
  - @ykurilov/agent-chat-server@0.74.0

## 0.73.0

### Patch Changes

- Updated dependencies [34fec8f]
  - @ykurilov/agent-chat-core@0.73.0
  - @ykurilov/agent-chat-server@0.73.0
  - @ykurilov/agent-chat-react@0.73.0

## 0.72.0

### Patch Changes

- @ykurilov/agent-chat-core@0.72.0
  - @ykurilov/agent-chat-react@0.72.0
  - @ykurilov/agent-chat-server@0.72.0

## 0.71.1

### Patch Changes

- Updated dependencies [519914e]
  - @ykurilov/agent-chat-react@0.71.1
  - @ykurilov/agent-chat-core@0.71.1
  - @ykurilov/agent-chat-server@0.71.1

## 0.71.0

### Patch Changes

- Updated dependencies [8b8c651]
  - @ykurilov/agent-chat-core@0.71.0
  - @ykurilov/agent-chat-react@0.71.0
  - @ykurilov/agent-chat-server@0.71.0

## 0.70.1

### Patch Changes

- Updated dependencies [ba86a4a]
  - @ykurilov/agent-chat-core@0.70.1
  - @ykurilov/agent-chat-server@0.70.1
  - @ykurilov/agent-chat-react@0.70.1

## 0.70.0

### Patch Changes

- Updated dependencies [7e54665]
  - @ykurilov/agent-chat-core@0.70.0
  - @ykurilov/agent-chat-server@0.70.0
  - @ykurilov/agent-chat-react@0.70.0

## 0.69.1

### Patch Changes

- Updated dependencies [857777b]
  - @ykurilov/agent-chat-core@0.69.1
  - @ykurilov/agent-chat-server@0.69.1
  - @ykurilov/agent-chat-react@0.69.1

## 0.69.0

### Patch Changes

- Updated dependencies [e6c03dc]
  - @ykurilov/agent-chat-core@0.69.0
  - @ykurilov/agent-chat-server@0.69.0
  - @ykurilov/agent-chat-react@0.69.0

## 0.68.0

### Patch Changes

- @ykurilov/agent-chat-core@0.68.0
  - @ykurilov/agent-chat-react@0.68.0
  - @ykurilov/agent-chat-server@0.68.0

## 0.67.0

### Patch Changes

- @ykurilov/agent-chat-core@0.67.0
  - @ykurilov/agent-chat-react@0.67.0
  - @ykurilov/agent-chat-server@0.67.0

## 0.66.0

### Patch Changes

- Updated dependencies [1d57795]
  - @ykurilov/agent-chat-core@0.66.0
  - @ykurilov/agent-chat-server@0.66.0
  - @ykurilov/agent-chat-react@0.66.0

## 0.65.1

### Patch Changes

- Updated dependencies [ca56c29]
- Updated dependencies [6ccbc87]
  - @ykurilov/agent-chat-core@0.65.1
  - @ykurilov/agent-chat-server@0.65.1
  - @ykurilov/agent-chat-react@0.65.1

## 0.65.0

### Patch Changes

- Updated dependencies [814ee7f]
  - @ykurilov/agent-chat-core@0.65.0
  - @ykurilov/agent-chat-react@0.65.0
  - @ykurilov/agent-chat-server@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [99cded9]
  - @ykurilov/agent-chat-core@0.64.0
  - @ykurilov/agent-chat-react@0.64.0
  - @ykurilov/agent-chat-server@0.64.0

## 0.63.2

### Patch Changes

- Updated dependencies [c772243]
  - @ykurilov/agent-chat-core@0.63.2
  - @ykurilov/agent-chat-server@0.63.2
  - @ykurilov/agent-chat-react@0.63.2

## 0.63.1

### Patch Changes

- Updated dependencies [8bcee93]
  - @ykurilov/agent-chat-react@0.63.1
  - @ykurilov/agent-chat-core@0.63.1
  - @ykurilov/agent-chat-server@0.63.1

## 0.63.0

### Patch Changes

- @ykurilov/agent-chat-core@0.63.0
  - @ykurilov/agent-chat-react@0.63.0
  - @ykurilov/agent-chat-server@0.63.0

## 0.62.0

### Patch Changes

- @ykurilov/agent-chat-core@0.62.0
  - @ykurilov/agent-chat-react@0.62.0
  - @ykurilov/agent-chat-server@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-core@0.61.0
  - @ykurilov/agent-chat-server@0.61.0
  - @ykurilov/agent-chat-react@0.61.0

## 0.60.0

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-core@0.60.0
  - @ykurilov/agent-chat-server@0.60.0
  - @ykurilov/agent-chat-react@0.60.0

## 0.59.0

### Patch Changes

- Updated dependencies [fc1f387]
  - @ykurilov/agent-chat-core@0.59.0
  - @ykurilov/agent-chat-server@0.59.0
  - @ykurilov/agent-chat-react@0.59.0

## 0.58.0

### Patch Changes

- 760962e: Хранилища пакетов на PostgreSQL можно открывать одновременно на совсем пустой базе. Раньше пакеты разом создавали
  схему `agent_chat`, проигравший падал на `CREATE SCHEMA IF NOT EXISTS`, и его хранилище не работало до перезапуска.
  Теперь схема создаётся под общей блокировкой всех пакетов, она держится только на создании схемы. Миграции идут под
  своей блокировкой пакета: разные пакеты друг друга не ждут, взаимной блокировки нет. Столкновение «такое уже есть»
  повторяется само. Новое в core: `migratePostgresSchema({ connect, lockKey, migrate })` — для своих пакетов на той же
  схеме.
  
  ### Как обновить приложение
  
  Ничего делать не нужно.
- Updated dependencies [332d90e]
- Updated dependencies [2ed600d]
- Updated dependencies [760962e]
  - @ykurilov/agent-chat-core@0.58.0
  - @ykurilov/agent-chat-server@0.58.0
  - @ykurilov/agent-chat-react@0.58.0

## 0.57.0

### Patch Changes

- Updated dependencies [ade99cc]
- Updated dependencies [86afa20]
- Updated dependencies [624c10c]
  - @ykurilov/agent-chat-core@0.57.0
  - @ykurilov/agent-chat-server@0.57.0
  - @ykurilov/agent-chat-react@0.57.0

## 0.56.0

### Minor Changes

- 24c313e: Новый пакет `@ykurilov/agent-chat-mcp`: серверы MCP, которые подключает админ приложения.
  
  - `createMcpServers({ store, secretKey, isAdmin, proxy?, spending?, limits?, syncIntervalMs? })` → `mcp.tools(model, appTools?)`
    для `agent.tools` (первым; при одинаковом имени побеждает инструмент приложения), `mcp.admin`, `mcp.reload()`, `mcp.sync()`, `mcp.close()`. «Только админы» — по `model.viewer.isAdmin`;
    `isAdmin` (может быть асинхронной) — для экрана. Правка доходит до всех копий сервера по отметке версии в хранилище. Только удалённые серверы (Streamable HTTP, SSE). Инструменты — из
    сохранённого снимка списка: запрос к модели стабилен, упавший сервер не ломает начало запроса. Соединение — на
    проверенный адрес DNS; заголовки прокси — только на `proxy.origin`.
  - `createMcpAdminHandler({ mcp, resolveUser, allowedOrigins })` — адреса `/api/mcp`, не админу 404.
  - Хранилища: `createMemoryMcpStore`, `/sqlite` `createSqliteMcpStore`, `/postgres` `createPostgresMcpStore`; миграции сами.
  - `/react`: `McpAdmin`, `useMcpAdmin`, договор скина `McpSkin` v1 (с формой правки `McpServerCardView.edit`), надписи ru/en. Скин Тандема: `./mcp` → `tandemMcpSkin`.
  - Ядро: штатный вид расхода `mcp_tool`; `agent.viewer` — права человека раз в начале хода, полем `viewer` в
    `contextBlocks` и `AgentToolsModel`. Песочница: права тестового чата — по владельцу чата. web-tools: наружу `dnsHostResolver`.

### Patch Changes

- Updated dependencies [1eadba9]
- Updated dependencies [24c313e]
  - @ykurilov/agent-chat-react@0.56.0
  - @ykurilov/agent-chat-core@0.56.0
  - @ykurilov/agent-chat-server@0.56.0

## 0.55.0

### Patch Changes

- Updated dependencies [51f7b38]
- Updated dependencies [cdc7dd7]
  - @ykurilov/agent-chat-core@0.55.0
  - @ykurilov/agent-chat-react@0.55.0
  - @ykurilov/agent-chat-server@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [c8fb0dd]
- Updated dependencies [73d3aaa]
- Updated dependencies [fa90219]
  - @ykurilov/agent-chat-react@0.54.0
  - @ykurilov/agent-chat-core@0.54.0
  - @ykurilov/agent-chat-server@0.54.0

## 0.53.0

### Patch Changes

- Updated dependencies [b6a7786]
  - @ykurilov/agent-chat-core@0.53.0
  - @ykurilov/agent-chat-react@0.53.0
  - @ykurilov/agent-chat-server@0.53.0

## 0.52.0

### Patch Changes

- @ykurilov/agent-chat-core@0.52.0
  - @ykurilov/agent-chat-react@0.52.0
  - @ykurilov/agent-chat-server@0.52.0

## 0.51.0

### Patch Changes

- Updated dependencies [41b1726]
  - @ykurilov/agent-chat-core@0.51.0
  - @ykurilov/agent-chat-server@0.51.0
  - @ykurilov/agent-chat-react@0.51.0

## 0.50.0

### Patch Changes

- @ykurilov/agent-chat-core@0.50.0
  - @ykurilov/agent-chat-react@0.50.0
  - @ykurilov/agent-chat-server@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [084cef7]
  - @ykurilov/agent-chat-core@0.49.0
  - @ykurilov/agent-chat-server@0.49.0
  - @ykurilov/agent-chat-react@0.49.0

## 0.48.0

### Patch Changes

- Updated dependencies [fa10d5a]
  - @ykurilov/agent-chat-core@0.48.0
  - @ykurilov/agent-chat-server@0.48.0
  - @ykurilov/agent-chat-react@0.48.0

## 0.47.0

### Patch Changes

- Updated dependencies [5a59c33]
  - @ykurilov/agent-chat-core@0.47.0
  - @ykurilov/agent-chat-server@0.47.0
  - @ykurilov/agent-chat-react@0.47.0

## 0.46.2

### Patch Changes

- Updated dependencies [3d0d2f2]
  - @ykurilov/agent-chat-core@0.46.2
  - @ykurilov/agent-chat-server@0.46.2
  - @ykurilov/agent-chat-react@0.46.2

## 0.46.1

### Patch Changes

- @ykurilov/agent-chat-core@0.46.1
  - @ykurilov/agent-chat-react@0.46.1
  - @ykurilov/agent-chat-server@0.46.1

## 0.46.0

### Patch Changes

- Updated dependencies [56d7528]
- Updated dependencies [a1933fd]
- Updated dependencies [52cc67d]
  - @ykurilov/agent-chat-core@0.46.0
  - @ykurilov/agent-chat-react@0.46.0
  - @ykurilov/agent-chat-server@0.46.0

## 0.45.0

### Patch Changes

- Updated dependencies [eb74c58]
- Updated dependencies [ac9aede]
  - @ykurilov/agent-chat-react@0.45.0
  - @ykurilov/agent-chat-core@0.45.0
  - @ykurilov/agent-chat-server@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [6a2b5d9]
  - @ykurilov/agent-chat-core@0.44.0
  - @ykurilov/agent-chat-react@0.44.0
  - @ykurilov/agent-chat-server@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [763f4c5]
  - @ykurilov/agent-chat-core@0.43.0
  - @ykurilov/agent-chat-server@0.43.0
  - @ykurilov/agent-chat-react@0.43.0

## 0.42.0

### Patch Changes

- Updated dependencies [a385276]
  - @ykurilov/agent-chat-core@0.42.0
  - @ykurilov/agent-chat-server@0.42.0
  - @ykurilov/agent-chat-react@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [9472fcb]
  - @ykurilov/agent-chat-core@0.41.0
  - @ykurilov/agent-chat-react@0.41.0
  - @ykurilov/agent-chat-server@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [0e7aab3]
  - @ykurilov/agent-chat-core@0.40.0
  - @ykurilov/agent-chat-server@0.40.0
  - @ykurilov/agent-chat-react@0.40.0

## 0.39.1

### Patch Changes

- Updated dependencies [5c0f3af]
  - @ykurilov/agent-chat-react@0.39.1
  - @ykurilov/agent-chat-core@0.39.1
  - @ykurilov/agent-chat-server@0.39.1

## 0.39.0

### Patch Changes

- Updated dependencies [3b90429]
  - @ykurilov/agent-chat-core@0.39.0
  - @ykurilov/agent-chat-server@0.39.0
  - @ykurilov/agent-chat-react@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [1cae504]
- Updated dependencies [4065a4a]
  - @ykurilov/agent-chat-core@0.38.0
  - @ykurilov/agent-chat-server@0.38.0
  - @ykurilov/agent-chat-react@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [7f49d12]
- Updated dependencies [ea78982]
  - @ykurilov/agent-chat-core@0.37.0
  - @ykurilov/agent-chat-server@0.37.0
  - @ykurilov/agent-chat-react@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [3487fb4]
- Updated dependencies [8c43b86]
- Updated dependencies [3f39081]
- Updated dependencies [6f42418]
- Updated dependencies [5f13c74]
  - @ykurilov/agent-chat-core@0.36.0
  - @ykurilov/agent-chat-server@0.36.0
  - @ykurilov/agent-chat-react@0.36.0

## 0.35.0

### Minor Changes

- 2382026: **Ломает приложения:** память, сегодняшняя дата и место на экране больше не переезжают в последний вопрос на каждом
  ходе. Они вписываются в вопрос того хода, где их прочитали, и дальше не меняются; набор хода хранится служебной частью
  ответа `data-frozen-context`.
  
  Что изменилось. Раньше блок памяти, дата и место стояли в конце последнего вопроса и на следующем ходе уезжали из него.
  Из-за этого всё после старого вопроса (рассуждения, вызовы инструментов, их результаты) каждый ход читалось заново, мимо
  кэша модели. Теперь блоки застывают там, где их показали, как в Claude Code. Следующий ход побайтно начинается с
  последнего шага прошлого и читает всю переписку из кэша.
  
  - **Изменения — только припиской.** В новый вопрос идут только изменившиеся блоки целиком и одна строка
    `[Больше не действует: «ключ»]` про пропавшие. Ничего не менялось — вопрос без приписки.
  - **Удалённая запись памяти** остаётся в старом вопросе, а в новом модель видит, что она больше не действует.
  - **Запись, не влезшая в лимит памяти** (`maxBlockChars`), не считается удалённой. Модель, которая её уже видела,
    получает строку `[Не показано ради места, но по-прежнему действует: «ключ»]` и находит её поиском. Так может любой
    источник: элемент `{ key, hidden: true }` в списке блоков значит «блок есть, но не показан». Новый тип
    `ContextBlockEntry = ContextBlock | HiddenContextBlock`.
  - **Продолжение хода** (после подтверждения инструмента, автопродолжение, запасной провайдер, «Повторить») берёт блоки
    из ответа и память заново не читает. Инструменты при этом получают свежее место (`model.place`), а модель видит
    застывшее.
  - **Память по записям.** `createLongTermMemory` отдаёт память блоками: шапка `<agent_memory>` (ключ `memory`) и по блоку
    на запись (`memory:<id>`). Правка одной записи стоит одной строки, а не всего блока. Своя память может делать так же
    через необязательный `LongTermMemory.blocks?({ userId, chatId })`; без него — один блок из `snapshot()`, как раньше.
    Обёртка памяти в песочнице пробрасывает `blocks`. Счётчик «Показано агенту: N из M» считает записи, которые уходят
    модели блоками.
  - **Блоки приложения — `agent.contextBlocks`** (новое, по желанию). Приложение отдаёт список `{ key, text, private? }`:
    скиллы, роль, правила. Он вписывается в вопрос после памяти и даты по тем же правилам:
  
    ```ts
    agent: {
      instructions,
      contextBlocks: async ({ chatId, ownerId, chat, audience, abortSignal }) => [
        { key: "skills", text: `Скиллы агента: ${await skillsOf(ownerId, { signal: abortSignal })}` },
      ],
    }
    ```
  
    - Вход: `chatId`, `ownerId`, `messageId`, `chat.data`, `subject`, `channel`, `audience`, `staff`, `modelId`,
      `providerId`, `abortSignal`. Данные и объект чата — копии.
    - `private: true` — блок не показывается в групповом ходе (`audience: "group"`).
    - Ключи `memory`, `memory:*`, `today`, `screen_place` заняты ядром. Такой блок, повтор ключа и пустой текст
      отбрасываются, в `logError` строка `[блоки контекста] … отброшен`.
    - `agent.contextBlocksTimeoutMs` — срок функции, по умолчанию 5000 мс; 0 или `Infinity` — без срока, иначе от 1000.
      Не ответила или бросила — блоки приложения берутся из прошлого ответа чата, в `logError` строка
      `[блоки контекста] … не ответил за N мс`. «Стоп» отменяет функцию сразу, без строки.
    - Новые типы `ContextBlock`, `ContextBlocksInput`, `ContextBlocksSource`, `HiddenContextBlock`, `ContextBlockEntry`.
  - **Кэш шагов у моделей с явными метками** (Claude, Gemini через OpenRouter). Со второго шага хода метка кэша стоит на
    конце шага, до снимка `stepContext` и служебных пометок. Меток в запросе не больше трёх: инструкция, последнее
    сообщение истории, конец шага. У провайдеров с автоматическим кэшем (DeepSeek, Fireworks, Together, GPT напрямую)
    меток нет и запросы без лишних байтов. У Gemini через OpenRouter метка на самом конце запроса не работает (OpenRouter
    её пропускает), поэтому у моделей `google/` она стоит на предпоследнем сообщении: конце прошлого хода или вызове
    инструмента. У Claude через OpenRouter шаги с инструментами теперь пишутся в кэш (запись
    дороже входа на 25%, при `cacheTtl: "1h"` — вдвое), а следующий ход читает их по цене чтения.
  - **Журнал промахов кэша** (`[промах кэша]`) сравнивает первый шаг хода с последним шагом прошлого хода, без его
    концовки (снимок, пометка попытки, пометка «подведи итог»).
  - **Служебная часть `data-frozen-context`** не уходит в поток, историю (`getHistory`), `afterTurn` (`TurnResult.parts`) и
    поиск по истории. Константа — `FROZEN_CONTEXT_PART_TYPE`. Миграций базы нет. Старый чат: первый ход после обновления
    кладёт полный набор блоков в свой вопрос, прошлые вопросы остаются как были.
  
  ### Как обновить приложение
  
  1. Найдите места, где приложение читает ответы прямо из хранилища (`storage.listMessages`, `storage.getMessage`, свой
     SQL по таблице сообщений) и разбирает части ответа: показ, выгрузка, подсчёт, `parts[0]`. Теперь первой частью
     ответа стоит служебная `data-frozen-context`. В ней память человека, дата и место, показывать её нельзя. Пропускайте
     её:
  
     Было:
  
     ```ts
     const parts = message.parts;
     ```
  
     Стало:
  
     ```ts
     import { FROZEN_CONTEXT_PART_TYPE } from "@ykurilov/agent-chat-core";
  
     const parts = message.parts.filter((part) => part.type !== FROZEN_CONTEXT_PART_TYPE);
     ```
  
     `service.getHistory`, поток, `afterTurn` и `@ykurilov/agent-chat-history-search` её уже не отдают: там ничего делать
     не нужно.
  2. Если у приложения есть свои тесты, которые сравнивают запрос к модели или его снимок (где стоит `<agent_memory>`,
     «Сегодня: …», `<screen_place>`), обновите их. Блоки теперь в вопросе того хода, где их прочитали, а не в последнем
     вопросе. Проверьте, что разница в снимке только в этом переносе.
  3. Если приложение подставляло в вопрос свои сведения на каждом ходе (скиллы, роль) через инструкцию или `stepContext`,
     а они меняются редко, перенесите их в `agent.contextBlocks`: кэш модели перестанет сбрасываться. Шаг по желанию.
  4. Своя реализация `LongTermMemory` работает без правок. Если записей много и они часто меняются, добавьте метод
     `blocks({ userId, chatId })`, который возвращает `[{ key: "memory", text: шапка, private: true }, { key: "memory:<id>",
     text: запись, private: true }, …]`. Шаг по желанию.
  5. Проверка. Временно запишите в `afterTurn` расход хода:
  
     ```ts
     afterTurn: ({ messageId, usage }) => console.log("кэш", messageId, usage?.cachedInputTokens, "из", usage?.inputTokens),
     ```
  
     В одном чате с моделью, которая сообщает о кэше (Claude или Gemini через OpenRouter, DeepSeek), задайте вопрос, на
     который агент вызовет инструмент, и через полминуты — второй вопрос. Ожидается: на втором ходе `cachedInputTokens`
     не меньше входа последнего шага первого хода, то есть почти весь вход прочитан из кэша. Строк `[промах кэша]` в
     журнале сервера (`logError`) нет. На экране служебных блоков нет, агент помнит записи памяти.

### Patch Changes

- Updated dependencies [6ceee78]
- Updated dependencies [2382026]
  - @ykurilov/agent-chat-react@0.35.0
  - @ykurilov/agent-chat-server@0.35.0
  - @ykurilov/agent-chat-core@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [d039ce4]
  - @ykurilov/agent-chat-core@0.34.0
  - @ykurilov/agent-chat-server@0.34.0
  - @ykurilov/agent-chat-react@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [4a72339]
  - @ykurilov/agent-chat-core@0.33.0
  - @ykurilov/agent-chat-server@0.33.0
  - @ykurilov/agent-chat-react@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [4087a22]
- Updated dependencies [71c32b7]
- Updated dependencies [cae13bf]
- Updated dependencies [a94bda9]
- Updated dependencies [4e44492]
- Updated dependencies [ac9b7d3]
- Updated dependencies [27f4b1e]
- Updated dependencies [53c41a8]
  - @ykurilov/agent-chat-react@0.32.0
  - @ykurilov/agent-chat-core@0.32.0
  - @ykurilov/agent-chat-server@0.32.0

## 0.31.2

### Patch Changes

- @ykurilov/agent-chat-core@0.31.2
  - @ykurilov/agent-chat-react@0.31.2
  - @ykurilov/agent-chat-server@0.31.2

## 0.31.1

### Patch Changes

- @ykurilov/agent-chat-core@0.31.1
  - @ykurilov/agent-chat-react@0.31.1
  - @ykurilov/agent-chat-server@0.31.1

## 0.31.0

### Patch Changes

- @ykurilov/agent-chat-core@0.31.0
  - @ykurilov/agent-chat-react@0.31.0
  - @ykurilov/agent-chat-server@0.31.0

## 0.30.0

### Patch Changes

- @ykurilov/agent-chat-core@0.30.0
  - @ykurilov/agent-chat-react@0.30.0
  - @ykurilov/agent-chat-server@0.30.0

## 0.29.0

### Patch Changes

- @ykurilov/agent-chat-core@0.29.0
  - @ykurilov/agent-chat-react@0.29.0
  - @ykurilov/agent-chat-server@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [11c3c97]
- Updated dependencies [d63ccaa]
- Updated dependencies [6a2f903]
- Updated dependencies [189cba9]
  - @ykurilov/agent-chat-core@0.28.0
  - @ykurilov/agent-chat-server@0.28.0
  - @ykurilov/agent-chat-react@0.28.0

## 0.27.0

### Minor Changes

- d8341b2: Свои данные чата (`chat.data`) и защита таблиц SQLite. Приложения без новых опций работают как раньше: `subjectData` остался и равен `data`.
  
  - **`chat.data`** — JSON-объект до 16 КБ у любого чата (раньше такие данные были только у чатов объектов). Лежит в том же столбце `subject_data`: миграции нет, старые данные чатов объектов уже читаются как `data`. В браузер и в запрос к модели данные не уходят: кэш модели не меняется.
  - **Новый чат:** `service.createChat(userId, { data })`. Из браузера: `createChatServer({ newChatData: ({ user, request }) => data })` — данные ставит сервер, браузер их не присылает. Вернули не объект — 500. Хранилище без `updateChatData` с `newChatData` — ошибка при создании обработчика; `createChat({ data })` на таком хранилище — та же понятная ошибка, данные молча не теряются.
  - **Правка:** `service.updateChatData(userId, chatId, patch)` — сливает верхние ключи (ключ со значением `undefined` удаляется, `null` остаётся значением). Итог больше 16 КБ — `TypeError`, данные не меняются. Возвращает новые данные. Правка атомарная: две одновременные правки разных ключей не затирают друг друга. Новое значение видно со следующего хода. Верхний ключ `__proto__` в данных, правке и фильтре не принимается (`TypeError`): иначе значение тихо пропало бы при слиянии.
  - **Список:** `service.listChats(userId, { data: { formId: "f1", mode: "test" } })` — чаты, у которых все указанные верхние ключи равны значениям. Значения только строка, число, булево или `null` (иначе `TypeError`); `1` и `"1"` — разные значения. Можно вместе с `subjects`. SQLite ищет через `json_each`, PostgreSQL — через `jsonb @>`.
  - **Кто видит данные:** `beforeTurn` и `chatInstructions` — `chat.data`; инструменты — `model.chat.data` (в том числе при сжатии и у фоновых помощников); `afterTurn` — `turn.chatData` (данные на момент итога: правка посреди хода видна, и итог после перезапуска даёт то же). `chatCapabilities`, проверка виджета и `stepContext` получают `Chat` и тоже видят `data`.
  - **Событие `chat-data-changed { ownerId, chatId }`** (без данных) для `onChatEvent`. Вкладке браузера оно не пересылается.
  - **Своё хранилище:** добавьте необязательный метод `updateChatData(chatId, patch, { maxBytes })` (одна атомарная операция, возвращает чат или `null`; больше предела — `ChatDataTooLargeError`), `listChats(ownerId, { subjects?, data? })` и запись/чтение `data` (у старого кода — `subjectData`). Без `updateChatData` служба отвечает понятной ошибкой на `updateChatData` и `listChats({ data })`. Проверка — `describeChatStorageContract(…, { chatData: "required" })`.
  - **Песочница:** в копии чата человека инструменты и `afterTurn` видят данные исходного чата, а не служебную обёртку копии; это верно и для обычного чата без ключа объекта (`subject` у него по-прежнему нет).
  - **SQLite: защита от чужих таблиц.** Таблицы SDK не переименованы: SDK должен жить в своём файле. При открытии, до миграций, SDK смотрит, нет ли в файле чужих `chats` или `messages` (журнал миграций SDK не знает их). Тогда `createSqliteChatStorage` бросает `ForeignChatTablesError` с текстом «дайте SDK отдельный файл», файл не тронут. Если у приложения свои `chats`/`messages` в том же файле — укажите SDK другой `filePath`. Раздел «Где лежат данные SDK» — в README хранилищ.
- 5e4ed28: **Что может сломаться:**
  
  - исчерпывающий `switch` по виду ошибки сервера (`HandlerErrorKind`) и виду отказа на экране (`AppRefusalKind`): новые значения `action_forbidden`, `chat_closed`, `chat_creation_refused`;
  - исчерпывающий `switch` по причине `turnNotStarted` (`TurnNotStartedReason`): новое значение `chat_closed`;
  - свой словарь надписей `ChatLabels`, собранный целиком: новое обязательное поле `chatListClosed`.
  
  Права человека в чате и закрытый чат. Приложение функцией `chatCapabilities` решает, что можно человеку: правка, «Переделать», «Повторить», ветки, выбор модели, правка ответа, список чатов, сжатие, файлы, голос. Чат можно закрыть из инструмента (`model.closeChat`) или из кода (`service.closeChat`, `reopenChat`): переписка видна, писать дальше нельзя. Хук `beforeCreateChat` решает, можно ли человеку завести новый чат. Без новых настроек всё работает как раньше. Подробно — [docs/in-product-agent.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/in-product-agent.md), разделы 9, 10 и 11.
  
  - Права: опечатка в названии права (`edits` вместо `edit`) — ошибка приложения (`TypeError`), а не молчаливый доступ. За один вызов службы права спрашиваются не больше раза.
  - Закрытие побеждает паузу: если чат закрыт, пока ответ ждёт подтверждения или виджета, ждущие запросы закрываются отказом, как при «Стопе», и ответ считается законченным.
  - Закрытие из инструмента записывается сразу при вызове: после падения сервера чат уже закрыт. Чат, закрытый во время проверки перед ходом, хода не начинает: 409 `chat_closed`, резерв приложения закрывается `turnNotStarted` с причиной `chat_closed`.
  - Новый чат: `beforeCreateChat({ userId, origin? })` вернул `{ code, message }` — `POST {base}` отвечает `403 { error: { kind: "chat_creation_refused", code, message } }`, мессенджер (`/new`, первый чат) — текстом. Чаты объектов и импорт хук не спрашивают.
  - `listChats` отдаёт `closed`: на экране и в `/chats` мессенджера у закрытого чата пометка.
  - Сервер: запрещённое действие — `403 { error: { kind: "action_forbidden", action, code, message } }`, закрытый чат — `409 { error: { kind: "chat_closed", code, message } }`. Мессенджеры отвечают человеку текстом.
  - Мессенджеры: голосовое при `voice: false` и файлы при `attachments: false` не скачиваются и не распознаются, `/chats` смотрит на `chatList`. Своя служба может реализовать необязательный `assertCapability`.
  - Песочница: закрытие работает как в бою, а кнопка «Открыть чат снова» (`POST {sandboxBase}/chats/:chatId/reopen`, только админ) позволяет продолжить тест. Скину песочницы — необязательный `SandboxSkin.ChatReopen`, надписи `SandboxLabels.chatReopen` (необязательные); в Тандеме кнопка своя.
  - Экран: кнопки по правам прячутся сами, после ответа 403 `action_forbidden` права перечитываются, закрытый чат блокирует поле и показывает текст закрытия. Голосовое сообщение при `voice: false` не уходит. Новое:
    - `AppRefusalKind` — `chat_creation_refused`; `useChatList` — `onCreateRefused` и `creationRefusal`, `ChatWorkspace` отдаёт отказ в `onTurnRefused`;
    - `ChatListEntry.closed` и `ChatListItemView.closed` — пометка закрытого чата в списке, надпись `chatListClosed` («Закрыт», обязательное поле `ChatLabels`);
    - `reloadKey` у `AgentChat`, `useAgentChat` и `ChatWorkspace` — перечитать историю, когда чат изменили не через экран;
    - `onChatUnavailable` у `AgentChat` — служебный колбэк для `ChatWorkspace`, приложению не нужен;
    - `ChatWorkspace` при `chatList: false` не мигает списком: он появляется после первой истории (и при `chatList: true` — тоже с этой короткой задержкой) и потом не запрашивается;
    - `onTurnRefused` получает новые виды отказов, `onChatAccessChange` сообщает права и закрытие, `ChatWorkspace` при `chatList: false` показывает только чат.
  - Скин: договор v20 — необязательный `ChatClosedNotice` и необязательный `list` у `ChatListSkin.ChatWorkspace` ([docs/skin-v20.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/skin-v20.md)). Скин v19 работает без правок. В Тандеме — `TandemChatClosedNotice`.
  - Хранилища: колонка `closed` у чатов, миграция SQLite и PostgreSQL применяется сама. Своё хранилище может реализовать необязательный `setChatClosed(chatId, closed | null)` и отдавать `closed` в `getChat`; общий тест — `describeChatStorageContract(…, { chatClosure: "required" })`.
  
  ### Как обновить приложение
  
  1. Найдите в коде приложения исчерпывающие `switch` по виду ошибки сервера чата, по `refusal.kind` из `onTurnRefused` и по `reason` в `turnNotStarted`. Искать: `kind: "turn_refused"`, `case "turn_refused"`, `case "access_refused"`, `HandlerErrorKind`, `AppRefusalKind`, `TurnNotStartedReason`, `case "busy"`.
  2. Добавьте ветки для новых видов:
  
     Было:
  
     ```ts
     switch (refusal.kind) {
       case "turn_refused": return showLessonClosed(refusal.message);
       case "access_refused": return showNoAccess(refusal.message);
       default: { const never: never = refusal.kind; return never; }
     }
     ```
  
     Стало:
  
     ```ts
     switch (refusal.kind) {
       case "turn_refused": return showLessonClosed(refusal.message);
       case "access_refused": return showNoAccess(refusal.message);
       case "chat_closed":
       case "action_forbidden": return; // чат уже показал текст сам
       case "chat_creation_refused": return showToast(refusal.message);
       default: { const never: never = refusal.kind; return never; }
     }
     ```
  
     В `switch` по `reason` в `turnNotStarted` добавьте `case "chat_closed":` рядом с `case "busy":`: резерв снимается так же.
  
  3. Свой словарь `ChatLabels`, собранный целиком (не поверх `russianChatLabels`): добавьте `chatListClosed: "Закрыт"`.
  4. Своё хранилище чата (не SQLite и не PostgreSQL из SDK): если нужен закрытый чат, реализуйте `setChatClosed` и отдавайте `closed` в `getChat`. Без этого `closeChat` бросает ошибку, а инструменты не получают `model.closeChat`.
  5. Проверка: `pnpm typecheck` проходит, чат открывается и отвечает.
  
  Заметка к 0.28: закрытие станет записью хода, и правка, «Переделать» и ветки в закрытом чате станут возможны. Чтобы сохранить нынешнее поведение, задайте права: `chatCapabilities: ({ chat }) => chat.closed ? { edit: false, regenerate: false, branches: false } : {}`.

### Patch Changes

- Updated dependencies [d8341b2]
- Updated dependencies [5e4ed28]
- Updated dependencies [e0bb519]
  - @ykurilov/agent-chat-core@0.27.0
  - @ykurilov/agent-chat-server@0.27.0
  - @ykurilov/agent-chat-react@0.27.0

## 0.26.2

### Patch Changes

- Updated dependencies [f24858a]
  - @ykurilov/agent-chat-core@0.26.2
  - @ykurilov/agent-chat-server@0.26.2
  - @ykurilov/agent-chat-react@0.26.2

## 0.26.1

### Patch Changes

- Updated dependencies [5b52515]
  - @ykurilov/agent-chat-react@0.26.1
  - @ykurilov/agent-chat-core@0.26.1
  - @ykurilov/agent-chat-server@0.26.1

## 0.26.0

### Minor Changes

- eb43e47: Пределы хода и честная остановка сервера. Без новых опций запрос к модели прежний. Поменялось одно: `flush()` теперь
  закрывает идущие ответы как «Стоп», а не оставляет их «идущими» до следующего старта.
  
  - **Общий срок хода** — `agent.turnTimeoutMs`: число мс или `{ default?, byModel? }`. Срок вышел — ход останавливается,
    как по «Стопу»: написанное цело, `status: "stopped"`, а `afterTurn` получает `stopReason: "timeout"`. «Стоп» человека —
    `stopReason: "user"`, остановка сервера — `"shutdown"`. 0 или `Infinity` — без срока. Иначе от 1000 до 2³¹−1. Модель из
    `byModel`, которой нет в каталоге, — ошибка при создании службы. Не задано — без срока. Срок считается до записи итога:
    `afterTurn` записанного ответа он не обрывает.
  - **Предел токенов ответа** — `agent.maxOutputTokens`: целое от 1 или `{ default?, byModel? }`. Уходит провайдеру в каждом
    запросе к модели (в каждом шаге хода). Ответ упёрся — `afterTurn` получает `lengthCut: true`. Не задано — предела в
    запросе нет, кэш модели не меняется.
  - **`turnNotStarted`** — новый хук службы и `createChatHandler`: `({ userId, chat, action, messageId?, text?, reason })`. Он
    зовётся, когда `beforeTurn` пропустил ход, а ход не начался. Причины: `busy`, `too_many_turns`, `spending_limit`,
    `duplicate_message`, `invalid`, `no_turn`, `error`. Каждый пропуск `beforeTurn` закрывается ровно одним: `afterTurn`
    начатого хода или `turnNotStarted`. Так резерв приложения больше не повисает. Ответ клиенту прежний (409, 429…), бросок
    хука уходит в `logError`. Порядок проверок прежний: отказ приложения (403) по-прежнему приходит раньше «занято» (409).
  - **`beforeTurn` получает `messageId`** — id сообщения человека у `send` и `edit`.
  - **`flush({ waitForAnswersMs })`** у службы, `createChatHandler` и песочницы. Пока идёт остановка, новые ходы не
    начинаются: чат занят. Идущие ответы ждутся до срока (по умолчанию 0). Не успевшие закрываются как «Стоп»: написанное
    записывается, обрывков нет, `afterTurn` видит `stopReason: "shutdown"`. `flush` возвращается, когда все ответы записаны и
    хуки `afterTurn` (в своём сроке), сжатие, память и фон закончены. Только после этого можно закрывать хранилище. Неверный
    срок — `TypeError`. Остановленный ход, который за 10 с так и не записал итог (база висит), `flush` больше не ждёт:
    строка в `logError`, ответ прервёт восстановление при следующем старте. Не прошла конечная запись — ответ помечен
    брошенным, и любая копия прерывает его сразу, без ожидания порога.
  - Новые типы: `TurnTimeoutSetting`, `MaxOutputTokensSetting`, `TurnNotStartedHandler`, `TurnNotStartedReason`,
    `TurnStopReason`, `FlushOptions`. В `TurnResult` — `stopReason?`, `lengthCut?`.
  
  ### Как обновить приложение
  
  1. Остановка сервера (обработчик `SIGTERM`, где зовётся `chat.flush()`): дайте ответам доработать.
  
     Было:
  
     ```ts
     server.close();
     await chat.flush();
     await storage.close();
     ```
  
     Стало:
  
     ```ts
     server.close();
     await chat.flush({ waitForAnswersMs: 20_000 }); // ждёт ответы и afterTurn; не успевшие — «Стоп» с записью
     await storage.close();
     ```
  
     Без опций `flush()` тоже работает, но идущие ответы останавливаются сразу (`status: "stopped"`, раньше они становились
     `interrupted` при следующем старте). Если приложение ждало `interrupted` после остановки, ждите `stopped` со
     `stopReason: "shutdown"`.
  2. Если `beforeTurn` резервирует что-то (попытку, деньги), снимайте резерв в `turnNotStarted`. Связать резерв с ходом
     удобно по `messageId`:
  
     ```ts
     beforeTurn: async ({ userId, messageId }) => { await reserveAttempt(userId, messageId); },
     turnNotStarted: async ({ userId, messageId }) => { await releaseAttempt(userId, messageId); },
     ```
  3. По желанию задайте пределы хода в `agent`:
  
     ```ts
     agent: { turnTimeoutMs: 180_000, maxOutputTokens: { default: 4_000, byModel: { "deepseek-4.1-flash": 2_000 } } },
     ```
  
     В `afterTurn` отличайте `stopReason` (`user` / `timeout` / `shutdown`) и `lengthCut`.
  4. Проверка: `pnpm typecheck` проходит. Остановите сервер посреди ответа: в базе ответ `stopped`, а `afterTurn` получил
     `stopReason: "shutdown"`.

### Patch Changes

- Updated dependencies [eb43e47]
  - @ykurilov/agent-chat-core@0.26.0
  - @ykurilov/agent-chat-server@0.26.0
  - @ykurilov/agent-chat-react@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [99d426e]
- Updated dependencies [d8201f6]
  - @ykurilov/agent-chat-core@0.25.0
  - @ykurilov/agent-chat-server@0.25.0
  - @ykurilov/agent-chat-react@0.25.0

## 0.24.0

### Minor Changes

- 9b895cd: Ломает приложения: только исчерпывающие `switch` по видам ошибок сервера и событиям чата (новые значения) и код, который
  сам читает ответ `resolveUser`. Без новых настроек поведение прежнее.
  
  Агент внутри продукта: агент работает с объектами приложения — уроком, заказом, документом. Всё по желанию; без новых
  настроек запрос к модели не меняется ни на байт. Подробно — `docs/in-product-agent.md`.
  
  - **Проверка перед ходом.** `beforeTurn({ userId, chat, action, text? })` отказывает своими словами: 403 `turn_refused`
    до любых записей и лимитов, на отправке, правке, повторе, переделке, подтверждении, виджете, служебных сообщениях, фоновой
    задаче и в мессенджерах. `resolveUser` может вернуть `{ refused: { code, message, status? } }` → `access_refused` на всех
    адресах чата, голоса, голосового режима (WebSocket 4401) и мессенджеров. React: `onTurnRefused`, текст отказа вместо «нет
    связи», сообщение возвращается в поле. Ручная проверка — `service.assertTurnAllowed`.
  - **Итог хода.** `afterTurn(turn)` после каждого хода с повторами и сроком (`afterTurnAttempts`, `afterTurnTimeoutMs`),
    переживает перезапуск сервера. `TurnResult`: владелец и автор хода, текст, части, расход, действие, канал, объект,
    сотрудник. События приложения `{ type, data? }` — из хука, из инструмента (`model.emitAppEvent`) и вне хода
    (`service.publishAppEvent`); в React `appEvents` и `onAppEvent`, события переживают перезагрузку. Модели не уходят.
  - **Чат объекта.** Ключ и данные объекта у чата, один чат на ключ у человека: `service.openSubjectChat`, на сервере
    `subjectChats` (`POST …/subject`), в React `<AgentChat subject="lesson:42" />`. Данные объекта видят `beforeTurn`,
    инструменты (`model.subject`) и `afterTurn`; в браузер и модели не уходят.
  - **Приветствие.** `greeting: { text }` — первое сообщение от агента без вызова модели. Проверено на всех моделях каталога.
  - **Лимит сообщений.** Окно лимитов с `limitMessages` вместо `limitUsd`, `exemptUsers` — люди без лимитов,
    `onMessageThreshold` — пороги. Отказ — 429 с `unit: "messages"`.
  - **Импорт старой переписки.** `service.importChat({ ownerId, chat, messages })` с датами и картинками
    (`attachments.importFile`), без хода, памяти, расхода и лимитов.
  - **Сотрудник проверяет чат человека.** Песочница с опцией `people`: админ видит чаты человека только на чтение и
    проверяет ответы в копии у себя. Память человека в копии только читается, расход — на админа, человек ничего не видит.
    Инструменты приложения получают `model.staff` и в копии в данные человека не пишут.
  - **Свои кнопки у поля ввода.** `composerActions` с помощником `{ value, setValue, send, addFiles, busy, blocked, canSend }`.
    Договор скина v19: `Composer.actions`; скин v18 работает без кнопок, Тандем готов.
  - **Хранилища.** Миграции применяются сами: SQLite `0015`, PostgreSQL `0014` (ключ объекта, состояние хука итога).
  
  ### Что может сломаться
  
  - **Исчерпывающие `switch` по закрытым спискам.** Новые значения: вид ошибки сервера `turn_refused` и `access_refused`
    (`HandlerErrorKind`), события чата `after-turn-failed` и `app-event` (`ChatEvent`), `unit` у отказа лимита. Добавьте ветки
    и надписи.
  - **Список чатов без чатов объектов.** `listChats` и `GET {basePath}` по умолчанию не показывают чаты с ключом объекта.
    Касается только приложений, которые начнут ими пользоваться; показать — `chatList: { subjectChats: true }` или
    `listChats(userId, { subjects: "include" })`.
  - **Свой `resolveUser` в обёртках.** Тип ответа — `ResolvedUser` (`{ id } | { refused } | null`). Код, который сам вызывает
    `resolveUser` и читает `.id`, сначала проверяет `"refused" in user`.
  - **Своё хранилище.** Для новых возможностей нужны необязательные методы (`findChatBySubject`, `importChat`,
    `setAfterTurnState`, `listPendingAfterTurn`); без них эти возможности при включении дают ошибку при старте, остальное
    работает. `listChats(ownerId, options?)` получил второй параметр — чаты с ключом скрывать по умолчанию.
  - **Свой `ChatService`** (заглушки в тестах) добавляет новые методы: `openSubjectChat`, `importChat`, `assertTurnAllowed`, `peekHistory`,
    `publishAppEvent`.
  - **Своя реализация `SpendingLimits`** может добавить `takeMessage` — без него сообщения не считаются.
  - **`AgentChat`: `chatId` стал необязательным** — нужен ровно один из `chatId` и `subject`; ни одного или оба — ошибка при
    рендере. При смене `chatId` чат пересоздаётся: черновик и состояние прошлого чата не переносятся.
  - **Окна лимитов: `limitUsd` стал необязательным** (у окна сообщений его нет). Код, который читает свои окна, проверяет
    `limitMessages`.
  - **Отказ сервера в React** (`ServerRefusal`) получил `kind` и `code`. 401 со словами приложения (`access_refused`) — это
    отказ, а не «вход истёк».
  - **«Пустой чат»** для «Нового чата»: чат объекта пустым не считается, обычный чат с одним приветствием — считается.
  - Новый подпуть `@ykurilov/agent-chat-core/access` — помощники отказа в доступе для своих обработчиков.
  
  ### Как обновить приложение
  
  1. `pnpm up "@ykurilov/agent-chat-*@^0.24.0"`. Миграции базы применяются сами при открытии хранилища.
  2. Исчерпывающие `switch` по `HandlerErrorKind` (сервер) и `ChatEvent` (`chatEvents` ядра): найдите их поиском и добавьте
     ветки `turn_refused`, `access_refused`, `after-turn-failed`, `app-event`. Обязательных надписей не прибавилось: текст
     отказа приходит с сервера. Свой словарь для лимита сообщений — необязательные `spendingMessagesLeft`,
     `spendingMessagesExhausted`, `editMessageLimit`.
  
     Было: `switch (event.type) { case "tasks-changed": … case "notice-added": … default: assertNever(event) }`
     Стало: те же ветки плюс `case "after-turn-failed": case "app-event": break;`
  3. Свой код, который сам зовёт `resolveUser` и читает `.id`: сначала `if (user && "refused" in user) …`.
  4. Ничего больше не нужно, если новые возможности не включать. Чтобы включить — `docs/in-product-agent.md`.
  5. Свой скин: кнопки у поля появятся, когда `Composer` начнёт рисовать `actions` (договор v19, `docs/skin-v19.md`).
  6. Проверка: `pnpm typecheck` без ошибок, чат открывается и отвечает как раньше.

### Patch Changes

- Updated dependencies [9b895cd]
  - @ykurilov/agent-chat-core@0.24.0
  - @ykurilov/agent-chat-server@0.24.0
  - @ykurilov/agent-chat-react@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [30fb729]
  - @ykurilov/agent-chat-react@0.23.0
  - @ykurilov/agent-chat-core@0.23.0
  - @ykurilov/agent-chat-server@0.23.0

## 0.22.0

### Patch Changes

- @ykurilov/agent-chat-core@0.22.0
  - @ykurilov/agent-chat-react@0.22.0
  - @ykurilov/agent-chat-server@0.22.0

## 0.21.0

### Patch Changes

- Updated dependencies [7c3bcc4]
  - @ykurilov/agent-chat-core@0.21.0
  - @ykurilov/agent-chat-server@0.21.0
  - @ykurilov/agent-chat-react@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [fd16b01]
- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-core@0.20.0
  - @ykurilov/agent-chat-server@0.20.0
  - @ykurilov/agent-chat-react@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [fde2297]
- Updated dependencies [aa0fd51]
- Updated dependencies [6f26b93]
- Updated dependencies [9f94dbe]
- Updated dependencies [2013f15]
- Updated dependencies [aa0fd51]
- Updated dependencies [05e258b]
- Updated dependencies [aa0fd51]
  - @ykurilov/agent-chat-core@0.19.0
  - @ykurilov/agent-chat-server@0.19.0
  - @ykurilov/agent-chat-react@0.19.0

## 0.18.6

### Patch Changes

- @ykurilov/agent-chat-core@0.18.6
  - @ykurilov/agent-chat-react@0.18.6
  - @ykurilov/agent-chat-server@0.18.6

## 0.18.5

### Patch Changes

- Updated dependencies [56b9ab6]
  - @ykurilov/agent-chat-react@0.18.5
  - @ykurilov/agent-chat-core@0.18.5
  - @ykurilov/agent-chat-server@0.18.5

## 0.18.4

### Patch Changes

- 8b1343d: Журнал песочницы на PostgreSQL пишет куски обращения к модели одним запросом. Раньше в длинном чате каждый кусок истории уходил в базу отдельным запросом: 100 сообщений — около 100 походов к базе на одну запись журнала. Теперь запись — горстка запросов при любой длине чата. Приложению ничего делать не нужно.
- @ykurilov/agent-chat-core@0.18.4
  - @ykurilov/agent-chat-react@0.18.4
  - @ykurilov/agent-chat-server@0.18.4

## 0.18.3

### Patch Changes

- Updated dependencies [ce3c26f]
  - @ykurilov/agent-chat-react@0.18.3
  - @ykurilov/agent-chat-core@0.18.3
  - @ykurilov/agent-chat-server@0.18.3

## 0.18.2

### Patch Changes

- Updated dependencies [7e7e966]
  - @ykurilov/agent-chat-react@0.18.2
  - @ykurilov/agent-chat-core@0.18.2
  - @ykurilov/agent-chat-server@0.18.2

## 0.18.1

### Patch Changes

- Updated dependencies [179ad9d]
  - @ykurilov/agent-chat-react@0.18.1
  - @ykurilov/agent-chat-core@0.18.1
  - @ykurilov/agent-chat-server@0.18.1

## 0.18.0

### Minor Changes

- 43d7ebe: Песочница агента для админа: новый пакет `@ykurilov/agent-chat-sandbox`. Админ говорит с боевым агентом и видит журнал:
  каждое обращение к модели (что ушло, что пришло, токены, кэш, цена) и каждый вызов инструмента. Любое сообщение можно
  поправить (текст и результаты обычных инструментов), правка создаёт ветку. Модель и системная инструкция меняются для одного
  чата, боевые не трогаются. Память в песочнице только на чтение.
  
  - сервер: `createSandboxHandler({ chat, isAdmin, journal })`, журнал `createSqliteSandboxJournal` (`/sqlite`) или
    `createPostgresSandboxJournal` (`/postgres`, схема `agent_chat`), хранится 30 дней; не админ получает 404 на любом адресе;
  - страница: `AgentSandbox` из `@ykurilov/agent-chat-sandbox/react`, готовый скин `tandemSandboxSkin`;
  - `createChatServer` — новый экспорт server (на нём стоят и боевой, и песочный обработчик);
  - core: `turnObserver`, `chatInstructions`, `lockedToolOutputs`, `editAnswer`; боевой запрос к модели остаётся прежним побайтно;
  - договор скина чата версии 15: необязательные `AgentMessage.onEdit/edited` и `ToolCallRow.outputEdited`; новые надписи
    `answerEdited`, `toolOutputEdited`, `editAnswer`; договор скина песочницы `SandboxSkin` версии 1.
  
  Подробно: `docs/sandbox.md`.
  
  ### Как обновить приложение
  
  Обычному приложению делать ничего не нужно: песочница включается отдельно, миграций боевой базы нет (таблицы `sandbox_*` создаёт
  сам журнал).
  
  1. Полный словарь надписей, написанный вручную без `{ ...russianLabels }`, — добавьте `answerEdited`, `toolOutputEdited`, `editAnswer`.
  2. Свой скин версии 14 работает без правок; чтобы показать «изменено» и кнопку правки, реализуйте необязательные части версии 15.
  3. Своя реализация сервера поверх `createChatHandler` продолжает работать; для песочницы возьмите `createChatServer`.
  4. Проверка: `pnpm typecheck`, затем в чате отправить сообщение и получить ответ.

### Patch Changes

- Updated dependencies [43d7ebe]
  - @ykurilov/agent-chat-core@0.18.0
  - @ykurilov/agent-chat-server@0.18.0
  - @ykurilov/agent-chat-react@0.18.0
