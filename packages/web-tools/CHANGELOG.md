# @ykurilov/agent-chat-web-tools

## 0.87.10

### Patch Changes

- @ykurilov/agent-chat-core@0.87.10

## 0.87.9

### Patch Changes

- Updated dependencies [16dfbcd]
  - @ykurilov/agent-chat-core@0.87.9

## 0.87.8

### Patch Changes

- Updated dependencies [5fed519]
  - @ykurilov/agent-chat-core@0.87.8

## 0.87.7

### Patch Changes

- @ykurilov/agent-chat-core@0.87.7

## 0.87.6

### Patch Changes

- @ykurilov/agent-chat-core@0.87.6

## 0.87.5

### Patch Changes

- @ykurilov/agent-chat-core@0.87.5

## 0.87.4

### Patch Changes

- @ykurilov/agent-chat-core@0.87.4

## 0.87.3

### Patch Changes

- Updated dependencies [eb19945]
  - @ykurilov/agent-chat-core@0.87.3

## 0.87.2

### Patch Changes

- Updated dependencies [9c34bd4]
  - @ykurilov/agent-chat-core@0.87.2

## 0.87.1

### Patch Changes

- Updated dependencies [820bc3b]
  - @ykurilov/agent-chat-core@0.87.1

## 0.87.0

### Patch Changes

- Updated dependencies [eec4550]
  - @ykurilov/agent-chat-core@0.87.0

## 0.86.1

### Patch Changes

- Updated dependencies [f23e7bc]
  - @ykurilov/agent-chat-core@0.86.1

## 0.86.0

### Patch Changes

- Updated dependencies [ae9467a]
  - @ykurilov/agent-chat-core@0.86.0

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

- e30dd9b: `person_link_view` больше не считает своё сохранённое намерение уже выполненным просмотром: при лимите три доступны все три попытки, четвёртая отклоняется. Полные http(s)-ссылки с адресом-числом или localhost распознаются в реплике человека; localhost и частная сеть получают отказ по безопасности вместо ошибочного «человек не присылал». Неоднозначные адреса словами не угадываются, ссылки из ответов агента и служебных сообщений по-прежнему не разрешаются.
  
  Как обновить приложение: обновить все установленные пакеты SDK до одной версии. Настройки, хранилища, переменные окружения и SQL-схемы менять не требуется. Локальный URL из eval следует заменить публичным тестовым адресом, если сценарий должен проверять успешное открытие страницы.
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

### Minor Changes

- b3f42a3: Снимок страницы: не проверено — не значит «не умеет». `page_screenshot` и снимок в `person_link_view` даются любой
  модели, которая видит картинки, кроме провайдеров из `blindToolResultImageProviders` профиля. Картинка никогда не уходит
  модели base64-строкой. Картинку получают провайдеры с `toolResultImages: true` (встроенные помечены) и провайдеры из
  `toolResultImageProviders` профиля; остальным ядро шлёт текст страницы. Провайдер отказал из-за картинки (код 400, 415 или 422, в тексте ошибки — про картинку) — тот же запрос сразу
  уходит текстом; удался повтор — строка `[картинки инструментов]` в журнал, и до перезапуска службы эта пара модели и
  провайдера получает текст. Повтор упал — пара не запоминается, дальше идёт ошибка повтора. 413 — текстом только этот
  запрос. Переполнение контекста и прочие отказы идут дальше как есть. Ошибка внутри уже открытого потока (код 200) не
  откатывается. Первый переход на текст один раз сбрасывает кэш модели. Firecrawl отдаёт
  текст страницы вместе со снимком (тот же кредит).
  
  Что сделать приложению:
  
  - своя проверка «провайдер проверен — даём снимок» больше не нужна;
  - запрещали снимок тем, что не вписывали провайдер в `toolResultImageProviders`, — теперь нужен
    `blindToolResultImageProviders`, иначе снимок уйдёт;
  - провайдер точно не видит картинку из инструмента — `blindToolResultImageProviders: ["id"]` в профиле модели;
  - свой провайдер, передающий картинки инструментов частью `file` SDK, — `toolResultImages: true` в его описании;
  - своя служба снимков может вернуть `page` (текст той же страницы); свой инструмент с картинкой — запасной текст
    `toolImageFallbackText(текст)` из `@ykurilov/agent-chat-core`.

### Patch Changes

- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-core@0.61.0

## 0.60.0

### Minor Changes

- 6e8723c: Снимок страницы в ответе инструмента уходит картинкой к Together и Fireworks (раньше — строкой текста, ход зависал); профиль DeepSeek 4.1 Flash видит снимки через DeepSeek, Together, Fireworks и OpenRouter. Сценарии не называют инструменты, которых нет у модели этого хода; правила просмотра ссылок — в описании инструмента.

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-core@0.60.0

## 0.59.0

### Patch Changes

- Updated dependencies [fc1f387]
  - @ykurilov/agent-chat-core@0.59.0

## 0.58.0

### Patch Changes

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

- Updated dependencies [41b1726]
  - @ykurilov/agent-chat-core@0.51.0

## 0.50.0

### Patch Changes

- @ykurilov/agent-chat-core@0.50.0

## 0.49.0

### Minor Changes

- 084cef7: **Ломает приложения (типы и своё хранилище сценариев):** у типа поля сценария `FlowFieldType` появилось значение `"boolean"`, у источника
  расхода `UsageSource` — `"first_message"`, у `SteerResult.status` — `"held"`. Исчерпывающий `switch` по ним перестанет
  собираться. Своё хранилище сценариев (`FlowStore`) должно реализовать новый `renewLease()` и третий аргумент `setDue`.
  
  Сценарии для приложений: программа по дням (ночь, касания, рамки дня, «срок вышел»), своя служба чата и доставка с
  исходами, пауза сотрудника, конец разговора с итогом, карточка и пояс человека в базе приложения, попутные задачи.
  Проверка готового ответа: «чужие слова» и «выдуманные ссылки». Подробно — `docs/flows.md`, `docs/reply-check.md`,
  раздел 0.49.0 в `CHANGES.md`.
  
  - **flows**: формат сценария версии 2 (`schedule`, `nudges`, таймер `state_days`, поле `boolean`, `sideTasks`,
    `afterEnd`; версия 1 читается сама); `attach({ portFor, deliver })`, `admit`, `pause`/`resume`/`noteStaffReply`,
    `reportDelivery`, `onFinish`, `clientCard`, `people`, `settled`, `now`; причина перехода `reason`; перенос чата
    через `loadFlow` (`stateId`, `startedAt`, `enteredAt`); заголовки судьи `judge.openrouter.headers`; встроенная задача
    «узнать город»; `checkFlow(flow, catalog, { checks })` и `FlowAppChecks` из `/format`; в редакторе панели дней,
    касаний, рамок и попутных задач, `catalog.fields`, кнопка «К началу следующего дня» (`advanceToNextDay`). Новые
    таблицы `flow_people`, `flow_side_tasks` и колонки `flow_chats` создаются сами.
  - **core**: `replyChecks` (список или `{ checks, web: "replace" | "hold" }`), `now`, `markUndelivered`, ответы
    `beforeTurn` `{ hold: true }` и `{ reply: { text } }`, `deliverNotices({ timeZone, awaitAnswer, usageSource })`,
    источник расхода `first_message`.
  - **flows, надёжность**: обход таймеров до 5 ходов одновременно; копия продлевает аренду чата перед ходом и во время
    него. В `FlowStore` новые `renewLease()` и `setDue(…, { unlessDelivery })`. Недоставленное касание (`failed`,
    `window_closed`) не засчитывается — тот же шаг через свой срок от отказа; в `FlowRun` новое поле `touch`. «Окно
    закрыто» снимает любое сообщение человека; «не завершил» считает тишину и от конца паузы сотрудника; пока ждёт
    повтор доставки, срок не затирается и новых ходов нет.
  - **server**: `createChatServer` передаёт службе `replyChecks` и `now`.
  - **messengers**: `onAnswerDelivery` — исход доставки каждого ответа; закрытое окно ВК (950) —
    `MessengerWindowClosedError` и исход `window_closed`; с `replyChecks` уходит только проверенный текст.
  - **web-tools**: `createPersonLinkTool` — инструмент `person_link_view`, агент смотрит ссылку, которую прислал человек
    (адрес из почты ссылкой не считается).
  - **reply-check** (новый пакет): `foreignWords` и `unknownLinks`; ответ из одной выдуманной ссылки заменяется запасной
    фразой `labels.linkOnlyReply` (`russianReplyCheckLabels`, `englishReplyCheckLabels`, `ReplyCheckLabels`).
  - **react**: договор скина версии 24 — необязательное `undelivered` у ответа агента и надпись `answerUndelivered`
    («Не доставлено»). Скин версии 23 работает без правок.
  
  ### Как обновить приложение
  
  1. Поднимите все пакеты `@ykurilov/agent-chat-*` до этой версии вместе.
  2. Найдите в коде приложения исчерпывающие `switch` и словари по этим типам и добавьте ветки:
     - по `FlowFieldType` (поля карточки сценария) — `"boolean"`, «да/нет», значения `true`/`false`;
     - по `UsageSource` (отчёты расходов) — `"first_message"`, «агент написал первым»;
     - по `SteerResult.status` — `"held"`, «сообщение записано, хода нет».
  3. Своё хранилище сценариев (свой `FlowStore`) — добавьте `renewLease({ chatId, owner, now, leaseMs }): Promise<boolean>`
     (продлить аренду до `now + leaseMs`; `false` — чат уже не ваш) и третий аргумент `setDue(chatId, due, { unlessDelivery })`
     (при `unlessDelivery` не писать срок, пока чат ждёт повтора доставки). Готовые хранилища SDK это уже умеют.
  4. Сценарии сохраняются версией 2, а 0.48 её не откроет. Перед откатом на 0.48 держите копии сценариев версии 1.
  5. Новое по желанию: каналы SDK и сценарий — `createMessengers({ onAnswerDelivery: (report) => flow.reportDelivery(report) })`;
     проверка ответа — `pnpm add @ykurilov/agent-chat-reply-check` и `replyChecks` в `createChatServer`.
  6. Проверка: `pnpm typecheck` проходит, чат отвечает, сценарий версии 1 открывается в редакторе.

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

### Minor Changes

- 9472fcb: Поправка на лету и английский интерфейс.
  
  - `onTurnFinished` в `AgentChat` приходит и для ответа, закрытого ради поправки, — перед ответом на поправку. Раньше
    событие получал только последний ответ, и действия под первым (например, «Вернуть эту версию») не появлялись.
    Событие есть, даже если продолжение по поправке не стартовало (лимит расходов, чужие ходы, чат закрыт).
    **Внимание:** при поправке на ходу `onTurnFinished` теперь приходит на каждый ответ — обработчик, который сохраняет
    снимок или считает ходы, увидит 2 события и больше.
  - Продолжение после поправки получает `place` самой свежей поправки, где он есть, иначе начала хода: служебная заметка
    приложения уже новая, а поправка только с `tabId` место не стирает. Вкладка и пояс — от последней поправки: браузерные
    инструменты продолжения идут на её вкладку. Кэш цел — блок места ложится в хвост поправки.
  - `englishLabels` — полный английский словарь чата. `englishAttachmentsLabels`, `englishWebToolTitles`,
    `englishHistorySearchTitles`, `englishMemoryToolTitles` (два последних — и из корня пакета); `withWebToolTitles` и
    соседи берут словарь названий вторым аргументом (по умолчанию русский).
  
  Как обновить: поднять версию. Английский интерфейс — `<ChatLabelsProvider labels={englishLabels}>` и
  `createAttachmentsClient(englishAttachmentsLabels)` вместо своих словарей.

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

### Minor Changes

- 4065a4a: Картинки для моделей без зрения. Зрение модели теперь решается для пары «модель + провайдер»: в профиле
  `acceptsImagesByProvider: { together: false }` главнее `acceptsImages`, решение даёт `modelAcceptsImages(profile, providerId)`
  из ядра, по нему меню моделей и вложения. В стандартном каталоге DeepSeek 4.1 Flash и GLM 5.3 Flash через Together
  отмечены без зрения (у Together они только текстовые) — картинка туда больше не уходит, модель получает пометку.
  
  Во вложениях:
  
  - `createAttachments({ imagesForBlindModels: { toolName, marker?, always? } })` — модели без зрения вместо картинки идёт
    постоянная плашка `[Картинка «shot.png», вложение <id>. Посмотреть: <toolName>.]`; к инструкции вложений дописывается
    строка про неё. Без настройки — прежняя пометка «картинка не показана».
  - `attachments.readChatImage({ chatId, attachmentId })` — картинка только этого чата для инструмента приложения
    (`chatId` — из `AgentToolsModel.chatId`); чужое, не картинка, неверный номер — `undefined`.
  - `createAttachments({ acceptedMediaTypes: ["image/png", "image/jpeg", "image/webp"] })` — файл другого типа отклоняется
    `unsupported_type` до разбора и записи; поле ввода получает список из настроек и отказывает до загрузки.
    Решает тип, с которым файл пришёл (поле записи `sourceMediaType`): ужатый в JPEG PNG при `["image/png"]` проходит.
    Импорт чата вместо картинки неподходящего типа пишет «[картинка: имя]».
  - `isAttachmentId` — из публичного входа.
  - Снимок страницы (`page_screenshot`) тоже решает по паре «модель + провайдер».
  
  Ничего не ломает: приложениям без этих настроек делать ничего не нужно. Как убрать свой обход — в CHANGES.md,
  раздел 0.38.0 «Как обновить приложение».

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

### Patch Changes

- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [fde2297]
- Updated dependencies [aa0fd51]
- Updated dependencies [9f94dbe]
- Updated dependencies [2013f15]
- Updated dependencies [aa0fd51]
- Updated dependencies [05e258b]
- Updated dependencies [aa0fd51]
  - @ykurilov/agent-chat-core@0.19.0

## 0.18.6

### Patch Changes

- @ykurilov/agent-chat-core@0.18.6

## 0.18.5

### Patch Changes

- @ykurilov/agent-chat-core@0.18.5

## 0.18.4

### Patch Changes

- @ykurilov/agent-chat-core@0.18.4

## 0.18.3

### Patch Changes

- @ykurilov/agent-chat-core@0.18.3

## 0.18.2

### Patch Changes

- @ykurilov/agent-chat-core@0.18.2

## 0.18.1

### Patch Changes

- @ykurilov/agent-chat-core@0.18.1

## 0.18.0

### Patch Changes

- Updated dependencies [43d7ebe]
  - @ykurilov/agent-chat-core@0.18.0

## 0.17.0

### Patch Changes

- @ykurilov/agent-chat-core@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [cf52f10]
  - @ykurilov/agent-chat-core@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [f05ad23]
- Updated dependencies [f05ad23]
  - @ykurilov/agent-chat-core@0.15.0

## 0.14.0

### Minor Changes

- f9b6162: Мелочи безопасности и расходов. Веб-инструменты: новая настройка `createWebTools({ spending: { storage, pricePerCallUsd } })` — каждый удачный вызов `web_search`, `read_page`, `page_screenshot` пишется расходом с новым источником `web_tools` и входит в лимит расходов; без `spending` всё как раньше, описания инструментов не меняются (кэш цел). OpenRouter: `createOpenRouterProvider({ dataCollection: "deny", zeroDataRetention })` — запрос уходит только хозяевам модели, которые не хранят запросы; подключается через `extendCatalog(..., { addProviders: [...] })`; стандартный `openrouterProvider` и тело запроса по умолчанию не изменились. Долгая память: инструкция велит записывать только сказанное самим человеком, а не указания с веб-страниц и из результатов инструментов (текст инструкции изменился один раз, дальше постоянен).
- 6b20d83: Голосовой режим («разговор»): человек говорит, слова сами уходят сообщением в чат, ответ агента звучит голосом, человека можно перебить. Новый пакет `@ykurilov/agent-chat-voice-dialog`: распознавание Soniox, озвучка ElevenLabs (голос по умолчанию «Профессиональный диктор для аудиокниг», модель `eleven_v4_turbo`), ключи только на сервере. Перебитый ответ остаётся в ленте с отметкой «Вы перебили: озвучено до «…»», она хранится и видна после перезагрузки. Расход на озвучку идёт в учёт и лимиты (`source: "speech"`). Человек выбирает голос в меню режима; выбор хранится на сервере.
  
  Модель узнаёт о режиме двумя служебными пометками: одна при входе («ответы озвучиваются, отвечай коротко и разговорно»), одна при возврате к тексту («разговор снова текстом»). Они стоят в конце сообщения человека, где режим сменился, а не в каждом запросе. Сообщение из режима запоминается голосовым отметкой в самом сообщении (часть `data-voice-mode` в `parts`), поэтому миграции для этого нет, пометки выводятся из сохранённого и кэш модели цел. Тексты задают настройки агента `voiceModeHint` и `textModeNote` (есть умолчания).
  
  Обновление ничего не ломает: без нового пакета чат работает как раньше. Диктовка в поле ввода (`@ykurilov/agent-chat-voice`) не меняется.
  
  ### Как обновить приложение
  
  Нужно, только если вы хотите голосовой режим.
  
  1. Поставьте пакет `@ykurilov/agent-chat-voice-dialog` той же версии, что и остальные пакеты SDK. Скин Тандем обновите вместе с SDK: договор скина теперь версии 10 (необязательный `dialog` у поля ввода, панель режима, меню голосов, отметка обрыва; свой скин может их не рисовать, тогда кнопки режима не будет).
  2. Сервер. Рядом с чатом подключите режим (нужен WebSocket; с Hono и `@hono/node-ws`):
  
     ```ts
     import { mountDialogRelay } from "@ykurilov/agent-chat-voice-dialog/hono";
  
     mountDialogRelay(app, {
       path: "/api/voice-dialog",
       upgradeWebSocket,
       storage,
       resolveUser,                 // тот же вход, что у чата
       spendingLimits,              // по желанию
       logError: (message) => console.error(message),
       speech: {
         voices: [{ id: "oE0n0S3wK5Mj9C62iehn", name: "Профессиональный диктор для аудиокниг" }],
         defaultVoiceId: "oE0n0S3wK5Mj9C62iehn",
         pricePerThousandChars: { eleven_v4_turbo: 0.11, eleven_v4: 0.22 }, // ваша цена, $ за 1000 знаков
       },
     });
     ```
  
     Ключи `ELEVENLABS_API_KEY` и `SONIOX_API_KEY` — в окружении сервера. Next.js: WebSocket нужен свой Node-сервер, см. README пакета (`createDialogRelay`).
  3. Браузер:
  
     ```tsx
     const voiceDialog = createVoiceDialogEngine({ basePath: "/api/voice-dialog" });
     <AgentChat api="/api/chat" skin={tandemSkin} voiceDialog={voiceDialog} />
     ```
  
  4. Настройки. Слова остановки и междометия по умолчанию только русские; для другого языка задайте `bargeIn.stopWords` и `bargeIn.ignoreWords` у движка и `language` на сервере. Строгая политика содержимого страницы: добавьте `worklet-src blob:`.
  5. Хранилище. SQLite получает миграцию 0008, PostgreSQL — 0007 (схема `agent_chat`) сами при открытии базы. Свой `ChatStorage`: добавьте необязательные методы `setVoiceCut`, `getVoiceChoice`, `setVoiceChoice` (без них отметка обрыва и выбор голоса живут только до перезагрузки) и значение `"speech"` в `UsageSource`, если учёт расхода у вас свой.
  6. Свой экран (не наш скин): части сообщения с типом `data-voice-mode` не рисуйте, показывайте только текстовые части.
  7. Проверка: `pnpm typecheck` проходит; в чате появилась кнопка режима, после нажатия виден статус «Слушаю», фраза уходит сообщением, ответ звучит.

### Patch Changes

- 96098be: Мелкие исправления (022). Символ с кодом ноль в первом сообщении больше не роняет отправку на Postgres: он выбрасывается из названия чата, из записей памяти и из сводки сжатия истории (иначе запись сжатия падала бы при каждой попытке); в самом тексте сообщения он лежит как раньше. Вложения отмечаются прикреплёнными до записи сообщения, а не после: если сервер упал между двумя шагами, чистка брошенных файлов не удалит их через сутки (файл, отмеченный зря, безвреден и уходит вместе с чатом). Во всех пакетах появилось поле `engines: { node: ">=22" }`; голосовой сервер (`createVoiceRelay`) и голосовой диалог (`createDialogRelay`) на Node 20 сразу при создании говорят понятной ошибкой, что нужен Node 22 (раньше падали при первом соединении; со своим `connectUpstream` проверки нет). В пакете вложений `react` и `@ykurilov/agent-chat-react` стали необязательными peer-зависимостями: серверу без экрана они больше не ставятся. Приложению, которое берёт `@ykurilov/agent-chat-attachments/react`, достаточно иметь их в проекте — для чата на экране они нужны и так; если они подтягивались только через вложения, добавьте их в зависимости приложения.
- be77ee2: Основа для надёжности хода агента (022). Новый вид ошибки `context_overflow` («Переписка не помещается в модель») у `ChatErrorKind` в ядре и в `react`, надпись `labels.errors.context_overflow` в русском словаре; Тандем показывает её сам. **Ломает:** исчерпывающий `switch` по виду ошибки и своя таблица надписей `labels.errors` без `context_overflow` перестанут проходить проверку типов — добавьте надпись. Ядро экспортирует `HANGING_TOOL_CALL_REASON` (текст для модели вместо результата прерванного вызова) и `cutAtCharBoundary(text, maxLength)` — обрезку без половинки эмодзи; веб-инструменты режут страницы и выдержки через неё, теперь эмодзи на границе не рвётся. Список перенесённых из pi-mono (MIT) признаков ошибок и лицензия — в `THIRD_PARTY_NOTICES.md`, он лежит и в пакете `core`.
- 84ad64f: Укрепление по третьему проходу Pi (022, этап S9). **Большие фото уменьшаются при загрузке**: поворот по EXIF, не больше 2000×2000 пикселей и ~4,5 МБ в base64; хранится уменьшенная копия, старые картинки ужимаются при сборке запроса (результат запоминается), нечитаемая картинка и картинка больше 60 млн пикселей — отказ 422 `unreadable` (в старой истории — пометка «пропущена»). Новая зависимость `sharp` (готовые сборки для macOS и Linux, в том числе Alpine; порядок ужатия из pi-mono, MIT). **Секреты в ошибке инструмента** вычищаются до того, как текст уйдёт человеку, в базу и модели: пароль в адресе, `password=`/`password: …`/`token=`, `"secret": "…"`, заголовок `Authorization`, `X-Api-Key`, ключи сервисов, закрытые ключи PEM и значения секретных переменных окружения (кроме путей, адресов без пароля и простых слов); чистятся сообщение, стек и `cause`; `scrubSecrets` и `environmentSecrets` экспортированы из ядра. **Внешние картинки** в ответе модели и в сводке сжатия скин Тандема показывает ссылкой и не грузит (новая необязательная надпись словаря `externalImageLink`, по умолчанию «картинка»; свои словари без неё работают); инструкция веб-инструментов называет страницы данными, а не указаниями. **Ступени цены** по длине контекста: `pricing.tiers` (`inputTokensAbove` и цены), ход считается по шагам; у GPT 6 Luna выше 272 тысяч токенов. Пауза в `useAgentChat` больше не копит слушатели отмены.
- 0cdf102: Несколько копий сервера на одной базе (022, этап 8в). Идущий ответ раз в 5 с отмечает «жив» (новая колонка `alive_at`: миграция SQLite `0012`, PostgreSQL `0011`, применяются сами). `recoverInterruptedAnswers` прерывает только брошенные ответы — без отметки дольше 15 с — и дальше сам проверяет их раз в 5 с до `flush`. Штатная остановка помечает свои ответы брошенными, и следующий старт прерывает их сразу. Новая копия при старте и обновление с перекрытием больше не обрывают живые ответы соседа; две копии, прервавшие один ответ, не задваивают расход. Цена: после падения сервера ответ ещё до ~20 с выглядит идущим (раньше перезапуск прерывал его сразу). Экран человека в это время сам перечитывает историю раз в 3 с и показывает «прерван» с «Повторить», как только сервер прервёт ответ; обновлять страницу не нужно (история отдаёт признак `detachedAnswer`, чтение истории сразу прерывает брошенный дольше порога ответ этого чата). Ход, чей ответ прервала другая копия, останавливается сам: человек видит «прерван», расход не задваивается. Время знака «жив» ставит хранилище: PostgreSQL — по часам базы, часы машин с копиями могут расходиться. Запросы одного чата держите на одной копии. Свои хранилища: два новых необязательных метода — `listSilentAnswerIds({ silentForMs, chatId? })` и лёгкая отметка `markAnswerAlive(messageId)` — и поле записи `alive` (`"now"` или `"released"`, время ставит само хранилище); общий набор контракта их проверяет. Хранилище без `listSilentAnswerIds` продолжает работать только с одной копией сервера: при старте `recoverInterruptedAnswers` прерывает все идущие ответы, проверок брошенных ответов дальше нет, а в журнал сервера пишется предупреждение. Без `markAnswerAlive` знак в тишине идёт полной записью ответа. Поле `alive` приходит в `insertMessage`, `updateStreamingMessage` и `updateAwaitingMessage`: если хранилище не ведёт знак, уберите поле перед записью, а не передавайте его в базу целиком. Переход на эту версию — один раз без перекрытия копий: старые копии не отмечают «жив», и новая прервала бы их ответы старше 15 с; сначала остановите все старые копии, потом запускайте новые. Дальше перекрытие безопасно. Если запрос истории попал не на ту копию, экран через 30 с сам покажет «прерван», хотя ответ идёт: держите запросы одного чата на одной копии. Сбой базы при конечной записи ответа повторяется через 1 и 3 с, а если не вышло — ответ остаётся для восстановления вместо вечного «идёт»; если запись прошла, а потерялся только ответ базы, повтор узнаёт свой итог и считает его удачным. Инструмент «по очереди», не слушающий отмену, после обрыва попытки держит очередь не дольше своего срока; очередь одна на чат, так что «Стоп» и сразу «Повторить» не запустят его второй раз параллельно. Восстановление пропускает ответ, на котором упало, с записью в журнал сервера, и прерывает остальные: битая запись не мешает серверу стартовать. Мелочи: адрес ответа вкладки на браузерный инструмент отвечает 413 `too_large` на слишком большое тело; неотвеченный запрос подтверждения закрывается только после сохранения нового сообщения, а если закрыть не вышло — повтор того же сообщения или «Повторить» доводят дело до конца; вызов веб-инструмента, оборванный «Стопом» или сбоем после отправки запроса, пишется в расход `web_tools`; картинки при загрузке ужимаются через очередь — разом не больше половины ядер (`limits.maxParallelImageFits`).
- Updated dependencies [4f33e85]
- Updated dependencies [15fbbcc]
- Updated dependencies [c09c1e2]
- Updated dependencies [062ce36]
- Updated dependencies [656233a]
- Updated dependencies [96098be]
- Updated dependencies [b6f4855]
- Updated dependencies [278a718]
- Updated dependencies [c1581f4]
- Updated dependencies [213bcb3]
- Updated dependencies [927c02c]
- Updated dependencies [be77ee2]
- Updated dependencies [8b59096]
- Updated dependencies [7fbc105]
- Updated dependencies [84ad64f]
- Updated dependencies [5027963]
- Updated dependencies [c2769dd]
- Updated dependencies [0cdf102]
- Updated dependencies [ba16989]
- Updated dependencies [aba59fe]
- Updated dependencies [47a56ac]
- Updated dependencies [f9b6162]
- Updated dependencies [f9b6162]
- Updated dependencies [f9b6162]
- Updated dependencies [1b2f9f1]
- Updated dependencies [0e8e0ae]
- Updated dependencies [6b20d83]
- Updated dependencies [d12dcf3]
- Updated dependencies [366d785]
- Updated dependencies [946e5d8]
  - @ykurilov/agent-chat-core@0.14.0

## 0.13.0

No changes in this release.

## 0.12.0

No changes in this release.

## 0.11.0

No changes in this release.

## 0.10.0

No changes in this release.

## 0.9.0

No changes in this release.

## 0.8.0

No changes in this release.

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

### Minor Changes

- 2deeab3: Веб-инструменты стали строже к адресам, а лента показывает их результаты удобнее.
  
  - Скачивание снимка страницы (его делает сервер приложения) больше не идёт по переходам вслепую: переходы выполняются вручную, не больше трёх, и каждый проходит проверку адреса. Имя дополнительно разрешается по DNS: если хоть один адрес частный, снимок не скачивается.
  - Проверка адреса закрывает IPv4 внутри IPv6 (`[::7f00:1]`, `::ffff:`, `64:ff9b::`), `fec0::/10`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15` и служебные диапазоны. Для чтения страниц проверяется только адрес до вызова Firecrawl (README пакета описывает границы честно).
  - Снимки кэшируются в памяти сервера (до 20 штук, до 20 МБ, час): повторные ходы не качают одно и то же. Новая необязательная опция `resolveHost` у `createWebTools` (по умолчанию системный DNS).
  - В результаты поиска и чтения попадают только адреса `http(s)`.
  - Скин Тандем: ссылки в развёрнутой строке веб-инструмента кликабельны (только `http(s)`, новая вкладка, `rel="noopener noreferrer"`), снимок страницы рисуется картинкой (ленивая загрузка, ограниченный размер; при ошибке — текст и ссылка на страницу).
  - В словарь `ChatLabels` добавлены два ключа: `screenshotAlt` и `screenshotUnavailable`.
  
  ### Как обновить приложение
  
  1. Поднимите все пакеты `@ykurilov/agent-chat-*` до одной версии.
  2. Если приложение задаёт словарь надписей целиком, а не поверх `russianLabels`, добавьте в него `screenshotAlt` («Снимок страницы») и `screenshotUnavailable` («Снимок не загрузился.»); иначе `pnpm typecheck` покажет ошибку. Словарь вида `{ ...russianLabels, … }` ничего не требует.
  3. Если своя строка вызова (`ToolCallRow`) показывает результат веб-инструментов, при желании сделайте так же: ссылки только `http(s)` с `rel="noopener noreferrer"`, снимок картинкой с запасным текстом. Готовый пример — `skins/tandem/src/tool-call-row.tsx`.
  4. Для сервера, у которого во внутренней сети есть что-то ценное, запретите исходящие соединения в частные сети на уровне сети: окно DNS rebinding между проверкой и запросом остаётся.
- 61717c6: У агента появились веб-инструменты: поиск в интернете, чтение страницы и скриншот страницы. Они вынесены в новый необязательный пакет; приложение, которому они не нужны, его не ставит и ничего не получает.
  
  - Новый пакет `@ykurilov/agent-chat-web-tools`: `createWebTools({ search, reader, screenshots? })` и готовые сервисы на Firecrawl `createFirecrawlServices({ apiKey, baseUrl?, headers? })` из подпути `@ykurilov/agent-chat-web-tools/firecrawl`. Сервис заменяется без правки инструментов (интерфейсы `WebSearchService`, `PageReaderService`, `PageScreenshotService`). Ключ и адрес сервиса остаются на сервере; `baseUrl` и `headers` позволяют идти через прокси. Подписи вызовов для ленты — `withWebToolTitles(russianLabels)` из подпути `@ykurilov/agent-chat-web-tools/labels`.
  - Скриншот получают только модели с `acceptsImages: true`, у которых в профиле отмечено, что через выбранного провайдера они видят картинку в результате инструмента (`toolResultImageProviders`, см. запись про модели). Отмеченные в стандартном наборе: GPT 6 Luna и Gemini 3.8 Flash через OpenRouter.
  - В `@ykurilov/agent-chat-core` `agent.tools` может быть функцией от выбранной модели: `(model: { profile, providerId }) => ToolSet`. Так набор инструментов зависит от модели. Обычный набор работает как раньше; экспортируются типы `AgentToolsSource` и `AgentToolsModel`.
  
  ### Как обновить приложение
  
  Только если нужны веб-инструменты. Остальным обновление ничего не требует.
  
  1. Поставьте пакет той же версии, что остальные: `pnpm add @ykurilov/agent-chat-web-tools`.
  2. На сервере (там, где `createChatHandler`) добавьте инструменты и инструкцию к ним. Ключ Firecrawl — в переменной окружения сервера, не в браузерной части:
  
     ```ts
     import { createWebTools, webToolsInstructions } from "@ykurilov/agent-chat-web-tools";
     import { createFirecrawlServices } from "@ykurilov/agent-chat-web-tools/firecrawl";
  
     const firecrawl = createFirecrawlServices({ apiKey: process.env.FIRECRAWL_API_KEY!, baseUrl: process.env.FIRECRAWL_BASE_URL });
     const webTools = createWebTools(firecrawl);
  
     createChatHandler({
       // …
       agent: {
         instructions: `${appInstructions}\n${webToolsInstructions}`,
         tools: (model) => ({ ...appTools, ...webTools(model) }),
       },
     });
     ```
  
  3. В браузерной части подключите подписи: `<ChatLabelsProvider labels={withWebToolTitles(russianLabels)}>` вокруг `AgentChat` (`withWebToolTitles` — из `@ykurilov/agent-chat-web-tools/labels`).
  4. Проверьте: `pnpm typecheck`; спросите агента «Найди в интернете последнюю версию Node.js» — в ленте появятся строки «Поиск в интернете: готово» и «Чтение страницы: готово», в ответе — ссылка на источник.
