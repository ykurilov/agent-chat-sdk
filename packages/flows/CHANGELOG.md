# @ykurilov/agent-chat-flows

## 0.51.0

### Minor Changes

- 41b1726: Проверка ответа: **тексты приложения.** В `replyChecks` появилось `knownTexts: ({ ownerId, chatId }) => string[] | Promise<string[]>` — первое сообщение, прощание, названия роликов: слова и ссылки оттуда больше не вырезаются и не считаются чужими. Если `replyChecks` передан в `flow.withChat(…)`, сценарий сам добавляет свои тексты (общая часть, ноды, первые сообщения, прощание, рамка дня, попутные задачи). **Проверка текста вне хода:** `service.checkReply({ ownerId, chatId, text })` → `{ text, notes }` — те же проверки и тот же набор «виденного», что у хода. **Исправление:** служебные сообщения приложения (`app`, «напиши первым») и реплики сотрудника больше не делают ссылку законной — «виденное от человека» берётся только из сообщений человека (итоги фоновых задач остаются виденными). Если агент должен повторять ссылки из своих служебных сообщений, назовите их в `knownTexts`. Подробно — `docs/reply-check.md`.

### Patch Changes

- cd55c82: Проверка сценария больше не ругается на ноду, в которую ведёт только «срок вышел» (`schedule.deadlineState`): она считается достижимой.
- Updated dependencies [41b1726]
  - @ykurilov/agent-chat-core@0.51.0
  - @ykurilov/agent-chat-react@0.51.0

## 0.50.0

### Minor Changes

- 68b0629: Свободные факты о человеке в карточке клиента: `createAgentFlow({ clientFacts: true })`. Агент пишет факт
  `flow_note { fact }`, `client_card` показывает и стирает, блок `flow:client` несёт список «Факты о человеке», «забудь всё»
  стирает и поля, и факты. Свои таблицы приложения — необязательное `clientCard.facts: { read, add, forget }`; нет — факты
  лежат в таблице модуля записями `fact:<id>`. Правило в инструкции делит факты (карточка) и правила общения (долгая память
  SDK). `flow.readClientCard` отдаёт факты записями `fact:<id>`, `useClientCard` — опция `factName`. Без `clientFacts` всё как
  в 0.49. Просмотр ссылки (`person_link_view`): «не открылась — сказать один раз» и расход в журнал описаны в
  `docs/flows.md` и README web-tools, закреплены тестами.
- 25aaf22: Перенос идущих чатов и конец разговора снаружи. Сценарий без новых полей ведёт себя как в 0.49. Подробно —
  `docs/flows.md` и раздел 0.50.0 в `CHANGES.md`.
  
  - `flow.adopt({ ownerId, chatId, flowId, versionId, flow, stateId, startedAt, enteredAt, lastHumanAt, lastAgentAt, nudgeStep, today, timeZone })`
    закрепляет идущий чат сразу, без хода, и ставит срок следующего касания. `today: { firstMessages, humanMessages, dayClosed }`
    продолжает дневной потолок и рамки дня. Те же поля принимает `loadFlow`. Перенос переживает перезапуск.
  - `flow.end({ ownerId, chatId, reason, outcome })` — конец разговора со своей причиной (`"switched"`): `onFinish`
    (`reason`, `outcome`), сроки сняты, дальше — как настроено `afterEnd`. `FlowEndReason` принимает любую строку.
  - `agent.stepContext` в ходе «пишет первым» получает `firstReasons` — все причины хода; тип `FlowStepContextInput`.
  - `nudges` в корне сценария — касания без «Дней и времени». Порядок: своё у ноды → `"off"` → `schedule.nudges` →
    `nudges` сценария. Новая находка проверки `nudges_shadowed`.
  - Документация: ночью агент отвечает человеку, тихие часы — только для сообщений первым; `admit` → `hold` бывает
    только после жёсткой рамки дня.
  
  ### Как обновить приложение
  
  1. Поднимите все пакеты `@ykurilov/agent-chat-*` до этой версии вместе. Миграций нет.
  2. Ничего больше не нужно, если вы не используете новое.
  3. Переносите идущие чаты из своей системы — зовите `flow.adopt` для каждого чата после `createChat`, а не ждите
     `loadFlow` на первом ходе: молчащий чат иначе не получит касаний.
  4. Если в коде есть исчерпывающая проверка причины конца (`switch (end.reason)` с `never` в `default`), добавьте
     ветку для своих причин: `FlowEndReason` теперь принимает любую строку.
  5. Своё хранилище сценариев (`FlowStore`) менять не нужно: новые поля переноса лежат в той же JSON-колонке `placement`.

### Patch Changes

- @ykurilov/agent-chat-core@0.50.0
  - @ykurilov/agent-chat-react@0.50.0

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
  - @ykurilov/agent-chat-react@0.49.0

## 0.48.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [fa10d5a]
  - @ykurilov/agent-chat-core@0.48.0
  - @ykurilov/agent-chat-react@0.48.0
