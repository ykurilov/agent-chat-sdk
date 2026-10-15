# @ykurilov/agent-chat-mcp

## 0.63.0

### Patch Changes

- @ykurilov/agent-chat-core@0.63.0
  - @ykurilov/agent-chat-web-tools@0.63.0

## 0.62.0

### Patch Changes

- @ykurilov/agent-chat-core@0.62.0
  - @ykurilov/agent-chat-web-tools@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-core@0.61.0
  - @ykurilov/agent-chat-web-tools@0.61.0

## 0.60.0

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-core@0.60.0
  - @ykurilov/agent-chat-web-tools@0.60.0

## 0.59.0

### Patch Changes

- Updated dependencies [fc1f387]
  - @ykurilov/agent-chat-core@0.59.0
  - @ykurilov/agent-chat-web-tools@0.59.0

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
  - @ykurilov/agent-chat-web-tools@0.58.0

## 0.57.0

### Patch Changes

- Updated dependencies [ade99cc]
- Updated dependencies [86afa20]
- Updated dependencies [624c10c]
  - @ykurilov/agent-chat-core@0.57.0
  - @ykurilov/agent-chat-web-tools@0.57.0

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

- Updated dependencies [24c313e]
  - @ykurilov/agent-chat-core@0.56.0
  - @ykurilov/agent-chat-web-tools@0.56.0
