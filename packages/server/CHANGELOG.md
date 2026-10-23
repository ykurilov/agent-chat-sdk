# @ykurilov/agent-chat-server

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

- 6ccbc87: `createChatServer` передаёт службе чата все её опции, а не ручной список: `appNoticeViews` (проекции пометок сценария при праве `appNotices`) теперь доходит, строки «Агент написал первым» видны. Новая опция службы дойдёт сама; `ChatHandlerOptions` выведен из опций `createChatService`.
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

### Minor Changes

- 332d90e: Новый параметр службы `abandonedBursts: { serviceFor }`: при нескольких службах на одном хранилище обход брошенных пачек
  (`answerAfterRestart`) отдаёт пачку службе, которую назвало приложение, — её инструкция и модель отвечают. `serviceFor`
  может создать службу по требованию; вернула `null` или упала — пачка ждёт следующего обхода, чужая служба её не берёт. Тот же параметр — у `createChatServer`.

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

- fa10d5a: Сценарии поведения агента: разговор идёт по шагам с условиями выхода, судьёй, таймерами «написать первым» и карточкой
  клиента, плюс редактор сценария с тестовым чатом. Подробно — `docs/flows.md`.
  
  - **flows** (новый пакет): `createAgentFlow`, формат и проверка сценария, судья decision-1 с запасной моделью, таймеры,
    карточка клиента, перевод чатов на новую версию, хранилища SQLite и PostgreSQL, `FlowEditor`, `FlowTestChat`, `ClientCardPanel`.
  - **core**: новые точки для расширений — `agent.prepareTurn` (контекст хода с `resumed`, `audience`, `staff?`),
    служебное сообщение `app`, готовый ответ `deliverNotices({ reply })`, `askModel` и `recordUsage`, источник расхода
    `judge`, `ChatService.assertWithinLimit(ownerId, chatId)`; `chatInstructions(chat, turn?)` — второй аргумент с
    `audience` (при сжатии истории его нет).
  - **server**: `chatInstructions` в настройках принимает тот же второй аргумент `turn`.
  - **messengers**: ответ сервера без модели (точный текст по таймеру сценария) теперь доходит до мессенджера.
  - **skin-tandem**: новые входы `/flows` (`tandemFlowEditorSkin`) и `/client-card` (`tandemClientCardSkin`).
  
  ### Как обновить приложение
  
  Сценарии не нужны — обновление ничего не требует. Нужны — шаги в разделе «Как обновить приложение» в `CHANGES.md`:
  `pnpm add @ykurilov/agent-chat-flows`, `createAgentFlow` + `flow.withChat(…)`, `flow.attach(service)`, `flow.start()`,
  `OPENROUTER_API_KEY` на сервере. Тестовому чату нужен `readRun(chatId)` в `FlowTestChatConnection`; его адреса
  закройте правами редактора. `firstMessages: false` теперь значит «без тихих часов и потолка», запрет —
  `canWriteNow: () => false`. Проверка: `pnpm typecheck`, новый чат отвечает по первому состоянию сценария.
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

### Patch Changes

- @ykurilov/agent-chat-core@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [6a2b5d9]
  - @ykurilov/agent-chat-core@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [763f4c5]
  - @ykurilov/agent-chat-core@0.43.0

## 0.42.0

### Minor Changes

- a385276: Публичный чат больше не выдаёт посетителю служебное: модель, провайдера, расход, текст сводки сжатия и закрытые
  ключи состояния. Ничего не ломает: по умолчанию всё как раньше.
  
  - Новое право `modelDetails` в `chatCapabilities` (по умолчанию `true`). `false` убирает из истории и потока ответа
    модель, провайдера и уровень рассуждений чата, `ownerId`, `metadata.modelId`/`providerId`/`usage` у сообщений,
    `providerMetadata`/`callProviderMetadata`/`resultProviderMetadata` у частей и кусков, провайдера у отметки
    `data-step-reset`, текст сводок сжатия (`summary: ""`, `summaryTokens: 0` в истории и `GET …/compactions`) и
    выключает выбор модели (`modelChoice`). То же при переподключении и смене ветки. Хранилище, модель, хуки и лимиты
    получают всё.
  - Опция сервера и службы `modelMenu: ({ userId }) => boolean` закрывает `GET …/models` (403 `action_forbidden`,
    `action: "modelDetails"`): меню чата не знает, право его не закрывает.
  - Тандем рисует разделитель сжатия без текста сводки строкой без кнопки.
  - Опция `privateStateKeys: ["booking"]` — закрытые верхние ключи состояния чата: не уходят ни в историю, ни в поток,
    ни в `state-changed` наблюдения (`useChatState` их не видит). `getChatState`, `onStateChanged`, события и модель
    видят их как обычно. Имя без точки и не на `$`, иначе `TypeError` при создании. Закрытое значение не возвращайте в
    выходе инструмента (его прячет лишь `toolDetails: false`) и в тексте ответа (не прячется никак).
  - Экран запрашивает меню моделей после истории и только если оно нужно: разрешён выбор модели (или вложениям старого
    сервера). История всегда несёт `modelAcceptsImages` — видит ли модель чата картинки.
  
  ### Как обновить приложение
  
  Публичному чату (посетитель без входа) в `server/chat.ts` или где создаётся обработчик. Посетитель — человек со своим
  `userId` от `resolveUser` (например, `visitor:<id сессии из cookie>`); `isVisitor = (userId) => userId.startsWith("visitor:")`.
  `modelDetails: false` прячет и модель, и текст сводок сжатия; `toolDetails: false` сводку не трогает.
  
  ```ts
  createChatHandler({
    // …
    chatCapabilities: ({ userId }) => (isVisitor(userId) ? { modelDetails: false, toolDetails: false, reasoning: false /* , … */ } : {}),
    modelMenu: ({ userId }) => !isVisitor(userId),
    privateStateKeys: ["booking"], // верхние ключи состояния со служебными id
  });
  ```
  
  Свой скин: `CompactionDivider` может получить `summary: ""` (при `modelDetails: false`) — раскрывать нечего, покажите
  только строку.

### Patch Changes

- Updated dependencies [a385276]
  - @ykurilov/agent-chat-core@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [9472fcb]
  - @ykurilov/agent-chat-core@0.41.0

## 0.40.0

### Minor Changes

- 0e7aab3: Наблюдения приложения с формами, без ломающих изменений:
  
  - `useChatState(chatId)` — состояние чата вне `AgentChat` (панель рядом с чатом): те же значения и живые обновления,
    без своих запросов.
  - `onModelChosen` — человек выбрал модель в меню: колбэк `AgentChat` и хук службы (`createChatService`, `createChatServer`).
  - `{ by: "app" }` у `service.deleteChat` и `service.setModel` — сервер приложения действует без прав экрана; адреса HTTP
    проверяют права, как раньше.
  - «Переделать» у приветствия скрыто, а сервер такой запрос отклоняет (`InvalidMessageError`).
  - `recoverInterruptedAnswers({ soleServer: true })` — у единственной копии сервера оборванные ответы прерываются сразу,
    а не через 15–20 с. Только при старте процесса; не с несколькими копиями на одной базе и не в dev-режиме Next.js.
  
  Как обновить: поднять версию, правки не обязательны. Обходные пути можно заменить — см. CHANGES.md «0.40.0».

### Patch Changes

- Updated dependencies [0e7aab3]
  - @ykurilov/agent-chat-core@0.40.0

## 0.39.1

### Patch Changes

- @ykurilov/agent-chat-core@0.39.1

## 0.39.0

### Minor Changes

- 3b90429: Виджеты: `onStateChanged` с причиной `widgetAnswer` после записей `checkAnswer`; `ctx.emitAppEvent` в `checkAnswer`
  (событие вместе с ответом виджета, на странице — живым один раз); `chatId` и `toolCallId` в `CustomWidgetProps`;
  `agent.widgets.enabledFor` — набор виджетов по чату, выключенных модель не видит, их прошлые вызовы идут модели текстом.
  Всё необязательное, ломающих изменений нет. Как обновить приложение — в CHANGES.md, раздел 0.39.0.

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

### Minor Changes

- 3487fb4: Публичному посетителю можно не показывать кухню агента. Новые права в `chatCapabilities`: `reasoning` (мысли модели) и
  `toolDetails` (служебные инструменты). По умолчанию оба `true` — всё как раньше.
  
  - При запрете мысли и вызовы служебных инструментов (вход, выход, запрос подтверждения) не уходят в браузер: ни в историю
    (`GET`, `getHistory`, `peekHistory`, `selectBranch`), ни в поток ответа, ни в повтор кусков после переподключения
    (`GET …/stream`). Из метаданных ответа пропадает `reasoningDurationsMs`, у текста и вызовов — детали рассуждений
    OpenRouter (`providerMetadata.openrouter.reasoning_details`).
  - Модель, хранилище, `afterTurn`, сжатие и поиск по истории получают ответ целиком.
  - Виджеты (`agent.widgets`) и браузерные инструменты видны всегда. Свой инструмент с карточкой на экране пометьте в его
    описании — `metadata: { showOnScreen: true }` (поле AI SDK, модели не уходит). Метка записывается в каждый вызов
    (`toolMetadata`), поэтому работает и для набора инструментов функцией от модели. Вызовы, записанные до пометки, метки
    не имеют и при запрете скрыты.
  
    ```ts
    const showCard = tool({ description: "Карточка тарифа", inputSchema, metadata: { showOnScreen: true }, execute });
    createChatServer({
      agent: { instructions, tools: { show_card: showCard, lookup } },
      chatCapabilities: ({ userId }) => (isVisitor(userId) ? { reasoning: false, toolDetails: false } : {}),
    });
    ```
  
  - Права считаются на того, кто открыл поток, в момент открытия.
  - Вызов, который спросил подтверждения (`needsApproval`), виден сам, без пометки: иначе человек не увидит вопроса и ход
    зависнет. Вызов того же инструмента без вопроса скрыт.
  - Свои тесты, которые сравнивают `capabilities` истории целиком, получат два новых поля `reasoning` и `toolDetails`.
  
  Ломает типы: тип ChatCapabilities получил новые обязательные поля, литералы надо дополнить.
- 3f39081: Подключение к Express и голому `node:http` без своей обёртки: `toNodeListener(handler)` из нового подпути
  `@ykurilov/agent-chat-server/node`. Рядом с `mountChat` (`/hono`) и `createNextRouteHandlers` (`/next`).
  
  ```ts
  import { toNodeListener } from "@ykurilov/agent-chat-server/node";
  
  app.use(toNodeListener(chatHandler)); // Express
  http.createServer(toNodeListener(chatHandler)).listen(3000); // node:http
  ```
  
  - Ответ идёт потоком, по кускам, без буфера; несколько `Set-Cookie` не склеиваются.
  - Разрыв соединения до конца ответа отменяет запрос (`request.signal`) и поток ответа.
  - Тело запроса идёт потоком. Если его уже прочитал разборщик (`express.json()`), уходит `req.body` как есть.
  - Адрес берётся из `req.originalUrl` (монтирование `app.use("/api/chat", …)` его не портит). Адрес вне `basePath` —
    `next()`, без `next` — 404.
  - Адрес строится на базе `http://localhost`, без заголовка Host: кривой Host или адрес — ответ 400, процесс не падает.
  - Ошибка обработчика после разрыва соединения в `next` не уходит.
  
  Если приложение держит свою обёртку `IncomingMessage → Request`, её можно заменить этим вызовом.
- 5f13c74: Поправку к идущему ответу можно запретить правом `steer` в `chatCapabilities`. Раньше `POST …/steer` принимался, даже
  если экран прятал поправку (`steering={false}`). Теперь при `steer: false` сервер отвечает 403
  `{ error: { kind: "action_forbidden", action: "steer", … } }` до любой записи, `service.steer` бросает
  `ActionForbiddenError`, а `<AgentChat>` не предлагает поправку и ждёт конца ответа. По умолчанию право `true`.
  
  ```ts
  chatCapabilities: ({ userId }) => (isVisitor(userId) ? { steer: false, edit: false, regenerate: false, branches: false } : {}),
  ```
  
  Свои тесты, которые сравнивают `capabilities` истории целиком, получат новое поле `steer`.
  
  Ломает типы: тип ChatCapabilities получил новые обязательные поля, литералы надо дополнить.

### Patch Changes

- Updated dependencies [3487fb4]
- Updated dependencies [8c43b86]
- Updated dependencies [6f42418]
- Updated dependencies [5f13c74]
  - @ykurilov/agent-chat-core@0.36.0

## 0.35.0

### Patch Changes

- 6ceee78: Две правки клиента.
  
  - Чат больше не просит `GET {chat}/tasks` у сервера без фоновых задач (раньше — 404 и красная строка в консоли при каждом открытии). История теперь несёт `backgroundTasks: true | false` (сервер знает, подключён ли `background`), клиент при `false` задач не запрашивает. Сервер до этой правки поля не присылает: клиент спрашивает адрес задач, как раньше, поэтому приложения со старым сервером и фоном продолжают работать.
  - Скрытая строка для экранного диктора получает текст ответа без разметки Markdown: заголовки, жирный, курсив, зачёркнутое, код, списки и цитаты без значков, у ссылки остаётся её текст. Звёздочки больше не зачитываются вслух. Обычный текст не трогается: выделение снимается только целыми словами, поэтому «5\*6\*7», «src/\*.ts» и «\_\_init\_\_» остаются; «> 100 000 ₽» — не цитата; решётка в конце снимается только у заголовка.
- Updated dependencies [2382026]
  - @ykurilov/agent-chat-core@0.35.0

## 0.34.0

### Minor Changes

- d039ce4: Поправка на лету: человек пишет агенту, пока тот отвечает, и не ждёт конца ответа и не жмёт «Стоп».
  
  Что это для человека: поле ввода во время ответа свободно, «Стоп» рядом с «Отправить». Поправка сразу видна в ленте с пометкой
  «Агент учтёт на следующем шаге». Агент берёт её после очередных вызовов инструментов и продолжает с её учётом; сделанное до
  поправки остаётся. Ответ кончился раньше — поправка запускает новый ход. Несколько поправок — все, по порядку. «Стоп» поправку
  не теряет. Поправка хранится в базе и видна после обновления страницы.
  
  Новое:
  
  - ядро: `service.steer(userId, chatId, message, { page? })` → `{ status: "queued" | "started", messageId }`; в истории `pendingMessages`
    (ждущие поправки); `isCorrection`, `STEER_PART_TYPE`, тип `SteerResult`; повтор с тем же `message.id` — тот же итог без второй копии;
  - сервер: `POST …/:id/steer` `{ message, place?, tabId? }` → `202`;
  - react: проп `steering` у `AgentChat` (включено, если скин рисует поправки; `false` — выключить), опция `steering` у
    `useAgentChat` (по умолчанию выключено), у него же `canSteer`, `corrections`; надпись `steeringPending`
    (русская по умолчанию, английская в `englishWorkLabels`);
  - договор скина 21: `ChatSkin.steering?`, `Composer.canSteer?`, `UserMessage.pending?` ([docs/skin-v21.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/skin-v21.md));
  - Тандем: во время ответа «Остановить» рядом с «Отправить» в рамке поля, пометка под ждущей поправкой. На узком экране
    кнопка голосового режима на время ответа прячется, чтобы ряд не вылез за край.
  
  ### Как обновить приложение
  
  Обязательных шагов нет: со скином Тандема поправки включаются сами, свой скин и своя лента работают как раньше.
  
  1. Проверьте, что `@ykurilov/agent-chat-server` обновлён вместе с `@ykurilov/agent-chat-react`: старый сервер не знает `POST …/steer`,
     и поправка вернётся в поле с ошибкой.
  2. Свой словарь надписей (полный объект, не поверх `russianLabels`) — добавьте `steeringPending`. Без неё будет русская надпись по умолчанию.
  3. Свой скин: без `steering: true` поле во время ответа занято, как раньше, — поправок у людей не будет. Чтобы были, поддержите
     `Composer.canSteer` и `UserMessage.pending` и поставьте в скин `steering: true` по [docs/skin-v21.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/skin-v21.md).
  4. Своя лента на `useAgentChat`: включите `useAgentChat({ steering: true })`, рисуйте `corrections` после `messages`, пометкой — `steeringPending`.
  5. Несколько копий сервера: поправка принимается копией, на которой идёт ответ (как «Стоп»), иначе `409 busy`. Держите запросы
     одного чата на одной копии.
  6. Не нужно со скином Тандема — `<AgentChat steering={false} />`.
  7. Проверка: `pnpm typecheck`; в чате во время долгого ответа отправьте поправку — она видна с пометкой, затем агент отвечает с её учётом.

### Patch Changes

- Updated dependencies [d039ce4]
  - @ykurilov/agent-chat-core@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [4a72339]
  - @ykurilov/agent-chat-core@0.33.0

## 0.32.0

### Patch Changes

- ac9b7d3: «Стоп» больше не теряется, пока ход ещё запускается. Раньше остановка, нажатая во время проверок перед ходом
  (`beforeTurn`, лимит трат), отвечала «нечего останавливать», а ход потом шёл до конца. Теперь `stop` в это время
  возвращает `true`, и ход останавливается сразу после старта; адрес `/stop` отвечает 202.
  
  Обновление ничего не требует.
- 53c41a8: Поток событий чата (`watch`) снова видит конец фоновых задач, даже если первая сверка с базой упала. Раньше после
  такого сбоя сверка больше не запускалась до переподключения вкладки.
  
  Обновление ничего не требует.
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

### Minor Changes

- d63ccaa: Ломает приложения: закрытие чата теперь запись на ветке, а не флаг навсегда. Человек исправил сообщение до точки
  закрытия, нажал «Переделать» или перешёл на другую ветку — на новой ветке чат открыт. Вернулся стрелкой назад — снова
  закрыт. Отправка, «Повторить», подтверждения и виджеты в закрытом чате по-прежнему запрещены (409 `chat_closed`).
  
  Плюс приложение узнаёт о смене состояния чата (`model.state`): на сервере — хук, на экране — проп и хук React.
  
  - **Сервер:** `onStateChanged({ ownerId, chatId, reason, state, previousState, atMessageId })` у `createChatServer` и
    `createChatService`. Зовётся после хода и смены ветки (`reason`: `turn`, `editMessage`, `regenerate`, `retry`,
    `selectBranch`, `editAnswer`), только если состояние сменилось. Ход его не ждёт. Вызовы одного чата — по очереди.
    Сбой — повторы (`onStateChangedAttempts`, 3) в сроке (`onStateChangedTimeoutMs`, 30 000), потом строка в `logError`.
    Доставка только пока сервер жив: упал между ответом и хуком — хук не позовётся, сверяйте по `getChatState`.
  - **События:** `state-changed` `{ chatId, reason, state, atMessageId }` (вкладка получает через `watch`) и
    `state-changed-failed`. `chat-closed` и `chat-reopened` теперь приходят и при смене ветки.
  - **Экран:** `<AgentChat onStateChange={(state) => …} />` — после загрузки и при каждой смене, в том числе по ходу
    ответа и из другой вкладки (событие `state-changed`). Внутри ленты — `useChatState()`, у `useAgentChat` — `chatState`. Тип `ChatStateValues`.
  - **Ответ сохраняется в базу сразу после итога каждого инструмента**, а не раз в полсекунды: запись состояния
    переживает падение сервера. Промежуточные результаты (`preliminary`) — по-прежнему раз в полсекунды.
  - **Служебные ключи** состояния (`$…`) больше не уходят в браузер: ни в истории, ни в потоке ответа.
  - **`getChatState` дешёвый:** читает только связи сообщений и записи состояния. SQLite и Postgres получили метод
    `listMessagePartsOfTypes(chatId, types)`. Новых таблиц и миграций нет.
  - **Колонка `closed`** в записи чата — копия закрытия текущей ветки для `listChats`. `chatCapabilities` (`chat.closed`)
    и история берут закрытие с ветки. Не записалась копия — её дописывает следующее открытие истории.
  - **Чаты, закрытые в 0.27,** остаются закрытыми. Перенос в запись ленивый, без миграции: запись появится при первой
    правке, «Переделать», выборе ветки или правке ответа в этом чате.
  - Ядро экспортирует `CLOSED_STATE_KEY`, `isStateMessage`, `publicAppStateParts`, `DEFAULT_STATE_CHANGED_ATTEMPTS`,
    `DEFAULT_STATE_CHANGED_TIMEOUT_MS`, типы `StateChangedHandler`, `StateChangedInput`, `StateChangeReason`,
    `MessagePartsLink`.
  
  ### Как обновить приложение
  
  1. **Закрытие должно быть навсегда** (нельзя уйти правкой или веткой): в настройках сервера (`createChatServer`)
     добавьте права по закрытию.
  
     Было: ничего.
  
     Стало:
  
     ```ts
     chatCapabilities: ({ chat }) =>
       chat.closed ? { edit: false, regenerate: false, branches: false, answerEditing: false } : {},
     ```
  
     Если `chatCapabilities` уже есть — допишите эту ветку в него. Если правка до закрытия вам подходит — шаг пропустите.
  2. **`switch` по событиям чата** (`ChatEvent`, `service.events`) с проверкой полноты (`never`): добавьте ветки
     `state-changed` и `state-changed-failed`.
  3. **Своё хранилище** (не SQLite и не Postgres): ничего не обязательно. Для дешёвого чтения состояния добавьте
     `listMessagePartsOfTypes(chatId, types)` → `[{ id, parentId, createdAt, parts }]` в порядке `listMessages`, только
     части нужных типов. Общие тесты хранилища проверят его, флаг `partsOfTypes: "required"` делает его обязательным.
     `setChatClosed` теперь пишет только копию для списка: без него закрытие работает, но список его не видит.
  4. **Своя реализация `ChatService`** (заглушки в тестах): полей не прибавилось. Если вы проверяли, что правка или
     «Переделать» в закрытом чате дают `ChatClosedError`, — теперь они идут.
  5. **Таблица-копия состояния** (по желанию): `onStateChanged` с полной заменой записи —
     `await db.upsertForm({ chatId, fields: state.fields ?? {} })`.
  6. Проверка: `pnpm typecheck`; закройте чат инструментом, исправьте вопрос до закрытия — без шага 1 чат открыт, с
     шагом 1 правка недоступна.
- 189cba9: Проверка ответа виджета на сервере. Раньше ответ проверялся только схемой. Теперь приложение может проверить его с
  доступом к своей базе («это время уже заняли»), отказать человеку своими словами, подменить ответ и записать состояние чата.
  
  ```ts
  agent: {
    widgets: {
      custom: [
        {
          ...pickSlot, // виджет из общего файла; проверка — только на сервере
          checkAnswer: async (answer, ctx) => {
            const hold = await bookings.tryHold({ key: ctx.toolCallId, chatId: ctx.chatId, start: answer.slot });
            if (!hold) return { refuse: "Это время уже заняли. Выберите другое." }; // виджет остаётся открытым
            ctx.state.set("booking.holdId", hold.id); // ляжет в ответ вместе с результатом виджета
            return { answer: { ...answer, holdId: hold.id } }; // подмена ответа; можно вернуть и undefined — принять как есть
          },
        },
      ],
    },
  }
  ```
  
  - Проверка зовётся после схемы, пока чат удержан за этим ответом. `ctx`: `ownerId`, `chatId`, `messageId`, `toolName`,
    `toolCallId`, `input`, `subject?`, `chatData?`, `state` (запись, как `model.state`), `signal` (`AbortSignal`). Исходы: `undefined` — принять,
    `{ answer }` — принять с заменой (её видят модель и экран; до 16 КБ, схемой не перепроверяется), `{ refuse }` — отказать
    текстом до 300 знаков.
  - Общая проверка для всех виджетов без своей, в том числе базовых (`ask_choice` и др.):
    `agent.widgets.checkAnswer(call, answer, ctx)`, где `call` — `{ toolName, toolCallId, input }`.
  - Отказ: служба бросает `WidgetAnswerRefusedError`, сервер отвечает `409 { error: { kind: "widget_answer_refused", code,
    message } }` (новый вид в `HandlerErrorKind`), экран показывает текст под виджетом и оставляет виджет открытым; поле ввода и
    `onTurnRefused` не трогает. Ничего не записано, повтор ответа возможен.
  - Записи `ctx.state` принятого ответа ложатся частями `data-app-state` вместе с результатом виджета; отказ и исключение их
    отбрасывают. `getChatState` и следующий ход видят их.
  - Исключение проверки — ответ 500, ничего не записано, виджет открыт, в `logError` строка
    `[виджет] ошибка проверки чат=… вызов=…` с именем ошибки, без её текста.
  - Срок проверки (`agent.widgets.checkAnswerTimeoutMs`, по умолчанию 5 000 мс) — не сбой: служба бросает
    `WidgetAnswerCheckTimeoutError`, сервер отвечает `504 { error: { kind: "widget_check_timeout", code, message } }` (новый вид
    в `HandlerErrorKind`), ничего не записано, виджет открыт, в журнале строка `[виджет] отказ answer_check_timeout …`, а не
    ошибка. Страница показывает под виджетом новую подпись `widgets.answerCheckTimeout` («Не удалось проверить ответ,
    попробуйте ещё раз»; её можно переопределить в `labels`), у `WidgetFailureKind` новый вид `check_timeout`. Зависшая
    проверка не держит чат занятым. Срок проверки держите заметно меньше `requestTimeoutMs` страницы (10 000 мс).
  - `ctx.signal` (`AbortSignal`) срабатывает по сроку проверки и по «Стопу» в чате. После отмены служба ничего не пишет,
    виджет остаётся открытым, но остановить работу приложения она не может: слушайте сигнал сами
    (`fetch(url, { signal: ctx.signal })`). «Стоп» во время проверки — не сбой: служба бросает новую
    `WidgetAnswerCheckAbortedError`, сервер отвечает `409 { error: { kind: "widget_answer_cancelled", code, message } }`
    (новый вид в `HandlerErrorKind`), в журнале строка `[виджет] отказ answer_cancelled …`, страница тихо оставляет виджет
    открытым, без надписи под ним.
  - Чат закрыли (`closeChat`) во время проверки: ответ не пишется, служба бросает `ChatClosedError`, ждущий виджет закрывается
    отказом, как при обычном закрытии.
  - Для React: у `WidgetFailureKind` новый вид `answer_refused` (текст отказа в `text`). Скины, которые перебирают виды отказа
    полным `switch`, добавляют ветку; готовый скин и `AgentChat` ничего не требуют.
  - Без `checkAnswer` запрос к модели, хранилище и ответы сервера прежние.
  
  Обновление ничего не требует. Если приложение разбирает ответы сервера полным `switch` по `HandlerErrorKind`, добавьте
  `widget_answer_refused`, `widget_answer_cancelled` и `widget_check_timeout`. Подробности и пример — `docs/widgets.md`, раздел «Проверка ответа на сервере».

### Patch Changes

- Updated dependencies [11c3c97]
- Updated dependencies [d63ccaa]
- Updated dependencies [6a2f903]
- Updated dependencies [189cba9]
  - @ykurilov/agent-chat-core@0.28.0

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

## 0.26.2

### Patch Changes

- Updated dependencies [f24858a]
  - @ykurilov/agent-chat-core@0.26.2

## 0.26.1

### Patch Changes

- @ykurilov/agent-chat-core@0.26.1

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

## 0.25.0

### Minor Changes

- 99d426e: Приветствие по указанию: `greeting: { instruction }` в `createChat`, `openSubjectChat` и ответе `subjectChats`. При
  создании чата SDK один раз будит агента служебным сообщением `conversation_started`, и агент пишет первым сам. Ровно одно
  из `text` и `instruction`. Найденный чат не будится; сбой побудки — в `logError`, чат всё равно отдаётся.

### Patch Changes

- Updated dependencies [99d426e]
- Updated dependencies [d8201f6]
  - @ykurilov/agent-chat-core@0.25.0

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

- fd16b01: Помощники, фоновые задачи и мессенджеры. Ничего не ломается: без новых настроек всё работает как раньше.
  
  - `agent.helpers` в `createChatHandler` / `createChatServer`: узкие агенты со своей моделью и инструментами; основной агент зовёт их как `helper_<имя>` и получает только итог. Человек видит все шаги помощника. Подробности: `docs/helpers.md`.
  - `background` в `createChatHandler` / `createChatServer` принимает объект из нового пакета `@ykurilov/agent-chat-background`; тогда появляются адреса `{base}/:chatId/tasks` (список, отмена, ответ на подтверждение). Помощник с `background: true` без этого пакета — ошибка при запуске.
  - `createChat(…, { origin })` помечает чат, созданный из мессенджера (`telegram`, `vk`, `max`); пометка видна в списке чатов.
  
  Что сделать в приложении: ничего обязательного. Хотите помощников — добавьте `agent.helpers`. Хотите фон или мессенджеры — поставьте новые пакеты `@ykurilov/agent-chat-background` и `@ykurilov/agent-chat-messengers` (см. их README).

### Patch Changes

- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-core@0.20.0

## 0.19.0

### Minor Changes

- aa0fd51: Гибкие лимиты расходов. Вместо одного бюджета на месяц можно задать любой набор окон сразу: сутки, неделю или месяц по
  часовому поясу (со своим днём начала недели), «N часов от первого запроса» или на всё время. Область окна — человек, чат или
  весь сервис. Ход начинается, только если не исчерпано ни одно окно.
  
  - `createSpendingLimits({ windows: [...] })` вместо `budget` и `period`. Прежний `budget` работает как раньше (и получил
    `period: "week"`).
  - `carryOverrun: true` у окна: перерасход начатого хода переносится в начало следующего окна.
  - `turn: { minRemainingUsd, maxCostUsd, maxToolCalls, overrun }` — запас на старт хода и потолки одного хода. На потолке
    ход заканчивается итогом без новых вызовов инструментов.
  - Человеку: свой лимит окна, блокировка (`setUserSettings`, `getUserSettings`) и ручной сброс окна (`resetWindow`).
  - `onThreshold(event)` — событие при 80% и 100% лимита окна (пороги — `thresholds`), одно на порог в окне, проверка после
    каждой записи расхода.
  - `getSpending` отдаёт доллары по каждому окну (`windows`) и `blocked`.
  - Сервер: в ответе 429 `spending_limit_reached` появились `reason` (`limit` | `blocked` | `reserve`), `windowId` и `hours`.
    `GET …/spending` отдаёт `reason`, `windowId`, `hours`, `blocked` и список окон `windows` — только доли и время сброса,
    без долларов.
  - Браузер: надписи «на неделю», «на 5 ч» (с временем обновления), «сервиса», «Лимита … не хватит на новый ответ», «Новые
    ответы для вас приостановлены». В `SpendingInfo` новые необязательные поля `hours`, `reason`, `windowId`, `windows`.
  
  Скользящим окнам, личным настройкам, сбросу и порогам нужны методы состояния хранилища: в памяти, SQLite и PostgreSQL они есть
  (запись `storage-limit-state`). Подробно — README пакета `@ykurilov/agent-chat-limits`, раздел «Окна лимитов».
  
  **Ломает приложения:** только исчерпывающие проверки и свои словари по периоду. У `SpendingScope` появилось значение
  `service`, у `SpendingPeriod` — `week` и `rolling` (в `@ykurilov/agent-chat-core` и `@ykurilov/agent-chat-react`).
  
  ### Как обновить приложение
  
  1. Поищите в приложении `SpendingPeriod`, `SpendingScope`, `info.period`, `info.scope` и `spendingWarning` / `spendingExhausted`
     в своём словаре надписей. Если надпись строится по таблице периодов, добавьте новые значения:
  
     Было:
  
     ```ts
     const periodPhrase = { month: " на месяц", day: " на день", none: "" };
     ```
  
     Стало:
  
     ```ts
     const periodPhrase = { month: " на месяц", week: " на неделю", day: " на день", none: "" };
     const phrase = info.period === "rolling" ? ` на ${info.hours} ч` : periodPhrase[info.period];
     ```
  
     То же для области: `info.scope === "service"` — лимит всего сервиса.
  2. Свой словарь с `spendingExhausted`: учтите `info.reason` — `"blocked"` (человек заблокирован, `resetsAt` нет) и `"reserve"`
     (остаток меньше запаса на старт хода).
  3. Свой разбор ответа 429 или `GET …/spending` на сервере или в браузере: новые поля необязательные, старые на месте.
  4. Ничего из этого нет в приложении — обновление ничего не требует.
  5. Проверка: `pnpm typecheck` проходит; с исчерпанным лимитом чат показывает надпись и не даёт отправить сообщение.
- 05e258b: Сервер сообщает приложению, что ход агента закончен: необязательный `onTurnFinished` в настройках `createChatHandler`
  (и `createChatService`) получает `{ userId, chatId, messageId, status, modelId, providerId }` один раз на ход при любом
  итоге — законченном, остановленном, с ошибкой, прерванном или ждущем человека. Итог к этому мигу уже записан. Ход
  обработчик не ждёт; если обработчик бросил или его обещание отклонено, ответ не ломается, сбой уходит в `logError`.
  Тип — `TurnFinished` из `@ykurilov/agent-chat-core`. Без `onTurnFinished` всё как раньше.

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

## 0.17.0

### Patch Changes

- @ykurilov/agent-chat-core@0.17.0

## 0.16.0

### Minor Changes

- cf52f10: **Ломает только исчерпывающие проверки:** у `UsageSource` появилось значение `images`, у видов ошибок сервера — `widget_not_pending` и `invalid_answer`, у `ChatService` — метод `answerWidget`. Своё хранилище должно поддержать условную запись `AwaitingMessagePatch.expectedParts` (при несовпадении частей — `MessageNotAwaitingError`; помощник `sameMessageParts` из core), иначе две копии сервера могут затереть ответы друг друга; общие тесты хранилищ это проверяют. Остальное необязательно, приложение без правок работает как раньше.
  
  Что нового: агент может спросить кнопками, звёздами или формой (виджеты), нарисовать схему блоком ` ```mermaid ` и создать картинки через Runware. Всё включается отдельно:
  
  - виджеты: `agent: { widgets: { basic: true, custom: [свойВиджет] } }`, свой виджет — `defineWidget` из core и компонент в `widgets={{ … }}` у `AgentChat`; ответ человека идёт на `POST /:chatId/widgets/:toolCallId`, ход ждёт со статусом `awaiting_approval`;
  - схемы: новый пакет `@ykurilov/agent-chat-diagrams`, `agent: { diagrams: true }` на сервере и `diagrams={diagramsClient}` на странице;
  - картинки: новый пакет `@ykurilov/agent-chat-images` (нужен пакет вложений и `RUNWARE_API_KEY`), `images.tools(model)` в `agent.tools`, `images={imagesClient}` на странице; свой срок ожидания (210 с) инструмент сообщает ядру сам (`declareToolTimeout`), расход бронируется до заказа (`assertWithinLimit({ pendingUsd })`);
  - окно просмотра картинок и схем: Тандем готов, своему скину — необязательные части договора версии 13 (`Widget`, `SuggestedReplies`, `GeneratedImages`, `MediaViewer`, `diagramColors`, `renderDiagram`). `splitMermaidBlocks` экспортируется из react;
  - вложения: `Attachments.storage` и `detectFileKind` экспортируются из пакета вложений;
  - голосовой режим произносит вопрос и варианты ждущего виджета и говорит «схема на экране» вместо блока схемы;
  - «Стоп» на экране закрывает висящие вызовы так же, как сервер, разрешённые без результата — «результат неизвестен» (`stoppedToolCallReasons.resultUnknown`);
  - упавший свой виджет страницы заменяется запасным видом скина, лента цела.
  
  Подробно: `docs/widgets.md`, `docs/diagrams.md`, `docs/images.md`, `docs/media-viewer.md`.
  
  ### Как обновить приложение
  
  Обычному приложению на SQLite или PostgreSQL из набора делать ничего не нужно: миграций нет, всё новое включается отдельно.
  
  1. Исчерпывающий `switch` по `UsageSource` — добавьте ветку `"images"`; по видам ошибок сервера — `"widget_not_pending"` и `"invalid_answer"`.
  2. Своя реализация `ChatService` — добавьте метод `answerWidget({ chatId, ownerId, toolCallId, answer, page }): Promise<{ resumed: boolean }>` (тип `WidgetAnswerRequest` из core, образец — служба из core).
  3. Своё хранилище: `updateAwaitingMessage` получает необязательное поле `expectedParts`. Если оно есть и части сообщения в базе с ним не совпадают (`sameMessageParts` из core), бросайте `MessageNotAwaitingError`; проверку и запись делайте в одной транзакции. Прогоните общие тесты хранилищ из core.
  4. Своя обёртка `assertWithinLimit` из limits — пробрасывайте новое необязательное поле `pendingUsd`.
  5. Проверка: `pnpm typecheck`, затем в чате отправить сообщение и получить ответ.

### Patch Changes

- Updated dependencies [cf52f10]
  - @ykurilov/agent-chat-core@0.16.0

## 0.15.0

### Minor Changes

- f05ad23: Часовой пояс для лимитов расходов: `createSpendingLimits({ timeZone: "Europe/Moscow" })`. Сутки и месяцы режутся
  по полуночи этого пояса, а не по UTC (раньше московский суточный лимит обнулялся в 03:00). Переход на летнее время
  учтён: сутки бывают 23 и 25 часов. Для сегодняшней даты агента этот пояс только запасной: главнее пояс браузера
  человека, а пояс лимитов берётся, когда браузер свой пояс не прислал. Дата обновления лимита на экране — по поясу лимитов. Пояс не из базы IANA — ошибка при старте.
  
  Новое: `timeZone` в настройках лимитов и необязательное поле `timeZone` у `SpendingLimits`, `SpendingStatus`,
  `SpendingLimitReachedError`, `SpendingReport` и `SpendingInfo` (экран); ответы `GET …/spending` и отказ 429 получают
  `timeZone`, если пояс задан. Ядро экспортирует `resolveTimeZone`.
  
  ### Как обновить приложение
  
  Ничего делать не нужно: без `timeZone` лимиты по UTC, дата агента по поясу человека или сервера, как раньше.
  
  Чтобы считать сутки по Москве, в файле, где создаются лимиты:
  
  ```ts
  const limits = createSpendingLimits({ storage, catalog, budget, period: "day", timeZone: "Europe/Moscow" });
  ```
  
  `agent.timeZone` после этого задавать не нужно. Если он уже задан, он должен совпадать с поясом лимитов (другое имя того же пояса
  вроде `Asia/Calcutta` и `Asia/Kolkata` — совпадение), иначе
  служба чата не создастся (ошибка называет оба пояса). Свои надписи `spendingExhausted`, которые сами форматируют
  `resetsAt`, могут брать пояс из `info.timeZone`. Проверка: `limits.getSpending({ userId })` отдаёт `periodStart`
  вида `…T21:00:00.000Z` (полночь по Москве).

### Patch Changes

- Updated dependencies [f05ad23]
- Updated dependencies [f05ad23]
  - @ykurilov/agent-chat-core@0.15.0

## 0.14.0

### Minor Changes

- 4f33e85: Браузерные инструменты: агент делает действие на странице человека — например, открывает карточку задачи. Приложение описывает их общим модулем через `tool({ description, inputSchema })` без `execute` и подключает на сервере `agent.browserTools`, а на странице — функции с теми же именами в `browserTools` у `AgentPanelProvider`. Когда модель зовёт такой инструмент, сервер шлёт временный кусок `data-browser-call` той вкладке, с которой пришёл ход, и ждёт ответа `POST {base}/:chatId/browser-tools/:toolCallId` (`{ tabId, output }` или `{ tabId, error }`, `204`; тело больше 64 КБ — `400 invalid`, дальше не читается). Результат уходит модели, ошибка — строкой «ошибка» с её текстом, ход продолжается. Срок ответа — `agent.browserToolTimeoutMs` (по умолчанию 30 с, от 1 с до 2³¹−1 мс), после него — «Страница не ответила за N с»; «стоп» и удаление чата снимают ожидание. Без вкладки — «Действие на экране недоступно: страница не подключена». Результат больше 16 КБ — «Слишком большой результат», ошибка обрезается до 1000 знаков, пустой результат — «готово». «Спросить разрешения» работает как у обычных инструментов: функция зовётся только после «Разрешить». Ответ чужой вкладки, повторный и поздний — `409 not_pending` (`BrowserCallNotPendingError` в ядре, новый вид `not_pending` у `HandlerErrorKind`). Описание с `execute` или имя, совпавшее с инструментом приложения или памяти, — ошибка при создании службы. Вкладка исполняет каждый вызов чата один раз, в том числе после перезагрузки. Ожидание живёт в памяти процесса: как и продолжение ответа, работает на одном сервере.
  
  **Ломает приложения** только там, где сами реализуют интерфейс `ChatService` (например, поддельная служба в тестах): в него добавился метод `answerBrowserCall`.
- 062ce36: Человек, чат и место на экране для инструментов агента. Функция `agent.tools(model)` получает в `model` не только `ownerId` и `chatId`, но и `place` — где сейчас человек в приложении (`{ description, data? }` или `null`); функция зовётся раз на ход, поэтому два человека одновременно не путаются. Место уходит с каждым запросом хода (отправка, правка, повтор, переделка, ответ на подтверждение) полями `place` и `tabId` в теле, а модель видит его отдельной частью в самом конце последнего сообщения человека (после пометки режима и блока памяти). В историю чата и в сжатие место не пишется, инструкция и описания инструментов не меняются, поэтому кэш модели цел. Описание длиннее `agent.placeMaxLength` (по умолчанию 1000, не меньше 100) обрезается с «…», данные больше 4 КБ отбрасываются, обе обрезки пишутся в журнал сервера без текста. Неверная форма `place` или `tabId` — `400 invalid`, ничего не записано. В службе чата у `sendMessage` и `editMessage` в `options` появилось `page`, у `retry`, `regenerate` и `answerApproval` — последний аргумент `page` (`TurnRequestContext`). `useAgentChat` с `appBridge` кладёт `tabId` и текущее место в тела всех пяти запросов; без моста тела прежние. Старые приложения работают без изменений. **Ломает** только код, который сам собирает объект `AgentToolsModel` (например, тесты инструментов): в него добавилось обязательное поле `place` (`null`, если места нет); функции `tools(model)` приложений ничего менять не нужно.
- 656233a: Долгая память агента. Агент сам запоминает устойчивое о человеке (предпочтения, правила общения, факты о работе) и помнит это в новых чатах. В новом пакете `@ykurilov/agent-chat-memory` лежат инструмент `manage_memory`, правила записей и блок памяти для запроса. Человек видит записи на экране памяти: может добавить, исправить, удалить запись или стереть всю память. Записи у каждого человека свои, удаление чата их не трогает. Раз в сутки после ответа та же модель предлагает слить повторные записи (опция `optimizer`); код проверяет группы и применяет годные, на экране появляется раздел «Объединено» с кнопкой «Вернуть как было». Отрицание не теряется («не любит кофе» не склеивается с «любит кофе»). После сбоев проверка ждёт дольше: час, 6 часов, сутки. Пределы записей и дубли держатся при одновременных действиях (замок на человека, а в SQLite и PostgreSQL ещё и проверка внутри транзакции), в том числе при возврате склейки. Память не меняет начало запроса к модели, поэтому кэш модели сохраняется.
  
  **Ломает приложения** только с полным словарём надписей `ChatLabels`, написанным вручную (шаг 5): в него добавились надписи `memory…`. Остальным обновление ничего не ломает: без опции `memory` чат работает как раньше. Чтобы включить память, выполните шаги ниже. Новые адреса: `/api/chat/memory/merges` и `/api/chat/memory/merges/:runId/revert`. Миграции SQLite `0009` и `0010` и PostgreSQL `0008` и `0009` применяются сами при открытии базы (`0010` и `0009` — задел под склейку повторов записей).
  
  ### Как обновить приложение
  
  1. **Включить память на сервере** (по желанию). Пакет ставится отдельно: `pnpm add @ykurilov/agent-chat-memory`. В файле, где создаётся `createChatHandler`:
  
     Было:
  
     ```ts
     createChatHandler({ basePath: "/api/chat", storage, resolveUser /* … */ });
     ```
  
     Стало:
  
     ```ts
     import { createLongTermMemory } from "@ykurilov/agent-chat-memory";
  
     createChatHandler({ basePath: "/api/chat", storage, resolveUser, memory: createLongTermMemory({ storage }) /* … */ });
     ```
  
     Инструкция агента и инструмент `manage_memory` добавляются сами: в `agent.instructions` и `agent.tools` ничего дописывать не нужно. Имя `manage_memory` занято: своего инструмента с таким именем быть не должно (иначе ошибка при создании). Адреса `/api/chat/memory` появляются сами. Без `memory` они отвечают `404`.
  2. **Подключить экран памяти** (по желанию). Найдите страницу, куда его поставить, и добавьте компонент; `createMemoryApi` вызывайте один раз (например, в `useMemo`):
  
     ```tsx
     import { AgentMemory, createMemoryApi } from "@ykurilov/agent-chat-react";
     import { tandemMemorySkin } from "@ykurilov/agent-chat-skin-tandem";
  
     const memoryApi = useMemo(() => createMemoryApi({ api: "/api/chat" }), []);
     <AgentMemory api={memoryApi} skin={tandemMemorySkin} />
     ```
  3. **Подпись вызова в ленте.** Было: `labels={russianLabels}`. Стало: `labels={withMemoryToolTitles(russianLabels)}`, где `withMemoryToolTitles` — из `@ykurilov/agent-chat-memory/labels`. Вместо `manage_memory` в ленте будет «Работа с памятью».
  4. **Свой скин (договор скина версии 11).** `ChatSkin` и `ChatListSkin` не менялись. Экрану памяти нужен отдельный `MemorySkin` из пяти компонентов (`MemoryScreen`, `MemoryGroup`, `MemoryNoteRow`, `MemoryNoteEditor`, `MemoryConfirm`). Скин Тандема даёт его готовым: `tandemMemorySkin`. Описание — `docs/contracts/long-term-memory/memory.md`, раздел 5.
  5. **Полный словарь надписей.** Если приложение задаёт объект `ChatLabels` целиком, а не `{ ...russianLabels, … }`, добавьте новые надписи: все ключи, которые начинаются с `memory` (`memoryHeading`, `memoryAdd`, `memoryClearAll` и другие, полный список — тип `ChatLabels` в `@ykurilov/agent-chat-react`). Без этого `pnpm typecheck` не пройдёт.
  6. **Своё хранилище.** Нужно только при включённой памяти. В своей реализации `ChatStorage` добавьте пять необязательных методов: `listMemoryNotes`, `insertMemoryNotes`, `updateMemoryNote`, `deleteMemoryNote`, `clearMemoryNotes`. Сигнатуры — в `ChatStorage` пакета core и в `packages/storage-sqlite/src/sqlite-storage.ts`. Без них `createLongTermMemory` остановится с ошибкой `MemoryStorageNotSupportedError` и списком недостающих методов. Для склейки повторов нужны ещё шесть методов (`claimMemoryOptimizationRun`, `finishMemoryOptimizationRun`, `applyMemoryMerge`, `revertMemoryMerge`, `listMemoryOptimizationRuns`, `listMergedMemoryNotes`); без них склейка выключена. Чтобы пределы держались при нескольких серверах, добавьте необязательные `insertMemoryNotesChecked` и `updateMemoryNoteChecked`. Общие тесты `describeChatStorageContract` проверят их сами.
  7. **Проверка.** `pnpm typecheck` и сборка проходят. Напишите агенту «Запомни, что я пишу на TypeScript», откройте экран памяти: там запись в разделе, который выбрал агент. В новом чате спросите, что он про вас знает.
- aba59fe: Цикл агента и учёт расхода крепче (022, этап 8). Когда шаги хода кончаются, последний запрос идёт без инструментов (счёт по шагам всего хода, ход из одного шага не ограничивается) и с пометкой «подведи итог» в самом конце: ход кончается сводкой для человека, а не обрывом на вызове. Новая настройка `agent.sequentialTools` (`true` или список имён) пускает инструменты с последствиями по одному: «спиши деньги» не пойдёт одновременно с другим таким вызовом; очередь одна на чат (во всех ходах и повторах), ожидание очереди не съедает срок инструмента, «Стоп» отменяет ждущий вызов, и модель видит, что он не запускался. Оборванный вызов инструмента теперь говорит модели, что действие могло выполниться частично, и показывает последний промежуточный вывод. Ответ, упёршийся в предел длины, получает отметку: человек видит надпись «Ответ оборван по длине» (`labels.answerCutByLength`, в скине — `AgentMessage.cutByLength`), модель в следующих ходах видит пометку в конце своего ответа. Ответ из одних рассуждений (например, «Стоп» на рассуждении) больше не идёт в запрос, а сообщения человека, оказавшиеся подряд, склеиваются в одно (строгие провайдеры не принимают два подряд). Сегодняшняя дата словами идёт в конце последнего сообщения человека, только в запросе — начало запроса не меняется, кэш цел. Дата берётся по часовому поясу человека: браузер шлёт свой пояс (`timeZone`) с каждым запросом хода, сервер берёт только настоящий пояс IANA, иначе — новая настройка `agent.timeZone`, без неё — пояс сервера. Ни один ответ больше не бесплатен в журнале расхода: шаг, оборванный «Стопом» или сбоем после первых слов, и шаг, по которому провайдер не прислал числа, прикидываются по длине текста с учётом письма (кириллица, JSON и иероглифы плотнее латиницы; прикидка скорее завышает), а ответ, оборванный перезапуском сервера, записывается при следующем запуске (`recoverInterruptedAnswers`): только то, чего ещё нет в журнале, поэтому сбой после «Разрешить» не задваивает расход. Такие записи и итог ответа помечены «примерно» (`estimated`). В SQLite и PostgreSQL у записей расхода новая колонка `estimated`: миграция применяется сама при открытии хранилища. Своим хранилищам менять ничего не нужно: без колонки теряется только пометка. Фильтр `sumUsage` получил поля `messageId` и `source`: свои хранилища должны их учитывать (общие тесты `describeChatStorageContract` это проверяют).
- 47a56ac: Ход больше не висит вечно (022, этап 6б). Серверный инструмент, который не ответил за 2 минуты, получает отмену через `abortSignal`, а модель видит ошибку «Инструмент не ответил за 120 с и отменён. Выполнено ли действие, неизвестно; не повторяй его, не проверив» и дописывает ход. Срок — настройка `agent.toolTimeoutMs` (по умолчанию 120 000 мс, 0 или `Infinity` — без предела), свой срок отдельного инструмента — `{ default?, byTool? }`, как у `toolResultMaxLength`: например, `{ byTool: { ask_user: 0 } }` для инструмента, который сам ждёт ответа человека. Инструменты с подтверждением ждут «Разрешить» без срока, срок идёт с запуска. Браузерные инструменты живут по своим 30 с, как раньше. Сроки молчания потока модели стали настройкой `agent.modelSilenceTimeout`: до первого куска ответа теперь 90 с вместо 60 (модели с долгими рассуждениями и длинным контекстом успевают ответить), между кусками — 120 с, как было; `false` — без предела. Молчание до первого куска повторяется у того же провайдера только один раз, затем — запасной провайдер, а без него ошибка: лёгший провайдер держит ход около 3 минут. Молчание посреди ответа идёт в автопродолжение. Время работы инструмента молчанием модели не считается. После срабатывания любого предела место хода освобождается, «Стоп» работает как раньше, запрос к модели не меняется — кэш цел. Журнал сервера: `[инструмент не ответил] чат=… инструмент=… срок=…мс` и `[молчание модели] … ждали=первый-кусок|следующий-кусок срок=…мс`. Приложению ничего менять не нужно; неверное значение настройки — ошибка при создании службы.
- f9b6162: Предел одновременных ответов одного человека. Проверка лимита расходов не резервирует деньги, поэтому 20 ходов, начатых разом, могли вместе потратить в разы больше бюджета. **Меняется поведение по умолчанию:** у человека одновременно идут не больше трёх ответов во всех его чатах; лишний ход (отправка, повтор, переделка, правка, продолжение после «Разрешить») получает `429 { error: { kind: "too_many_turns", limit } }` до любых записей. Настройка `maxConcurrentTurnsPerUser` у `createChatHandler` и `createChatService` (целое от 1 или `Infinity` — без предела; иначе ошибка при создании); ядро экспортирует `TooManyTurnsError` и `DEFAULT_MAX_CONCURRENT_TURNS_PER_USER`. Клиент показывает «Уже идут ответы в других чатах…», текст возвращается в поле, без «Нет связи». Заодно истёкший вход (401) клиент показывает как «Вход истёк. Войдите снова» с «Повторить», а не как «Нет связи» или «Что-то пошло не так», и не делает попыток переподключения. Новое: `useAgentChat().refusal`, тип `ChatRefusal`, тип `ErrorNoticeKind` (`ErrorNotice` скина получает и `signed_out`, `too_many_turns`), надписи `labels.errors.signed_out`, `labels.errors.too_many_turns`, `labels.editErrors.signedOut`, `labels.editErrors.tooManyTurns`, `labels.approvalTooManyTurns`; причины отказа правки `signed_out` и `too_many_turns`. Свой словарь целиком, без `{ ...russianLabels }`, — добавьте эти ключи.
- f9b6162: Защита от запросов с чужих страниц. Браузер прикладывает куки человека и к запросу, который отправила чужая страница (обычная HTML-форма, WebSocket), поэтому раньше чужой сайт мог от имени человека записать «факт» в память, создать чат, начать ход или открыть голос. **Меняется поведение по умолчанию:** запрос, который меняет данные (не GET), с чужой страницы получает `403 { error: { kind: "forbidden_origin" } }` до входа и любых записей; подъём WebSocket голоса (`createVoiceRelay`, голосовой режим) проверяется так же, хотя это GET; временный ключ `createVoiceHandler` чужой странице не выдаётся; голосовой режим (`mountDialogRelay`) без `allowedOrigins` больше не пропускает чужие страницы. Свой сайт (`Sec-Fetch-Site: same-origin` или Origin совпадает с `Host` / `X-Forwarded-Host`) и запросы не из браузера проходят как раньше. Чат на чужом сайте, который шлёт запросы прямо оттуда (например, GetCourse), — новая настройка `allowedOrigins: ["https://school.getcourse.ru"]` у `createChatHandler`, `createVoiceRelay`, `createVoiceHandler` и `mountDialogRelay`; CORS и куки `SameSite=None; Secure` настраивает приложение. Неверная запись в списке — ошибка при создании. Отказ пишется в журнал один раз на адрес страницы. Ядро экспортирует `createRequestOriginCheck` и `isSafeMethod`. Ещё: тело запроса больше 1 МиБ сервер не дочитывает и отвечает `413 { error: { kind: "too_large" } }` (самое длинное сообщение, 100 000 знаков, проходит).
- 1b2f9f1: Фронт и API на разных адресах. `allowedOrigins` у `createChatHandler`, `createVoiceRelay`, `createVoiceHandler` и `mountDialogRelay` принимает шаблон поддоменов `https://*.example.com`: он пускает `app.example.com` и `a.b.example.com`, но не сам `example.com` и не `evil-example.com`; схема и порт должны совпасть, слишком широкий шаблон (`https://*.com`, `https://*.com.`) — ошибка при создании. Общие суффиксы вроде `*.co.uk` проверка не распознаёт: в шаблон вписывают свой домен. Отказ из-за того, что `Origin` не совпал с `Host` (старый браузер или `http://` за прокси, который подменил `Host`), журнал теперь называет прямо: «Origin не совпал с Host (…); за прокси передайте Host/X-Forwarded-Host» с готовыми строками для nginx. `onRefused` у `createRequestOriginCheck` получает `{ origin, reason, hosts? }` вместо строки; новые экспорты ядра — `originRefusalHint` и тип `OriginRefusal`. Клиент на 403 с `forbidden_origin` в теле показывает «Сервер чата не принимает сообщения с этой страницы» (у правки — только в редакторе), возвращает текст в поле и в режиме разработки пишет в консоль, какой адрес вписать в `allowedOrigins`; другой 403 (например, HTML-страница прокси) — обычный сбой. Новое: `ChatRefusal` и `ErrorNoticeKind` получили `forbidden_origin` (`ErrorNotice` скина может получить этот `kind`), причина отказа правки `forbidden_origin`.
  
  **Изменение договора надписей:** в `ChatLabels` два новых обязательных ключа — `errors.forbidden_origin` и `editErrors.forbiddenOrigin`. Словарь на основе `{ ...russianLabels }` получает их сам; свой словарь целиком — дополните ими, иначе ошибка типов. Отдельного номера версии у договора надписей нет. Ещё: при отказе по месту хода (`too_many_turns`) или занятом чате файлы вложений больше не принимаются и не остаются ничьими; пока файлы принимаются, чат занят, и второе сообщение в него получает 409.
- 0e8e0ae: Голосовой режим: человек продолжил говорить, пока модель ещё думает, — вторая фраза дописывается к первой, а не уходит вторым сообщением. Ход останавливается, вместо прежнего сообщения уходит склеенное («Так. Дай-ка подумать.»), модель отвечает один раз; пустого оборванного ответа и отдельного «Так.» в чате нет.
  
  - Склеивается, пока у хода нет ни текста, ни звука, ни начатого вызова инструмента (размышление и заполнитель не мешают). Текст или звук уже пошли, начат инструмент, сказано стоп-слово или два междометия — поведение прежнее: перебивание и отдельное сообщение. Подробности — в README пакета voice-dialog, раздел «Склейка фраз».
  - Склейка идёт через правку последнего сообщения человека: старая фраза остаётся в базе, но обрывком склейки: переключателя веток у склеенного сообщения нет, пролистать на обрывок нельзя (если человек потом сам правит склеенное сообщение, появляется настоящая развилка без обрывков). Признак — часть `data-voice-mode` склеенного сообщения (`{ replaces: id }`), без миграции базы. Отметка голосового режима и подсказки режима сохраняются, кэш модели цел. Название чата, выведенное из заменённого сообщения, обновляется.
  - `core`: `chatService.editMessage(userId, chatId, editedMessageId, message, options?)` принимает `{ voiceMode: true }`. `server`: `POST …/edit` принимает необязательное булево `voiceMode` (не булево — 400 `invalid`).
  - `react`: у состояния чата появился `replaceLastVoiceMessage(text)`, у моста `DialogChatBridge` — необязательный `replaceLastMessage(text)`; `useVoiceDialog` его реализует.
  
  Обновление ничего не требует: движок склеивает сам, если мост и сервер той же версии. Приложение со своим мостом чата без `replaceLastMessage` работает как раньше: новая фраза в ожидании ответа перебивает ход и уходит отдельным сообщением.
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
- d12dcf3: Голосовой режим: звуки человека (смех, вздох, кашель…) доходят до модели.
  
  - Звук с микрофона параллельно с Soniox уходит с нашего сервера в ElevenLabs Scribe (`scribe_v2`, `tag_audio_events`); слова Scribe не использует, ключ остаётся на сервере. Звук уходит кусками прямо во время фразы: каждые `sounds.chunkSeconds` (1,5 с) нового звука, с перекрытием `sounds.overlapSeconds` (0,5 с), на конце фразы — только хвост; повторы на перекрытии схлопываются. Тишина (тише `sounds.silenceRms`, 0,01) не отправляется. На конце фразы ждётся только хвост и ещё не вернувшиеся куски, не дольше `sounds.waitMs` (1000 мс, по замеру Scribe отвечает за 0,7–0,95 с): не успел — звуки приклеятся к следующей фразе. Куски не копятся в очередь (не больше двух запросов). Расход считается по фактически отправленным секундам, включая перекрытия. Фраза из одного смеха без слов ход модели не запускает.
  - Звуки лежат в сообщении человека, в части `data-voice-mode` (`data: { sounds: ["laughter"] }`), уходят на сервер как `voiceSounds` вместе с `voiceMode` (значение не из закрытого списка — 400 `invalid`). Пометка для модели («были слышны его звуки: смех») выводится из сохранённого при сборке запроса: начало запроса от хода к ходу не меняется, кэш цел; склейка фраз сохраняет звуки обеих. На экране звуков нет. В пометке входа в режим появилось короткое правило про пометку звуков.
  - Эхо: звук того же вида, пойманный, пока играл кусок озвучки агента с таким же звуком (тег «[laughs]», заполнитель, отдельное «Ха-ха!»), плюс короткий хвост на задержку микрофона (`soundEchoTailMs`, 0,6 с), звуком человека не считается; смех в ответ на шутку агента доходит.
  - Ошибка или недоступность Scribe режим не ломает: разговор идёт без звуков, в журнал — предупреждение. Расход пишется записью `source: "sounds"` (`inputTokens` — секунды звука) и входит в лимиты расходов.
  - Новое: `sounds` у `createDialogRelay` и `mountDialogRelay` (`pricePerHour` обязательна), `sendVoiceMessage(text, { sounds })` и `replaceLastVoiceMessage(text, { sounds })` (`react`, `DialogChatBridge.send/replaceLastMessage` получили `options`), `voiceSounds` у `SendMessageOptions` и в теле `…/messages`, `…/edit`, экспорты `core`: `VOICE_SOUNDS`, `isVoiceSound`, `uniqueVoiceSounds`, `voiceSoundsNote`, `soundsOfMessage`, `UsageSource` получил `"sounds"`; `react`: тип `VoiceSound`; `voice-dialog/server`: `createScribeSounds`, `createSoundsUsage`, `HUMAN_SOUND_KINDS`.
  
  Как обновить приложение: ничего не требуется, пока `sounds` не задан. Чтобы включить, добавьте `sounds: { pricePerHour }` (цену Scribe берите из прайса ElevenLabs; v2 — 0,22 $ за час) в настройки режима; ключ тот же `ELEVENLABS_API_KEY`. Своё хранилище расходов должно принимать `source: "sounds"` (текстовое поле, миграций не нужно). Пометка входа в режим по умолчанию стала длиннее на одно правило: кэш модели у идущих голосовых чатов один раз промахнётся. Свой `agent.voiceModeHint` (строка) заменяет пометку входа целиком, правило про звуки в нём не появится, но пометка звуков у сообщений всё равно добавится.

### Patch Changes

- 96098be: Мелкие исправления (022). Символ с кодом ноль в первом сообщении больше не роняет отправку на Postgres: он выбрасывается из названия чата, из записей памяти и из сводки сжатия истории (иначе запись сжатия падала бы при каждой попытке); в самом тексте сообщения он лежит как раньше. Вложения отмечаются прикреплёнными до записи сообщения, а не после: если сервер упал между двумя шагами, чистка брошенных файлов не удалит их через сутки (файл, отмеченный зря, безвреден и уходит вместе с чатом). Во всех пакетах появилось поле `engines: { node: ">=22" }`; голосовой сервер (`createVoiceRelay`) и голосовой диалог (`createDialogRelay`) на Node 20 сразу при создании говорят понятной ошибкой, что нужен Node 22 (раньше падали при первом соединении; со своим `connectUpstream` проверки нет). В пакете вложений `react` и `@ykurilov/agent-chat-react` стали необязательными peer-зависимостями: серверу без экрана они больше не ставятся. Приложению, которое берёт `@ykurilov/agent-chat-attachments/react`, достаточно иметь их в проекте — для чата на экране они нужны и так; если они подтягивались только через вложения, добавьте их в зависимости приложения.
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

### Patch Changes

- Updated dependencies [4793e4d]
  - @ykurilov/agent-chat-core@0.13.0

## 0.12.0

### Patch Changes

- @ykurilov/agent-chat-core@0.12.0

## 0.11.0

### Patch Changes

- @ykurilov/agent-chat-core@0.11.0

## 0.10.0

### Minor Changes

- 4a76ff3: **Ломает приложения:** у `ChatStorage` появились обязательные операции `updateAwaitingMessage` и `getMessage`, у словаря `ChatLabels` — новые ключи `approval*`; касается приложений со своим хранилищем и с полным словарём надписей.
  
  Подтверждение перед опасными действиями агента. Инструмент, помеченный `needsApproval: true` (или функцией от входных данных), не выполняется без разрешения человека: ход останавливается, в ленте появляется карточка с названием действия, входными данными и кнопками «Разрешить», «Отклонить» и «Всегда в этом чате». Кнопка «Всегда» есть только у инструмента с `needsApproval: true`; у инструмента с функцией её нет, каждый вызов спрашивает заново. Ждать можно сколько угодно: состояние лежит на сервере, переживает перезагрузку страницы и перезапуск сервера, ответить можно с любого устройства.
  
  Что изменилось:
  
  - `@ykurilov/agent-chat-core`: статус ответа `awaiting_approval`; `answerApproval` у сервиса чата; ответ после решения дописывается в то же сообщение, инструмент выполняется ровно раз. «Отклонить» — модель получает «пользователь отклонил» и продолжает. Новое сообщение вместо ответа на карточку считается отказом. Сбой или «Стоп» после «Разрешить» не оставляют вызов без итога: он закрывается как прервавшийся («результат неизвестен», если инструмент уже мог сработать). Ответ на карточку проверяет лимит расходов (429), а расход паузы и продолжения не считается дважды. После смены модели во время ожидания продолжение идёт на модели ждущего сообщения. Кэш модели не страдает: инструкция и набор инструментов не меняются.
  - `@ykurilov/agent-chat-server`: адрес `POST /:chatId/approvals/:approvalId` с телом `{ "decision": "allow" | "deny" | "always" }`. Ошибки: 409 `busy` (в чате идёт другой ход), 409 `approval_not_pending` (на этот запрос отвечать уже нечем), 429 `spending_limit_reached`.
  - `@ykurilov/agent-chat-storage-sqlite`, `@ykurilov/agent-chat-storage-postgres`: реализуют `updateAwaitingMessage` и `getMessage`. Схема базы не меняется, миграции не нужны: статус ответа хранится обычным текстом.
  - `@ykurilov/agent-chat-react`: договор скина версии 9 — у `ToolCallRow` необязательные `title` и `approval`; хук `useAgentChat` отдаёт `respondToApproval`, `approvalPendingId`, `approvalFailure` (вид сбоя: нет связи, чат занят, лимит расходов, запрос уже не ждёт); при неудачной отправке карточка возвращается к кнопкам, а не остаётся «отклонённой». У `ToolApprovalView` в состоянии `requested` есть `canAlways` (показывать ли «Всегда») и необязательный `failureText`. Словарь получил ключи `approvalRequested`, `approvalWaiting`, `approvalAllow`, `approvalDeny`, `approvalAlways`, `approvalFailed`, `approvalSpendingLimit`, `approvalBusy`, `approvalAllowedMark`, `approvalAlwaysMark`, `approvalDeniedMark`, `approvalAnnouncement`.
  - `@ykurilov/agent-chat-skin-tandem`: карточка подтверждения (группа с названием для читалки, «Ждёт вашего решения» и итог озвучиваются, фокус не теряется, на телефоне длинные поля не выпирают) и пометка решения в строке вызова.
  
  ### Как обновить приложение
  
  Если опасных инструментов нет, а хранилище и скин стандартные, обновление ничего не требует.
  
  1. Своё хранилище (`ChatStorage`): добавьте `getMessage(messageId)` — вернуть сообщение по номеру или `null`. И добавьте `updateAwaitingMessage(messageId, patch)` — перезаписать `parts` ответа со статусом `awaiting_approval` и, если в `patch.status` указано, сменить статус на `"streaming"` или `"complete"`; ответ не в этом статусе — бросить `MessageNotAwaitingError`. Готовый образец — `packages/storage-sqlite/src/sqlite-storage.ts`. Проверка: `describeChatStorageContract` из `@ykurilov/agent-chat-core/storage-contract` проходит.
  2. Полный свой словарь надписей (`ChatLabels`, объект без `...russianLabels`): добавьте двенадцать ключей `approval*` из списка выше. Словарь `{ ...russianLabels, … }` менять не нужно.
  3. Свой скин: если `ToolCallRow` свой, добавьте разбор `approval` — `{ state: "requested", onDecide, pending, failed, failureText?, canAlways }` (нарисовать кнопки, `onDecide("allow" | "deny" | "always")`; «Всегда» показывать только при `canAlways`; при `failed` показать `failureText`, если он есть) и `{ state: "allowed" | "always" | "denied" }` (итог решения). Нет `approval` — рисуйте строку как раньше. Название действия — в `title`.
  4. Чтобы включить подтверждение: у опасного инструмента задайте `needsApproval: true` (можно функцией от входных данных; с функцией кнопки «Всегда» не будет) и `title` — название для карточки. Больше ничего подключать не надо.
  5. Проверка: `pnpm typecheck`; попросите агента вызвать опасный инструмент — в ленте карточка, после «Разрешить» действие выполнено, ответ дописан в то же сообщение.

### Patch Changes

- Updated dependencies [4a76ff3]
  - @ykurilov/agent-chat-core@0.10.0

## 0.9.0

### Minor Changes

- d07a1c3: **Ломает приложения:** только если вы сами реализовали `ChatStorage` или собрали словарь надписей целиком (без `{ ...russianLabels, … }`); остальным ничего делать не нужно.
  
  Новый пакет `@ykurilov/agent-chat-limits`: лимиты расходов. Бюджет в долларах на человека, на чат или на то и другое; период — календарный месяц (по умолчанию), сутки или без обнуления. Исчерпанный лимит останавливает ход до его начала; при 80% чат предупреждает.
  
  Что изменилось:
  
  - Ядро: цены в профиле модели (`ModelProfile.pricing` по провайдерам; вход, выход, чтение и запись кэша, рассуждения считаются как выход). Цены есть у всех стандартных моделей. Журнал расхода `usage_records` — токены и стоимость в долларах (`costUsd`, по ценам модели на момент хода) каждого ответа и фонового сжатия, в том числе сжатия, которое не удалось, но было оплачено; запись датируется началом хода. Журнал только дописывается и переживает удаление чата. Сумма лимита берётся из записей, поэтому смена цен и удаление модели из каталога прошлый расход не меняют. Новые методы хранилища `insertUsageRecord` и `sumUsage`.
  - Ядро: `createChatService({ limits })` и `ChatService.getSpendingStatus`. Проверка идёт перед отправкой, повтором, переделкой и правкой, до любых записей; исчерпание — `SpendingLimitReachedError`.
  - Сервер: `createChatHandler({ limits })`. Исчерпанный лимит — `429 {"error":{"kind":"spending_limit_reached","scope","period","resetsAt"}}`; новый адрес `GET /api/chat/:id/spending` (без сумм в долларах).
  - `@ykurilov/agent-chat-limits`: `createSpendingLimits({ storage, catalog, budget, period?, warnAt?, unpricedModels?, now?, logError? })` и `getSpending({ userId, chatId })` для страницы «тариф» (расход чата считается только среди записей этого человека). Своя модель без цены — понятная ошибка при создании; явно `unpricedModels: "ignore"` — такие ходы пишутся с нулевой стоимостью. `compactNow` лимит не проверяет: ручное сжатие остаётся доступным.
  - Хранилища: SQLite (миграция `0006`) и PostgreSQL (миграция `0005`) добавляют таблицу `usage_records`; миграции применяются при открытии хранилища сами, существующие данные не трогаются. Проверено на копии базы песочницы.
  - Браузер: `AgentChat` принимает `spendingLimits`. Договор скина версии 8: необязательный компонент `SpendingNotice({ id, state, text })` (`state` бывает `none`: область для диктора всегда на странице) и необязательные свойства `Composer.sendingBlocked` и `Composer.sendingBlockedReasonId` (для `aria-describedby`). Скин Тандема их рисует; при остановке фокус переходит на надпись и возвращается в поле, когда лимит снят. Отказ 429 не запускает переподключения: текст возвращается в поле (при правке сообщения редактор остаётся открытым с текстом и надписью `editErrors.spendingLimit`), показывается «Лимит на месяц исчерпан, обновится 1 ноября»; исчерпание снимается само в момент обновления.
  - Словарь надписей: `spendingWarning` и `spendingExhausted` (функции от сведений о лимите) и `editErrors.spendingLimit`.
  
  Не входит в расход: веб-инструменты (`web-tools`, другой сервис), незаконченный шаг остановленного хода и ход, оборванный перезапуском сервера. Ход, начатый в пределах бюджета, доводится до конца; одновременные ходы могут вместе выйти за бюджет (проверка не резервирует деньги).
  
  ### Как обновить приложение
  
  Если лимиты не нужны, делать ничего не нужно, кроме двух случаев:
  
  1. **Только если вы реализовали `ChatStorage` сами:** добавьте `insertUsageRecord(record)` и `sumUsage(filter)` (запись расхода несёт `costUsd`, сумма возвращает `costUsd`) и прогоните `describeChatStorageContract` (в нём появился блок «записи расхода»). Хранилища SQLite и PostgreSQL из этого репозитория обновляются сами.
  2. **Только если словарь надписей написан целиком** (не через `{ ...russianLabels, … }`): добавьте функции `spendingWarning` и `spendingExhausted` и надпись `editErrors.spendingLimit`. Значения — в `russianLabels`.
  
  Чтобы включить лимиты:
  
  1. `pnpm add @ykurilov/agent-chat-limits`.
  2. На сервере: `const limits = createSpendingLimits({ storage, catalog, budget: async ({ userId }) => ({ user: 5 }) })` и `createChatHandler({ …, limits })`. `storage` и `catalog` — те же, что у чата.
  3. В браузере: `<AgentChat … spendingLimits />`. Скин свой — добавьте `SpendingNotice` (с `id`, состоянием `none` и `role="status"`) и учтите `Composer.sendingBlocked` и `sendingBlockedReasonId`; нет их — надписи не будет, но отправка остановится.
  4. Проверка: с маленьким бюджетом чат сначала предупреждает, потом останавливает отправку и пишет дату обновления.

### Patch Changes

- Updated dependencies [d07a1c3]
  - @ykurilov/agent-chat-core@0.9.0

## 0.8.0

### Minor Changes

- a24c79d: **Ломает приложения:** у `ChatStorage` три новых обязательных метода (`listChats`, `renameChat`, `deleteChat`), у `AttachmentStorage` — один (`removeAllOfChat`), а у `ChatLabels` — 16 новых обязательных надписей `chatList*`. Приложения на готовых хранилищах и готовом словаре надписей ничего менять не должны; поломка только у своих реализаций.
  
  Список чатов в боковой панели: создать чат, переименовать, удалить. Чат сам получает название по первому сообщению. Это расширение по желанию: приложение без `chatList` и без `ChatWorkspace` работает как раньше.
  
  Что изменилось:
  
  - `@ykurilov/agent-chat-core`: `createChatService` умеет `listChats(userId)`, `renameChat(userId, chatId, title)`, `deleteChat(userId, chatId)`. Название ставится по первому сообщению (до 60 знаков), вручную заданное не перезаписывается; длина названия до 100 знаков. Удаление настоящее: идущий ответ и сжатие останавливаются, затем убираются сообщения, записи сжатия, выбор веток, файлы вложений и сам чат. Чужой и несуществующий чат — одинаково `ChatNotFoundError`. Экспортируются `deriveChatTitle`, `normalizeChatTitle`, `InvalidChatTitleError`, тип `ChatListItem`. `Chat.title` необязательное. Набор проверок `describeChatStorageContract` расширен.
  - `@ykurilov/agent-chat-server`: `createChatHandler({ chatList: true })` включает три адреса: `GET {basePath}` (список), `PATCH {basePath}/:id` с телом `{ title }`, `DELETE {basePath}/:id`. Без `chatList` эти адреса отвечают 404. Чужой чат — 404, неверное название — 400. Идущий ответ удалению не мешает: он останавливается. `409` при удалении — только если чат уже удаляется или в этот миг запускается ход; пока чат удаляется, сообщение, сжатие и вложения в него тоже получают `409`. Переименование `409` не даёт.
  - `@ykurilov/agent-chat-storage-sqlite` и `@ykurilov/agent-chat-storage-postgres`: колонка `title` у чатов, методы `listChats`, `renameChat`, `deleteChat` (удаление в одной транзакции). Миграция сама заполняет названия старых чатов по их первому сообщению.
  - `@ykurilov/agent-chat-attachments`: `AttachmentStorage` получил `removeAllOfChat(chatId)`; `createAttachments` отдаёт ядру `removeChatFiles`, и файлы удаляются вместе с чатом. Набор `describeAttachmentStorageContract` расширен.
  - `@ykurilov/agent-chat-react`: компонент `ChatWorkspace` (список и открытый чат вместе), хук `useChatList`, у `AgentChat` необязательное `onBusyChange`. Договор скина версии 7: скин, который хочет работать с `ChatWorkspace`, дополнительно даёт `ChatWorkspace` и `ChatList` (тип `ChatListSkin`); договор самого чата не менялся. 16 новых надписей `chatList*` в словаре (`ChatLabels`).
  - `@ykurilov/agent-chat-skin-tandem`: `TandemChatWorkspace` и `TandemChatList`. На широком экране список слева, на узком — панель по кнопке «Чаты».
  
  ### Как обновить приложение
  
  Если список чатов не нужен, а хранилища и словарь надписей готовые, обновление ничего не требует.
  
  Если у приложения своё `ChatStorage`:
  
  1. Добавьте методы `listChats(ownerId)`, `renameChat(chatId, title | null)` и `deleteChat(chatId)`. Список — только чаты владельца, самые недавно менявшиеся первыми; `deleteChat` убирает сообщения, записи сжатия, выбор веток и чат одной транзакцией. Точные правила — в общем наборе проверок.
  2. Храните название чата (`Chat.title`, необязательное) и проведите свою миграцию.
  3. Проверка: `describeChatStorageContract` из `@ykurilov/agent-chat-core/storage-contract` проходит.
  
  Если у приложения своё `AttachmentStorage`: добавьте `removeAllOfChat(chatId): Promise<number>` (удалить все файлы чата, вернуть сколько) и прогоните `describeAttachmentStorageContract`.
  
  Если у приложения свой полный словарь надписей (`ChatLabels` целиком, а не `{ ...russianLabels, … }`): добавьте 16 новых ключей, иначе `pnpm typecheck` упадёт. Простые строки: `chatListHeading` («Чаты»), `chatListNewChat` («Новый чат»), `chatListUntitled` («Новый чат»), `chatListLoading`, `chatListLoadFailed`, `chatListCreateFailed`, `chatListRenameFailed`, `chatListDeleteFailed`, `chatListRename`, `chatListRenameField`, `chatListDelete`, `chatListDeleteTitle`, `chatListDeleteConfirm`, `chatListDeleteCancel`. Функции от названия чата: `chatListRowMenu(title)` («Действия с чатом …») и `chatListDeleteBody(title)`.
  Было: `const labels: ChatLabels = { …прежние надписи }`. Стало: те же надписи плюс 16 новых; проще всего `{ ...russianLabels, …свои }`.
  
  Чтобы включить список чатов:
  
  1. Сервер: `createChatHandler({ …, chatList: true })`. Базы SQLite и PostgreSQL обновятся сами при открытии.
  2. Браузер: вместо `<AgentChat api chatId … />` — `<ChatWorkspace api="/api/chat" skin={tandemSkin} … />` (те же остальные свойства, кроме `chatId`). Открытый чат приложение может показывать в адресе: `initialChatId` и `onChatChange`.
  3. Если скин свой: добавьте `ChatWorkspace` и `ChatList` по договору версии 7 (`ChatListSkin`). Скин Тандема обновляется вместе с пакетом.
  4. Если приложение само создавало чат кнопкой «Новый чат», уберите её: «Новый чат» теперь в списке.
  5. Проверка: `pnpm typecheck` (ловит недостающие методы хранилищ и надписи); в списке видны чаты пользователя, «Новый чат» открывает пустой чат, после первого сообщения чат получает название, переименование и удаление (с подтверждением) работают.

### Patch Changes

- Updated dependencies [a24c79d]
  - @ykurilov/agent-chat-core@0.8.0

## 0.7.0

### Minor Changes

- b8f9e9f: **Ломает приложения со своими хранилищами и своими скинами:** ответ агента можно переделать, а отправленное сообщение исправить; все варианты сохраняются, между ними переключает «‹ 2/3 ›».
  
  Что изменилось:
  
  - Под ответом агента появилась кнопка «Переделать ответ»: агент отвечает на тот же вопрос заново, прежний ответ остаётся вариантом. Под сообщением собеседника появился карандаш «Изменить сообщение»: правка идёт на месте пузыря, отправляется новой веткой с новым ответом агента.
  - Когда у сообщения больше одного варианта, рядом стоит переключатель «‹ 2/3 ›». Выбранный вариант запоминается на сервере: после обновления страницы или на другом устройстве открывается он же.
  - Ничего не удаляется и не переписывается: журнал переписки только дописывается, выбор варианта — отдельная запись в новой таблице `branch_selections`.
  - Модель видит только текущую ветку: после правки она не знает прежнего текста, после переключения на прежний вариант — знает. Инструкция и инструменты в запросе не меняются, кэш модели ветки не задевают. Сжатие истории и поиск по старой переписке работают по текущей ветке (сводка действует на ветке, где она сделана).
  - Правка сообщения с файлами (пакет вложений): файлы остаются как были и переходят в новый вариант, меняется только текст; убрать или добавить файл при правке нельзя. Сообщение из одних файлов можно отправить и с пустым текстом. Файлы проходят ту же проверку сервера, что и при обычной отправке.
  - Пока идёт ответ, переключать, переделывать и править нельзя: сервер отвечает 409 `busy`, кнопки в экране неактивны. Если отказ всё же пришёл (ответ пошёл с другой вкладки), поле правки остаётся открытым с текстом собеседника и понятной ошибкой: текст не пропадает.
  - Новые адреса в `createChatHandler`: `GET /api/chat/:id/branches`, `POST /api/chat/:id/branch`, `POST /api/chat/:id/regenerate`, `POST /api/chat/:id/edit`; развилки приходят и в `GET /api/chat/:id` (поле `forks`). Новые методы службы: `selectBranch`, `regenerate`, `editMessage`, `getBranchForks`. Хук `useAgentChat` отдаёт `forks`, `selectBranch`, `canRegenerate`, `regenerate`, `canEdit`, `edit` (возвращает `Promise<EditOutcome>`: правка началась, не началась или сервер отказал).
  - Базы SQLite (миграция 0004) и PostgreSQL (миграция 0003) получают новую таблицу сами при первом запуске. Ничего запускать вручную не нужно.
  - В скине Тандема строка с карандашом и переключателем занимает прежний промежуток между сообщениями: высота сообщений не меняется.
  
  ### Как обновить приложение
  
  1. Обновите все пакеты SDK одной командой: `pnpm update "@ykurilov/agent-chat-*" --latest`. Базы обновятся сами при первом запуске сервера.
  2. **Если у приложения своё хранилище** (свой класс, реализующий `ChatStorage`): добавьте два метода и таблицу под них.
  
     ```ts
     insertBranchSelection(record: StoredBranchSelection): Promise<void>; // дописать запись «выбран этот вариант»
     listBranchSelections(chatId: string): Promise<StoredBranchSelection[]>; // записи чата по порядку добавления
     ```
  
     `StoredBranchSelection` — `{ id, chatId, messageId, selectedAt }` (оба времени — строка ISO). Записи только добавляются, не меняются и не удаляются. Тип и общий тест `describeChatStorageContract` берутся из `@ykurilov/agent-chat-core`; тест теперь проверяет и эти методы. Приложения на памяти, SQLite и PostgreSQL из наших пакетов ничего не меняют.
  3. **Если у приложения свой скин** (объект `ChatSkin` не из `@ykurilov/agent-chat-skin-tandem`): договор скина теперь версии 6 (версия 5 — голосовой ввод и вложения, необязательные `Composer.voice`, `Composer.attachments`, `UserMessage.attachments`). Добавьте два компонента и новые свойства сообщений.
  
     ```tsx
     const BranchSwitcher: ChatSkin["BranchSwitcher"] = ({ position, count, onPrevious, onNext }) => {
       const labels = useChatLabels();
       return (
         <div role="group" aria-label={labels.branchPosition(position, count)}>
           <button type="button" aria-label={labels.previousBranch} disabled={!onPrevious} onClick={onPrevious}>‹</button>
           {position}/{count}
           <button type="button" aria-label={labels.nextBranch} disabled={!onNext} onClick={onNext}>›</button>
         </div>
       );
     };
     const MessageEditor: ChatSkin["MessageEditor"] = ({ value, onValueChange, onSave, onCancel, canSave, error, attachments }) => {
       const labels = useChatLabels();
       return (
         <div>
           {attachments && <ul aria-label={attachments.label}>{attachments.items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>}
           <textarea aria-label={labels.editMessage} value={value} onChange={(event) => onValueChange(event.target.value)} />
           {error && <p role="alert">{error}</p>}
           <button type="button" onClick={onCancel}>{labels.cancelEdit}</button>
           <button type="button" disabled={!canSave} onClick={onSave}>{labels.saveEdit}</button>
         </div>
       );
     };
     const skin = { ...mySkin, BranchSwitcher, MessageEditor };
     ```
  
     `UserMessage` получает свойства `branchSwitcher?: ReactNode` (положить рядом с сообщением) и `onEdit?: () => void` (кнопка «Изменить сообщение»; когда правка недоступна, свойства нет). `AgentMessage` получает `branchSwitcher?: ReactNode` и `onRegenerate?: () => void` (кнопка «Переделать ответ», только у последнего законченного ответа). Свойства необязательны: скин без них не ломается, только не показывает кнопок. Пример — `skins/tandem/src` в репозитории SDK.
  4. **Если словарь надписей написан целиком**, а не через `{ ...russianLabels, … }`: добавьте ключи `previousBranch` («Предыдущий вариант»), `nextBranch` («Следующий вариант»), `branchPosition(position, count)` («Вариант 2 из 3»), `regenerate` («Переделать ответ»), `editMessage` («Изменить сообщение»), `saveEdit` («Отправить»), `cancelEdit` («Отмена»), `editErrors` — `{ busy: "Ответ ещё идёт. Дождитесь его конца и отправьте снова", offline: "Нет связи с сервером. Текст сохранён в поле", rejected: "Сервер не принял правку. Текст сохранён в поле" }`.
  5. **Если приложение само собирает ленту через `useAgentChat`**: подключите `forks` и `selectBranch`, как в `packages/react/src/agent-chat.tsx`. Готовый `AgentChat` ничего менять не просит.
  6. Проверка: `pnpm typecheck` проходит; отправьте сообщение, нажмите «Переделать ответ» — под ответом появится «2/2», стрелка «‹» вернёт первый вариант, после обновления страницы выбор сохранится. Подробности — раздел «Ветки ответов и правка сообщений» в `docs/getting-started.md`.
- 7c205c4: Новый пакет `@ykurilov/agent-chat-attachments`: вложения к сообщению. В поле ввода появляются скрепка, перетаскивание и вставка файлов из буфера, превью с удалением; в ленте у сообщения — миниатюры картинок и плашки файлов. Картинки, PDF и текстовые файлы; тип определяется по содержимому.
  
  Что изменилось:
  
  - `@ykurilov/agent-chat-attachments`: `createAttachments({ storage, limits? })`, хранилища файлов `createDiskAttachmentStorage({ directory })` и `createMemoryAttachmentStorage()`, `attachmentsInstructions`, общий набор проверок своего хранилища `describeAttachmentStorageContract` (подпуть `/storage-contract`). Подпуть `/react`: `attachmentsClient`. Пределы по умолчанию: 10 файлов, 20 МБ на файл, потолок извлечённого текста; меняются в `limits`.
  - Картинки уходят только моделям с `acceptsImages`; если модель не видит, человек узнаёт об этом до отправки. Текст PDF и текстовых файлов достаётся на сервере и идёт любой модели. Кэш модели не страдает: извлечённый текст не меняется от хода к ходу.
  - `@ykurilov/agent-chat-core`: `createChatHandler`/`createChatService` принимают необязательное `attachments`; меню моделей несёт `acceptsImages`; задание сжатия просит назвать прикреплённые файлы в сводке (оригиналы остаются). Без `attachments` файлы в сообщении отклоняются.
  - `@ykurilov/agent-chat-server`: новые адреса под адресом чата: `GET /attachments/settings`, `POST /:chatId/attachments`, `GET` и `DELETE /:chatId/attachments/:id`.
  - `@ykurilov/agent-chat-react`: `AgentChat` принимает необязательное `attachments`. Договор скина версии 5: `Composer` и `UserMessage` получают необязательное `attachments`, у моделей в `ModelChoiceView` появилось необязательное `acceptsImages`.
  - `@ykurilov/agent-chat-skin-tandem`: скрепка, превью, миниатюры и плашки файлов. Встроенный микрофон полного поля Тандема спрятан: голос — отдельная кнопка (пакет `voice`).
  - Разбор PDF идёт в отдельном потоке с потолком памяти и сроком: зависший или «раздутый» файл обрывается, сервер живёт дальше; текст собирается до потолка символов.
  - Лимиты на человека: `maxUnsentFiles` (30), `maxUnsentBytes` (200 МБ), `maxParallelUploads` (8), `maxParallelUploadsPerUser` (3); отказы 429 `too_many_unsent` и `busy`. Файлы с ошибкой в лимит не входят. Тело загрузки читается потоком без лишних копий. Поле ввода грузит файлы по два одновременно, остальные ждут в очереди, а на отказ `busy` повторяет несколько раз.
  - Диск чистит недописанные остатки (`.tmp` и `.bin` без описания) по возрасту; неотправленные файлы убираются через 24 часа, прикреплённые не трогаются. Просроченный файл возвращается в поле с пометкой «загрузите снова».
  - Файл помечается «прикреплён» только после записи сообщения (`confirmUserParts` в контракте `MessageAttachments`; `acceptUserParts` файлы не помечает). Отказ отправки возвращает текст и файлы в поле, повторный клик не очищает его раньше времени. Контракт `AttachmentsController` в `@ykurilov/agent-chat-react`: вместо `takeFiles` — `readFiles`, `markSent`, `restoreFiles`; `useAgentChat.submit` возвращает признак «принято».
  - Текстовые логи с цветовыми кодами терминала (ANSI) принимаются как текст, коды убираются. Закрывающий тег `</attachment>` в тексте файла обезвреживается без учёта регистра.
  - `MessageAttachments.instructions`: ядро само дописывает инструкцию про вложения к инструкции агента (один раз, дубль не появляется). Вручную `attachmentsInstructions` добавлять больше не нужно, но и не вредно.
  - `@ykurilov/agent-chat-skin-tandem`: пока грузится список моделей, в поле со вложениями нет пустой кнопки «Выберите модель».
  - Схема базы чата не меняется, миграции не нужны.
  
  ### Как обновить приложение
  
  Если вложения не нужны, обновление ничего не требует: без `attachments` чат работает как раньше.
  
  Чтобы включить вложения:
  
  1. `pnpm add @ykurilov/agent-chat-attachments`.
  2. На сервере: `const attachments = createAttachments({ storage: createDiskAttachmentStorage({ directory: "./data/attachments" }) })`, передайте `attachments` в `createChatHandler` и инструкцию агенту про вложения ядро добавляет само. Папку с файлами включите в резервные копии вместе с базой.
  3. В браузере: `<AgentChat … attachments={attachmentsClient} />` (`attachmentsClient` из `@ykurilov/agent-chat-attachments/react`).
  4. Если скин свой: `Composer` получает `attachments` (скрепка, превью, `notice`), `UserMessage` — `attachments` (миниатюры и плашки). Нет свойства — ничего про вложения не рисовать. Свой скин на `@ykurilov/agent-chat-skin-tandem` обновляется вместе с пакетом.
  5. Проверка: `pnpm typecheck`; в поле ввода есть скрепка, картинка и PDF прикрепляются, в ленте видны миниатюра и плашка, агент отвечает по содержимому.
- e741e6d: Новый пакет `@ykurilov/agent-chat-voice`: голосовой ввод через Soniox. В поле ввода появляется кнопка микрофона, слова видны по ходу речи, человек правит и отправляет сам. Главный ключ Soniox остаётся на сервере, браузеру выдаётся временный.
  
  Что изменилось:
  
  - `@ykurilov/agent-chat-voice/server`: `createVoiceHandler({ basePath, resolveUser })` — адрес `POST /api/voice/session`, ключ из `SONIOX_API_KEY`. Адреса Soniox настраиваются (`apiBaseUrl`, `apiHeaders`, `websocketUrl`) — для сервера в России.
  - `@ykurilov/agent-chat-voice`: `createVoiceInput({ api })` — микрофон и соединение с Soniox в браузере. Формат записи выбирается явно (webm/opus → ogg/opus → mp4/AAC).
  - Режим «звук через наш сервер»: `createVoiceInput({ api, mode: "relay" })` в браузере, `createVoiceRelay` в `…/voice/server` и `mountVoiceRelay` в новом подпути `…/voice/hono` (Hono на Node через `@hono/node-ws`). Нужен там, где Soniox недоступен из браузера; адрес и заголовки прокси настраиваются (`websocketUrl`, `upstreamHeaders`). Next.js WebSocket в route handlers не держит — нужен отдельный Node-сервер.
  - Ограничение частоты: `rateLimit` (по умолчанию 10 диктовок в минуту на человека, в памяти процесса; общие лимиты — на приложении). Ответ с ключом идёт с `Cache-Control: no-store`; исключение из `resolveUser` даёт 503 и запись в `logError`.
  - Предел диктовки 5 минут: запись останавливается за две секунды до него, человек видит причину.
  - Отправка сообщения во время диктовки останавливает диктовку.
  - Ручная правка посреди слова, которое Soniox ещё не закрепил, больше не портит текст: сказанное учитывается только по закреплённой части.
  - `AgentChat` принимает необязательное свойство `voice`; без него кнопки нет. Договор скина версии 5: `Composer` получает необязательное `voice` (`VoiceInputView`). Скин Тандема рисует кнопку сам (`TandemVoiceButton`).
  - В словаре надписей новые ключи: `voiceStart`, `voiceStop`, `voiceConnecting`, `voiceErrors` (виды ошибок, в том числе `rate_limited` и `time_limit`).
  - `mountChat` и `createNextRouteHandlers` теперь принимают любой объект с `basePath` и `fetch`, а не только обработчик чата — так подключается и голос.
  
  ### Как обновить приложение
  
  Если голос не нужен, ничего делать не нужно, кроме одного случая:
  
  1. **Только если словарь надписей написан целиком** (не через `{ ...russianLabels, … }`): добавьте ключи `voiceStart`, `voiceStop`, `voiceConnecting` и `voiceErrors` (по видам `permission_denied`, `no_microphone`, `unsupported`, `network`, `service_unavailable`, `rate_limited`, `time_limit`, `other`). Значения — в `russianLabels` из `@ykurilov/agent-chat-react`.
  
  Чтобы включить голос:
  
  1. `pnpm add @ykurilov/agent-chat-voice`, ключ Soniox положите в окружение сервера как `SONIOX_API_KEY`.
  2. На сервере рядом с чатом: `mountChat(app, createVoiceHandler({ basePath: "/api/voice", resolveUser }))` (в Next.js — второй файл маршрута `app/api/voice/[[...path]]/route.ts`).
  3. В браузере: `<AgentChat … voice={createVoiceInput({ api: "/api/voice" })} />`, объект создаётся один раз.
  4. Если скин свой: `Composer` получает `voice`; нет его — кнопку не рисовать.
  5. Проверка: кнопка «Диктовать» есть в поле ввода, слова появляются по ходу речи.

### Patch Changes

- Updated dependencies [b8f9e9f]
- Updated dependencies [7c205c4]
  - @ykurilov/agent-chat-core@0.7.0

## 0.6.0

### Minor Changes

- 5252793: **Ломает приложения со своими хранилищами и своими скинами:** длинная переписка теперь сжимается сама, а у агента появился инструмент «поиск по старой переписке».
  
  Что изменилось:
  
  - Когда модель видит больше 200 тысяч токенов (у моделей с маленьким окном — 80% окна), ядро в фоне после ответа заменяет старую часть переписки короткой сводкой и оставляет свежие ~20 тысяч токенов как есть. Сообщения из базы не удаляются. В ленте на месте сжатия появляется строка «История сжата», по клику открывается сводка. Сжатие включено по умолчанию; `compaction: false` в `createChatHandler` (или `createChatService`) его выключает, `compaction: { thresholdTokens, tailTokens, summaryCeilingTokens, model, instruction }` настраивает.
  - Новый пакет `@ykurilov/agent-chat-history-search`: инструмент `search_earlier_conversation`, который ищет точные детали в оригиналах старой переписки. Подключается по желанию.
  - Новый адрес `GET /api/chat/:id/compactions` (в `createChatHandler`), новый метод службы `compactNow`, набор инструментов агента получает `chatId` хода.
  - «Стоп» обрывает ожидание сжатия сразу (само сжатие доделывается в фоне). `chat.flush()` при остановке сервера ждёт идущие сжатия до `compaction.flushWaitMs` (30 секунд по умолчанию) и отменяет остальные без записи полусводки.
  - Разделитель появляется без перезагрузки надёжно: сервер ставит признак «идёт сжатие» до конца потока ответа, а экран опрашивает `/compactions`, пока признак стоит (до 12 минут). `/compactions` стал лёгким: читает связи сообщений, а не тексты с выводами инструментов.
  - Сводку пишет самый малый уровень рассуждений модели (или без них, где можно), а потолок вывода имеет запас, так что рассуждения не обрывают сводку по длине. Пауза после сбоя теперь действует и на исход «нечего сжимать».
  - Поиск нормализует текст каждого сообщения один раз за вызов.
  - Дедупликация сжатий живёт в памяти процесса, как и реестр идущих ответов: при нескольких копиях сервера возможно двойное сжатие и двойной расход токенов.
  - Базы SQLite и PostgreSQL получают новую таблицу и новые поля сами при первом запуске. Ничего запускать вручную не нужно.
  
  ### Как обновить приложение
  
  1. Обновите все пакеты SDK одной командой: `pnpm update "@ykurilov/agent-chat-*" --latest`. Базы обновятся сами при первом запуске сервера.
  2. **Если у приложения своё хранилище** (свой класс, реализующий `ChatStorage`): добавьте три метода.
  
     ```ts
     insertCompaction(record: StoredCompaction): Promise<void>; // записать отметку сжатия
     listCompactions(chatId: string): Promise<StoredCompaction[]>; // отметки чата по порядку добавления
     listMessageLinks(chatId: string): Promise<MessageLink[]>; // { id, parentId, createdAt } сообщений чата, в порядке listMessages
     ```
  
     Типы `StoredCompaction`, `MessageLink` и общий тест `describeChatStorageContract` берутся из `@ykurilov/agent-chat-core`; тест теперь проверяет и эти методы.
     Приложения на памяти, SQLite и PostgreSQL из наших пакетов ничего не меняют.
  3. **Если у приложения свой скин** (объект `ChatSkin` не из `@ykurilov/agent-chat-skin-tandem`): добавьте компонент `CompactionDivider`, договор скина теперь версии 4.
  
     ```tsx
     const CompactionDivider: ChatSkin["CompactionDivider"] = ({ summary, open, onOpenChange }) => {
       const labels = useChatLabels();
       return (
         <div>
           <button type="button" aria-expanded={open} onClick={() => onOpenChange(!open)}>
             {labels.historyCompacted}
           </button>
           {open && (
             <div>
               <p>{labels.historyCompactedHint}</p>
               <pre>{summary}</pre>
             </div>
           )}
         </div>
       );
     };
     const skin = { ...mySkin, CompactionDivider };
     ```
  
     `summary` — сводка в Markdown; свёрнутый разделитель — строка «История сжата». Скин Тандема обновляется вместе с пакетом.
  4. **Если словарь надписей написан целиком**, а не через `{ ...russianLabels, … }`: добавьте ключи `historyCompacted` («История сжата») и `historyCompactedHint`.
  5. Чтобы агент мог искать в сжатой переписке (по желанию): `pnpm add @ykurilov/agent-chat-history-search`, затем в `agent` обработчика добавьте `historySearchInstructions` в `instructions` и `...historySearch(model)` в `tools`; шаги и код — в разделе «Сжатие истории и поиск по старой переписке» файла `docs/getting-started.md`.
  6. Проверка: `pnpm typecheck` проходит, чат открывается и отвечает. Кэш модели после первого сжатия обнуляется один раз (запрос после него дороже обычного), это ожидаемо.

### Patch Changes

- Updated dependencies [5252793]
  - @ykurilov/agent-chat-core@0.6.0

## 0.5.0

### Minor Changes

- 62027c6: Ломает приложения: в поле ввода появился выбор модели и уровня рассуждений, поэтому «какой моделью отвечать» теперь решает не сервер приложения на каждый ход, а пользователь в чате. Настройка `resolveModel` заменена на `defaultChoice` (модель для нового чата).
  
  Что нового простыми словами:
  
  - Стандартный набор моделей: DeepSeek 4.1 Flash, GLM 5.3 Flash, GPT 6 Luna, Gemini 3.8 Flash. Провайдеры: Fireworks, DeepSeek, Together и новый OpenRouter (ключ `OPENROUTER_API_KEY`, среди хозяев модели выбирается самый быстрый).
  - В поле ввода одно меню моделей (провайдер → модель) и рядом выбор уровня рассуждений. Уровни свои у каждой модели: у DeepSeek «Выкл/Вкл», у GLM от «Низкий», у GPT и Gemini несколько уровней. У GPT рассуждения приходят зашифрованными: человеку виден только пересказ. На телефоне меню плоское («модель · провайдер»).
  - Выбор запоминается в чате. Модель можно сменить посреди чата: рассуждения прежней модели в запрос новой не уходят, но в базе и на экране остаются. Если сохранённой модели больше нет в каталоге, чат открывается на выборе по умолчанию, сообщения не меняются.
  - `extendCatalog` умеет больше: `removeProviders` (провайдер уходит, модель без провайдеров уходит вместе с ним) и `pinModelVersions` (закрепить версию модели у провайдера: `{ "gpt-6-luna": { openrouter: "openai/gpt-6-luna-2026-09-30" } }`). Ошибочная правка — ошибка при создании каталога.
  - Новые адреса сервера: `GET /api/chat/models` (список для меню, без ключей) и `PUT /api/chat/:id/model` (записать выбор чата).
  - Скин Тандема рисует `Composer` варианта `extended`. Договор скина стал версии 3: `Composer` получает необязательное `modelChoice`; свой скин без него работает как раньше. В `@ykurilov/agent-chat-react` есть хук `useModelChoice`.
  - Кэш: у Gemini через OpenRouter метка кэша теперь стоит и на последнем сообщении истории (скользящая точка, на следующем ходе переезжает на новое), поэтому кэшируется вся переписка, а не только инструкция. Для своего провайдера то же задаётся полем `lastMessageProviderOptions` в `requestOptions`.
  - Профиль модели получил отметку `toolResultImageProviders`: провайдеры, через которых модель видит картинку в результате инструмента (по живым замерам). У GPT 6 Luna и Gemini 3.8 Flash это `["openrouter"]`, у GLM 5.3 Flash и DeepSeek 4.1 Flash отметки нет. Ядро отметку не читает; по ней веб-инструменты решают, выдавать ли `page_screenshot`.
  - Если ключа выбранного провайдера временно нет, ответ идёт на запасной модели, но выбор пользователя в чате не перезаписывается: когда ключ вернётся, чат снова отвечает выбранной моделью.
  - Хранилища: у чата новое поле `reasoning` (уровень рассуждений). SQLite: колонка `chats.reasoning`, PostgreSQL: колонка `agent_chat.chats.reasoning`; миграции применяются сами при открытии базы, данные не теряются.
  
  ### Как обновить приложение
  
  1. Сервер (там, где `createChatHandler` или `createChatService`). Ищите `resolveModel`.
  
     Было:
  
     ```ts
     createChatHandler({
       // …
       resolveModel: async () => ({ modelId: "deepseek-4.1-flash", providerId: "deepseek" }),
       catalog: standardCatalog,
     });
     ```
  
     Стало:
  
     ```ts
     createChatHandler({
       // …
       // Только для нового чата; дальше модель выбирает пользователь. Можно не задавать:
       // тогда берётся первая модель каталога у первого провайдера с ключом.
       defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
       catalog: standardCatalog,
     });
     ```
  
     Раньше `resolveModel` мог выбирать модель по пользователю или чату. Теперь это делает пользователь в меню; ограничить выбор можно каталогом (`extendCatalog(standardCatalog, { removeProviders, removeModels, addModels, addProviders, pinModelVersions })`) и ключами на сервере: в меню попадают только провайдеры, чей ключ есть в окружении.
  2. Ключи. Хотите GPT 6 Luna, Gemini 3.8 Flash или GLM через OpenRouter — добавьте `OPENROUTER_API_KEY` в окружение сервера. Без него этих моделей в меню не будет; остальное работает как раньше.
  3. Свой словарь надписей. Если вы задали `ChatLabelsProvider labels={…}` не через `{ ...russianLabels, … }`, добавьте новые ключи: `reasoningLevels` (названия уровней: `off`, `on`, `minimal`, `low`, `medium`, `high`, `max`), `modelChoiceFailed` («Не удалось сменить модель») и `modelMenuFailed` («Список моделей не загрузился»). Через `{ ...russianLabels, … }` ничего делать не нужно.
  4. Свой скин. Договор версии 3: `Composer` получает необязательное `modelChoice` (`providers`, `current`, `onChange`, `reasoningLevels`, `reasoning`, `onReasoningChange`, `error`). Не рисуете его — выбора модели в чате не будет, всё остальное работает. Подробно: `docs/contracts/models-and-picker/skin.md`. Скин Тандема (`tandemSkin`) обновляется вместе с пакетом, править нечего.
  5. Своё хранилище (только если вы реализовали `ChatStorage` сами). Добавьте необязательное поле `reasoning?: string` в чат: `createChat` принимает и сохраняет его, `getChat` отдаёт (без значения — поля нет), `updateChatModel(chatId, { modelId, providerId, reasoning? })` записывает его целиком и без `reasoning` стирает сохранённый уровень. Наборы проверок `describeChatStorageContract` из `@ykurilov/agent-chat-core/storage-contract` проверяют это. Хранилища SQLite и PostgreSQL из SDK обновляются сами.
  6. Проверка: `pnpm typecheck` проходит; в браузере в поле ввода есть меню моделей и выбор рассуждений; выбор остаётся после обновления страницы; сообщение отправляется и ответ приходит по частям.
  7. Только если вы уже ставили `@ykurilov/agent-chat-web-tools` из main до этого выпуска: опция `screenshotProviders` убрана. Снимок страницы выдаётся по отметке `toolResultImageProviders` в профиле модели.
  
     Было:
  
     ```ts
     const webTools = createWebTools({ ...firecrawl, screenshotProviders: ["openrouter"] });
     ```
  
     Стало:
  
     ```ts
     const webTools = createWebTools(firecrawl);
     // Своя модель, у которой картинка из инструмента доходит через провайдера: добавьте отметку в профиль.
     // extendCatalog(standardCatalog, { addModels: [{ ...профиль, toolResultImageProviders: ["openrouter"] }] })
     ```
- b059fcc: Переписку теперь можно хранить в PostgreSQL, а чат подключается к Next.js. Хранилища проверяются одним и тем же набором тестов.
  
  - Новый пакет `@ykurilov/agent-chat-storage-postgres`: `createPostgresChatStorage({ connectionString })`. Таблицы лежат в отдельной схеме `agent_chat`, миграции применяются сами при создании, два сервера на старте друг другу не мешают.
  - В `@ykurilov/agent-chat-server` новая точка входа `@ykurilov/agent-chat-server/next`: `createNextRouteHandlers(chatHandler)` для файла маршрута App Router.
  - В `@ykurilov/agent-chat-core` набор проверок `describeChatStorageContract` дополнен: порядок сообщений при равном времени, изоляция чатов, очень длинный ответ, пустые поля. Хранилище в памяти для тестов остаётся в ядре, отдельного пакета нет.
  - В `@ykurilov/agent-chat-storage-sqlite` сообщения с одинаковым временем создания теперь читаются в порядке записи (раньше порядок между ними был не определён). Порядок держится на новой колонке `seq` в таблице `messages`, а не на внутреннем номере строки SQLite, который `VACUUM` вправе поменять. Миграция применяется сама при открытии базы: старые сообщения получают `seq` в том порядке, в каком лежали, данные не теряются.
  
  ### Как обновить приложение
  
  Только если вы берёте PostgreSQL или Next.js. Остальным обновление ничего не требует: SQLite и Hono работают как раньше, миграция SQLite (колонка `seq`) применится сама при первом запуске, делать с базой ничего не нужно.
  
  1. PostgreSQL вместо SQLite. В `server/index.ts` замените создание хранилища:
  
     Было:
  
     ```ts
     const storage = createSqliteChatStorage({ filePath: "chat.sqlite" });
     // при остановке: storage.close()
     ```
  
     Стало:
  
     ```ts
     import { createPostgresChatStorage } from "@ykurilov/agent-chat-storage-postgres";
  
     const storage = await createPostgresChatStorage({ connectionString: process.env.DATABASE_URL! });
     // при остановке: await chat.flush(); await storage.close()
     ```
  
     Адрес базы положите в `DATABASE_URL`. Пользователю базы нужно право создавать схему и таблицы. Переписку из SQLite пакет сам не переносит.
  2. Next.js. Создайте `app/api/chat/[[...path]]/route.ts` с `createNextRouteHandlers` и строками `export const dynamic = "force-dynamic"` и `export const runtime = "nodejs"`; `basePath` обработчика чата должен совпадать с путём маршрута. Нужен долгоживущий сервер, не serverless. Пример и подробности: `docs/getting-started.md`, раздел «Next.js».
  3. Проверка: `pnpm typecheck` проходит, чат отвечает по частям, «Остановить» работает.

### Patch Changes

- Updated dependencies [62027c6]
- Updated dependencies [b059fcc]
- Updated dependencies [61717c6]
  - @ykurilov/agent-chat-core@0.5.0

## 0.4.0

### Minor Changes

- 87c26eb: У обработчика чата появился метод `flush()`: он дописывает в базу остаток всех идущих ответов. Ядро теперь пишет идущий ответ не чаще раза в 0,5 секунды, поэтому при остановке сервера без `flush()` теряется до 0,5 с текста.
  
  ### Как обновить приложение
  
  Действие по желанию, но рекомендуется: при штатной остановке вызовите `await chat.flush()` после того, как сервер перестал принимать запросы, и до закрытия хранилища. Если приложение вызывало `service.flush()` из записи для `@ykurilov/agent-chat-core`, а сервис создаёт `createChatHandler`, вызывайте `chat.flush()`.
  
  Было:
  
  ```ts
  function shutdown() {
    server.close();
    storage.close();
    process.exit(0);
  }
  ```
  
  Стало:
  
  ```ts
  async function shutdown() {
    server.close();
    await chat.flush();
    storage.close();
    process.exit(0);
  }
  ```
  
  Проверка: `pnpm typecheck` проходит; начните длинный ответ, остановите сервер сигналом `SIGTERM` — в базе текст ответа до момента остановки.

### Patch Changes

- 0722f66: Если в адресе чата попадалась битая запись (например, `/api/chat/%E0`), сервер бросал необработанное исключение. Теперь он отвечает `404` с `{ "error": { "kind": "not_found" } }`, как на любой несуществующий чат.
  
  Обновление ничего не требует.
- Updated dependencies [ad8cf59]
  - @ykurilov/agent-chat-core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [a95b2d0]
  - @ykurilov/agent-chat-core@0.3.0

## 0.2.0

### Minor Changes

- ea50099: Первый выпуск Agent Chat SDK на складе GitHub Packages. Все пять пакетов теперь выходят вместе и
  с одной версией: «SDK 0.2.0» значит, что каждый пакет `@ykurilov/agent-chat-*` имеет версию 0.2.0.
  
  Что изменилось по сравнению с тем, как пакеты подключали раньше:
  
  - Пакеты приходят собранными (JavaScript и типы), а не исходниками TypeScript. Голый `node`
    запускает серверные пакеты без `tsx`.
  - Скин Тандема (`@ykurilov/agent-chat-skin-tandem`) теперь тоже пакет. Раньше папку `skins/tandem/src`
    копировали в приложение; копию можно удалить и подключить пакет.
  - Дизайн-система Тандем ставится вместе со скином как `@ykurilov/tandem-ui` (в коде остаётся
    импорт `@tandem/ui`).
  
  ### Как обновить приложение
  
  Если приложение подключало пакеты из этого репозитория без склада (ссылкой на папку или копией),
  переведите его на склад:
  
  1. В корне приложения в `.npmrc` оставьте одну строку:
  
     ```ini
     @ykurilov:registry=https://npm.pkg.github.com
     ```
  
  2. Поставьте пакеты: `pnpm add @ykurilov/agent-chat-core @ykurilov/agent-chat-server @ykurilov/agent-chat-storage-sqlite @ykurilov/agent-chat-react`.
  3. Если использовали скин Тандема из копии:
     - удалите папку с копией скина (например, `src/chat-skin`);
     - `pnpm add @ykurilov/agent-chat-skin-tandem "@tandem/ui@npm:@ykurilov/tandem-ui@^0.3.0"`;
     - в коде замените импорт `./chat-skin` на `@ykurilov/agent-chat-skin-tandem`;
     - в главном CSS-файле замените `@source` на папку скина на
       `@source "../node_modules/@ykurilov/agent-chat-skin-tandem/dist";`
       (путь считайте от CSS-файла до корня приложения).
  4. Проверка: `pnpm typecheck`, сборка приложения, чат открывается и отвечает.

### Patch Changes

- Updated dependencies [ea50099]
  - @ykurilov/agent-chat-core@0.2.0
