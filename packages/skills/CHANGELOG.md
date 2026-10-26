# @ykurilov/agent-chat-skills

## 0.85.0

### Patch Changes

- Updated dependencies [1f7a921]
  - @ykurilov/agent-chat-core@0.85.0

## 0.84.0

### Patch Changes

- Updated dependencies [5e90be0]
  - @ykurilov/agent-chat-core@0.84.0

## 0.83.3

### Patch Changes

- @ykurilov/agent-chat-core@0.83.3

## 0.83.2

### Patch Changes

- Updated dependencies [f63dea9]
  - @ykurilov/agent-chat-core@0.83.2

## 0.83.1

### Patch Changes

- @ykurilov/agent-chat-core@0.83.1

## 0.83.0

### Patch Changes

- Updated dependencies [bad76a9]
  - @ykurilov/agent-chat-core@0.83.0

## 0.82.1

### Patch Changes

- @ykurilov/agent-chat-core@0.82.1

## 0.82.0

### Patch Changes

- @ykurilov/agent-chat-core@0.82.0

## 0.81.0

### Patch Changes

- Updated dependencies [58204d2]
  - @ykurilov/agent-chat-core@0.81.0

## 0.80.1

### Patch Changes

- Updated dependencies [d59ae4e]
  - @ykurilov/agent-chat-core@0.80.1

## 0.80.0

### Patch Changes

- Updated dependencies [2cc8429]
  - @ykurilov/agent-chat-core@0.80.0

## 0.79.1

### Patch Changes

- @ykurilov/agent-chat-core@0.79.1

## 0.79.0

### Patch Changes

- Updated dependencies [88886de]
  - @ykurilov/agent-chat-core@0.79.0

## 0.78.0

### Patch Changes

- @ykurilov/agent-chat-core@0.78.0

## 0.77.0

### Patch Changes

- Updated dependencies [f4c13da]
  - @ykurilov/agent-chat-core@0.77.0

## 0.76.0

### Patch Changes

- @ykurilov/agent-chat-core@0.76.0

## 0.75.0

### Patch Changes

- @ykurilov/agent-chat-core@0.75.0

## 0.74.0

### Patch Changes

- @ykurilov/agent-chat-core@0.74.0

## 0.73.0

### Patch Changes

- Updated dependencies [34fec8f]
  - @ykurilov/agent-chat-core@0.73.0

## 0.72.0

### Patch Changes

- @ykurilov/agent-chat-core@0.72.0

## 0.71.1

### Patch Changes

- @ykurilov/agent-chat-core@0.71.1

## 0.71.0

### Patch Changes

- Updated dependencies [8b8c651]
  - @ykurilov/agent-chat-core@0.71.0

## 0.70.1

### Patch Changes

- Updated dependencies [ba86a4a]
  - @ykurilov/agent-chat-core@0.70.1

## 0.70.0

### Patch Changes

- Updated dependencies [7e54665]
  - @ykurilov/agent-chat-core@0.70.0

## 0.69.1

### Patch Changes

- Updated dependencies [857777b]
  - @ykurilov/agent-chat-core@0.69.1

## 0.69.0

### Minor Changes

- e6c03dc: Значки шагов и заголовки раздумий (106): в простом виде — ряд значков у «Сделано N шагов» и список «значок + фраза» (`StepIcon`, `icon` в `stepPhrases`, `guessStepIcon`); `thoughtTitles` у службы чата — заголовок раздумья от провайдера или пересказ дешёвой моделью в фоне, хранится в части раздумья, в запрос основной модели не идёт, расход `thought_title`; договор скина 28 (`WorkStepsView.live.icon`, `done.items`, `icons`, `moreIcons`, `Reasoning.title`); фраза навыка с именем.

### Patch Changes

- Updated dependencies [e6c03dc]
  - @ykurilov/agent-chat-core@0.69.0

## 0.68.0

### Patch Changes

- @ykurilov/agent-chat-core@0.68.0

## 0.67.0

### Patch Changes

- @ykurilov/agent-chat-core@0.67.0

## 0.66.0

### Patch Changes

- Updated dependencies [1d57795]
  - @ykurilov/agent-chat-core@0.66.0

## 0.65.1

### Patch Changes

- Updated dependencies [ca56c29]
  - @ykurilov/agent-chat-core@0.65.1

## 0.65.0

### Patch Changes

- Updated dependencies [814ee7f]
  - @ykurilov/agent-chat-core@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [99cded9]
  - @ykurilov/agent-chat-core@0.64.0

## 0.63.2

### Patch Changes

- Updated dependencies [c772243]
  - @ykurilov/agent-chat-core@0.63.2

## 0.63.1

### Patch Changes

- @ykurilov/agent-chat-core@0.63.1

## 0.63.0

### Patch Changes

- @ykurilov/agent-chat-core@0.63.0

## 0.62.0

### Patch Changes

- @ykurilov/agent-chat-core@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-core@0.61.0

## 0.60.0

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-core@0.60.0

## 0.59.0

### Minor Changes

- fc1f387: Поддельные служебные блоки в ответе модели вырезаются сами. Один список форматов: ядро (`CORE_SERVICE_BLOCKS` — сводка, шаги ответа, место на экране, служебные пометки), пакеты (память `<agent_memory>`, вложения `<attachment>`, навыки `<skill>` и их список, строки сценария) и приложение — `agent.serviceBlocks` (`{ tag }` или `{ name, line, match?, until? }`, ошибка — `TypeError` при создании службы). Блок с начала строки вырезается в потоке до экрана, записи и следующего шага; в прошлых ответах — только в запросе, байт в байт одинаково (кэш). Код, цитаты и упоминания посреди фразы не трогаются, пустым ответ не остаётся. Журнал: `[служебный блок вырезан] тег=… чат=… ответ=… модель=… провайдер=…`.
  
  ### Как обновить приложение
  
  Ничего делать не нужно. Своя вырезка служебных блоков в приложении больше не нужна — свои теги передайте в `agent.serviceBlocks`.

### Patch Changes

- Updated dependencies [fc1f387]
  - @ykurilov/agent-chat-core@0.59.0

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

## 0.57.0

### Patch Changes

- Updated dependencies [ade99cc]
- Updated dependencies [86afa20]
- Updated dependencies [624c10c]
  - @ykurilov/agent-chat-core@0.57.0

## 0.56.0

### Minor Changes

- 949d3b2: Навыки агента: новый пакет `@ykurilov/agent-chat-skills` (список включённых навыков в блоке контекста, загрузка указаний
  инструментом `use_skill`, версии, учёт загрузок, API и экран для админа) и скин экрана `@ykurilov/agent-chat-skin-tandem/skills`.

### Patch Changes

- Updated dependencies [24c313e]
  - @ykurilov/agent-chat-core@0.56.0
