# @ykurilov/agent-chat-background

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

### Minor Changes

- 70ad21c: Снимки страниц, картинки провайдера и MCP без своего `fetch` приложения ходят закреплённым `fetch` из нового серверного входа `@ykurilov/agent-chat-web-tools/network`: имя проверяется в момент соединения, подмена DNS во внутреннюю сеть не пускает. Свой `fetch` приложения — граница доверия: закреплять соединение должен он сам. Предел `maxRunningPerUser` держится между копиями сервера и для ответов на подтверждение через новый метод `TaskStore.admitWithinLimit` (память, SQLite, PostgreSQL); своё хранилище без него теперь не запускается — метод надо добавить. Ответ на подтверждение фоновой задачи при занятых местах получает отказ `TurnRefusedError` с кодом `too_many_tasks`: вопрос ждёт, ответить можно, когда место освободится. Отказ проверки адреса в `person_link_view` больше не считается просмотром; битая %-кодировка в адресе экрана админа MCP даёт 404 вместо 500. Подробности и шаги обновления — `docs/audit-network.md`. SQL-миграций нет.

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

### Patch Changes

- Updated dependencies [24c313e]
  - @ykurilov/agent-chat-core@0.56.0

## 0.55.0

### Patch Changes

- Updated dependencies [51f7b38]
- Updated dependencies [cdc7dd7]
  - @ykurilov/agent-chat-core@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [fa90219]
  - @ykurilov/agent-chat-core@0.54.0

## 0.53.0

### Patch Changes

- Updated dependencies [b6a7786]
  - @ykurilov/agent-chat-core@0.53.0

## 0.52.0

### Patch Changes

- @ykurilov/agent-chat-core@0.52.0

## 0.51.0

### Patch Changes

- b199ebe: Две копии сервера на медленной базе больше не выполняют одну фоновую задачу дважды.
  
  - Подбор брошенных задач идёт в копии по одному: обход по таймеру, начатый посреди `recover()`, раньше брал ту же
    задачу второй раз (свою аренду копия берёт снова) и запускал её дважды.
  - Аренда задачи считается от её взятия, а не от начала обхода: задача, взятая в конце долгого обхода, уже не приходит
    с истёкшей арендой, которую тут же перехватывает другая копия.
  - Продление аренд идёт отдельно от доставки и подбора и не ждёт их: долгий подбор больше не даёт аренде идущей задачи
    истечь.
  
  Как обновить: поднять версию. Настроек и миграций нет.
- Updated dependencies [41b1726]
  - @ykurilov/agent-chat-core@0.51.0

## 0.50.0

### Patch Changes

- @ykurilov/agent-chat-core@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [084cef7]
  - @ykurilov/agent-chat-core@0.49.0

## 0.48.0

### Patch Changes

- Updated dependencies [fa10d5a]
  - @ykurilov/agent-chat-core@0.48.0

## 0.47.0

### Patch Changes

- Updated dependencies [5a59c33]
  - @ykurilov/agent-chat-core@0.47.0

## 0.46.2

### Patch Changes

- Updated dependencies [3d0d2f2]
  - @ykurilov/agent-chat-core@0.46.2

## 0.46.1

### Patch Changes

- @ykurilov/agent-chat-core@0.46.1

## 0.46.0

### Patch Changes

- Updated dependencies [56d7528]
- Updated dependencies [a1933fd]
- Updated dependencies [52cc67d]
  - @ykurilov/agent-chat-core@0.46.0

## 0.45.0

### Minor Changes

- eb74c58: Простой вид работы агента: свойство экрана `workView="simple"` — пока ход идёт, одна живая строка с текущим шагом
  («Рисую календарь…»); после хода шаги свёрнуты в «Сделано N шагов» со списком понятных фраз, без кода и «Думал N сек».
  По умолчанию `workView="detailed"` — всё как раньше. Фразы задаёт приложение (`stepPhrases`: имя инструмента →
  `{ running, done, failed? }` или функция от вызова); встроенные пакеты дают свои во входе `./labels`
  (`webToolStepPhrases`, `memoryStepPhrases`, `historySearchStepPhrases`, `backgroundStepPhrases`, и английские).
  Договор скина 23: необязательный `ChatSkin.WorkSteps`; скин 22 работает без правок. Подробно — docs/work-view.md.
  
  ### Как обновить приложение
  
  Ничего не требуется. Чтобы включить простой вид:
  
  ```tsx
  import { webToolStepPhrases } from "@ykurilov/agent-chat-web-tools/labels";
  
  <ChatWorkspace
    workView="simple"
    stepPhrases={{
      ...webToolStepPhrases,
      write_file: ({ input }) => ((input as { path?: string } | undefined)?.path ? { running: "Пишу файл", done: "Написал файл" } : undefined),
      check_app: { running: "Проверяю приложение", done: "Проверил приложение" },
    }}
    …
  />;
  ```
  
  Свой скин может нарисовать простой вид сам — `WorkSteps` по docs/work-view.md (`WorkStepsView`: `live` с фразой или
  `done` со `steps`, `count`, `open`). Без него шаги рисуются строкой `ToolCallRow`: «Сделано N шагов» в `title`, входа нет,
  а список понятных фраз приходит в `output` строкой — скин покажет его как обычный результат вызова.

### Patch Changes

- @ykurilov/agent-chat-core@0.45.0

## 0.44.0

### Minor Changes

- 6a2b5d9: Живые демонстрации: блок ```html-demo в ответе запускается в изолированной рамке (`sandbox="allow-scripts"`, строгий CSP,
  наружу только высота). `agent.liveDemos` на сервере — одна постоянная строка инструкции; `liveDemos` у `AgentChat`,
  `ChatWorkspace` и `AgentPanel`. Договор скина v22: необязательные `AgentText.renderDemo` и `ChatSkin.demoColors`, Тандем
  умеет. Мессенджеры вместо блока пишут `liveDemoOnSite`, если у службы чата `liveDemos` (новое необязательное поле `ChatService.liveDemos`).
  Код живёт в рамке внутри рамки: уйти на чужой адрес он не может, WebRTC убран. Выключатель: в чате с чужим текстом (веб-инструменты, файл человека, инструмент с `metadata: { externalContent: true }`)
  демонстрации не запускаются — признак `ChatHistory.externalContent` и кусок потока `data-external-content`. Вложенные рамки
  и `<link rel=preconnect>` в документе демонстрации запрещены. Всё необязательное, ломающих изменений нет. Как обновить
  приложение — в CHANGES.md, раздел 0.44.0.

### Patch Changes

- Updated dependencies [6a2b5d9]
  - @ykurilov/agent-chat-core@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [763f4c5]
  - @ykurilov/agent-chat-core@0.43.0

## 0.42.0

### Patch Changes

- Updated dependencies [a385276]
  - @ykurilov/agent-chat-core@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [9472fcb]
  - @ykurilov/agent-chat-core@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [0e7aab3]
  - @ykurilov/agent-chat-core@0.40.0

## 0.39.1

### Patch Changes

- @ykurilov/agent-chat-core@0.39.1

## 0.39.0

### Patch Changes

- Updated dependencies [3b90429]
  - @ykurilov/agent-chat-core@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [1cae504]
- Updated dependencies [4065a4a]
  - @ykurilov/agent-chat-core@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [7f49d12]
- Updated dependencies [ea78982]
  - @ykurilov/agent-chat-core@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [3487fb4]
- Updated dependencies [8c43b86]
- Updated dependencies [6f42418]
- Updated dependencies [5f13c74]
  - @ykurilov/agent-chat-core@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [2382026]
  - @ykurilov/agent-chat-core@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [d039ce4]
  - @ykurilov/agent-chat-core@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [4a72339]
  - @ykurilov/agent-chat-core@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [71c32b7]
- Updated dependencies [cae13bf]
- Updated dependencies [a94bda9]
- Updated dependencies [4e44492]
- Updated dependencies [ac9b7d3]
- Updated dependencies [27f4b1e]
  - @ykurilov/agent-chat-core@0.32.0

## 0.31.2

### Patch Changes

- @ykurilov/agent-chat-core@0.31.2

## 0.31.1

### Patch Changes

- @ykurilov/agent-chat-core@0.31.1

## 0.31.0

### Patch Changes

- @ykurilov/agent-chat-core@0.31.0

## 0.30.0

### Patch Changes

- @ykurilov/agent-chat-core@0.30.0

## 0.29.0

### Patch Changes

- @ykurilov/agent-chat-core@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [11c3c97]
- Updated dependencies [d63ccaa]
- Updated dependencies [6a2f903]
- Updated dependencies [189cba9]
  - @ykurilov/agent-chat-core@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [d8341b2]
- Updated dependencies [5e4ed28]
- Updated dependencies [e0bb519]
  - @ykurilov/agent-chat-core@0.27.0

## 0.26.2

### Patch Changes

- Updated dependencies [f24858a]
  - @ykurilov/agent-chat-core@0.26.2

## 0.26.1

### Patch Changes

- @ykurilov/agent-chat-core@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [eb43e47]
  - @ykurilov/agent-chat-core@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [99d426e]
- Updated dependencies [d8201f6]
  - @ykurilov/agent-chat-core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [9b895cd]
  - @ykurilov/agent-chat-core@0.24.0

## 0.23.0

### Patch Changes

- @ykurilov/agent-chat-core@0.23.0

## 0.22.0

### Patch Changes

- @ykurilov/agent-chat-core@0.22.0

## 0.21.0

### Patch Changes

- Updated dependencies [7c3bcc4]
  - @ykurilov/agent-chat-core@0.21.0

## 0.20.0

### Minor Changes

- fd16b01: Два новых пакета.
  
  - `@ykurilov/agent-chat-background` — фоновые задачи: инструмент или помощник работает в фоне, итог приходит в чат служебным сообщением, задачи переживают перезапуск сервера. Хранилища: память, SQLite, PostgreSQL. README пакета и `docs/background.md`.
  - `@ykurilov/agent-chat-messengers` — чат приложения в Telegram, VK и MAX: привязка аккаунтов, вебхук или опрос, группы, файлы, голос, голосовые ответы, карточки задач, доставка «хотя бы раз». README пакета и `docs/messengers.md`. Для вида панели подключения — `MessengersSkin` v1.
  
  Что сделать в приложении: ставить нужно только если нужны фон или мессенджеры; подключение — по README пакетов.

### Patch Changes

- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-core@0.20.0
