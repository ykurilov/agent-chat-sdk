# @ykurilov/agent-chat-messengers

## 0.82.1

### Patch Changes

- @ykurilov/agent-chat-core@0.82.1
  - @ykurilov/agent-chat-react@0.82.1

## 0.82.0

### Patch Changes

- @ykurilov/agent-chat-core@0.82.0
  - @ykurilov/agent-chat-react@0.82.0

## 0.81.0

### Minor Changes

- 58204d2: **Ломает приложения со своим хранилищем мессенджеров или сценариев.** Хранилища из пакетов (память, SQLite,
  Postgres) уже готовы — если вы передаёте их, менять ничего не нужно.
  
  - `MessengerStore`: новый обязательный метод `saveLinkIfFree` и признак `guarded: true`. Привязка аккаунта по коду
    идёт только через `saveLinkIfFree`: два кода разных людей на один аккаунт мессенджера больше не переписывают друг
    друга.
  - `FlowStore`: новый обязательный метод `swapDelivery` и признак `guarded: true`.
  - Без `guarded: true` `createMessengers` и `createAgentFlow` сразу бросают `TypeError`. Признак — обещание, что
    хранилище выполняет условия держателя и аренды (список — в шаге 3 ниже).
  
  Новое для своей доставки сценария (`attach({ deliver })`):
  
  - Исход `{ status: "await_repair" }` — канал сломан и ждёт починки (например, отозван токен бота). Ответ ждёт,
    попытка не тратится, новых ходов и касаний нет. Починили — `flow.resumeDelivery({ ownerId, chatId, messageId })`:
    тот же `messageId`, текст и части уходят ближайшим обходом таймеров. Ответ: `resumed`, `pending`, `busy`,
    `not_found` или `dropped` (человек уже написал после ответа — ответ снят и помечен недоставленным). Ожидание
    переживает перезапуск. В `reportDelivery` этот исход — `TypeError`.
  - Пока идёт `deliver`, аренда чата продлевается: вторая копия сервера ту же попытку не начинает. Копия упала посреди
    отправки — та же попытка повторяется через её паузу. Итог устаревшей копии не пишется.
  - Перед самым `deliver`, уже под резервом, SDK ещё раз сверяет: разговор не закончен после хода (`flow.end`), ответ
    есть в ветке, после починки человек не написал после него. Иначе `deliver` не зовётся, ответ помечен недоставленным.
  - Повтор доставки прощания у законченного разговора теперь доходит — без нового хода и без открытия разговора.
  - «Ровно один раз» снаружи SDK не обещает: после падения копии тот же ответ может уйти ещё раз с тем же `messageId`.
    Двойную отправку отсекает приложение по `messageId`.
  
  Остальные исправления аудита работают без правок в приложении:
  
  - Ход группы мессенджера остаётся групповым и тогда, когда агент пишет первым, когда человек правит сообщение
    группы, шлёт поправку к ходу или нажимает кнопку-подсказку: без памяти и личных блоков владельца, только
    разрешённые группе инструменты, с пределом сообщений участника.
  - Удаление чата ждёт хода на любой копии сервера: идёт ход — `ChatBusyError`, чат цел.
  - Не удалось отметить вложения сообщения прикреплёнными — ошибка доходит до вызывающего, сообщение не записывается,
    место в счёте сообщений отдаётся назад; повтор того же сообщения проходит.
  - Сценарий, который не сходится с подтверждениями приложения (`confirmations`, `exitGuards`), проверяется до записи
    версии и закрепления чата: чат идёт без сценария, перевод чатов на такую версию — отказ.
  - Копия сервера, у которой забрали аренду таймера сценария или обновления мессенджера, больше не шлёт касание и не
    переписывает срок и итог другой копии.
  
  ### Как обновить приложение
  
  Нужно только если приложение передаёт в `createMessengers` или `createAgentFlow` своё хранилище (не
  `createMemoryMessengerStore`, `createSqliteMessengerStore`, `createPostgresMessengerStore`, `memoryFlowStore`,
  `sqliteFlowStore`, `postgresFlowStore`).
  
  1. Найдите свою реализацию `MessengerStore` (поиск по `MessengerStore` или `saveLink(`).
  2. Добавьте метод — одной атомарной операцией базы:
  
     ```ts
     async saveLinkIfFree(link) {
       // Аккаунт свободен или уже за link.userId — записать (имя и время обновить) и вернуть "saved".
       // Аккаунт за другим пользователем — ничего не менять и вернуть "taken".
     }
     ```
  
     В SQL это `insert … on conflict (messenger, bot_id, external_user_id) do update set … where user_id = $userId
     returning …`: строка вернулась — `"saved"`, нет — `"taken"`. Отдельные «найти, потом записать» не годятся: между
     ними успевает второй код.
  3. Добавьте признак `guarded: true` в объект хранилища. Он обещает:
     - `finishUpdate(key, status, now, holder)`, `renewUpdates` и `releaseUpdate` пишут, только пока обновление за этим
       держателем; `acquireLease` не отдаёт чужую живую аренду;
     - `saveLinkIfFree` — одна атомарная операция.
  4. Своё `FlowStore` (если есть): метод `swapDelivery(chatId, { expected, next, due, claim, freeAt, endedAt })` одной
     транзакцией. Заменить запись доставки, только если сейчас там `expected` (совпали `messageId`, `attempt` и `token`;
     `null` — записи нет). С `claim` — только если аренда чата свободна, уже у `claim.owner` или у `claim.from`, и взять
     её до `now + leaseMs`. С `freeAt` — только если живой аренды нет. С `endedAt` — только если конец разговора всё
     ещё этот (`null` — не закончен). `due` записать вместе с записью. Вернуть `true`,
     если заменил этот вызов. Плюс `guarded: true`, который обещает:
     - `setDue(…, { leaseOwner })` пишет, только пока аренда у этой копии; `{ unlessDelivery: true }` — только если
       доставки не ждёт;
     - `leaseDue` не берёт живую аренду, а законченные разговоры берёт только со сроком `FLOW_DELIVERY_EXIT`;
     - `endChat` при ждущей доставке не снимает срок и аренду.
     Образец — `postgresFlowStore` и `sqliteFlowStore` в `@ykurilov/agent-chat-flows`.
  5. Проверка: `pnpm typecheck` проходит. Без признака или без `saveLinkIfFree` запуск сразу бросает `TypeError` с
     подсказкой, без `swapDelivery` — `attach({ deliver })`.

### Patch Changes

- Updated dependencies [038b6e2]
- Updated dependencies [58204d2]
  - @ykurilov/agent-chat-react@0.81.0
  - @ykurilov/agent-chat-core@0.81.0

## 0.80.1

### Patch Changes

- Updated dependencies [d59ae4e]
  - @ykurilov/agent-chat-core@0.80.1
  - @ykurilov/agent-chat-react@0.80.1

## 0.80.0

### Patch Changes

- Updated dependencies [2cc8429]
  - @ykurilov/agent-chat-core@0.80.0
  - @ykurilov/agent-chat-react@0.80.0

## 0.79.1

### Patch Changes

- @ykurilov/agent-chat-core@0.79.1
  - @ykurilov/agent-chat-react@0.79.1

## 0.79.0

### Patch Changes

- Updated dependencies [88886de]
  - @ykurilov/agent-chat-core@0.79.0
  - @ykurilov/agent-chat-react@0.79.0

## 0.78.0

### Patch Changes

- @ykurilov/agent-chat-core@0.78.0
  - @ykurilov/agent-chat-react@0.78.0

## 0.77.0

### Patch Changes

- Updated dependencies [f4c13da]
  - @ykurilov/agent-chat-core@0.77.0
  - @ykurilov/agent-chat-react@0.77.0

## 0.76.0

### Patch Changes

- @ykurilov/agent-chat-core@0.76.0
  - @ykurilov/agent-chat-react@0.76.0

## 0.75.0

### Patch Changes

- Updated dependencies [dfb9869]
  - @ykurilov/agent-chat-react@0.75.0
  - @ykurilov/agent-chat-core@0.75.0

## 0.74.0

### Patch Changes

- Updated dependencies [3140c17]
  - @ykurilov/agent-chat-react@0.74.0
  - @ykurilov/agent-chat-core@0.74.0

## 0.73.0

### Patch Changes

- Updated dependencies [34fec8f]
  - @ykurilov/agent-chat-core@0.73.0
  - @ykurilov/agent-chat-react@0.73.0

## 0.72.0

### Patch Changes

- @ykurilov/agent-chat-core@0.72.0
  - @ykurilov/agent-chat-react@0.72.0

## 0.71.1

### Patch Changes

- Updated dependencies [519914e]
  - @ykurilov/agent-chat-react@0.71.1
  - @ykurilov/agent-chat-core@0.71.1

## 0.71.0

### Patch Changes

- Updated dependencies [8b8c651]
  - @ykurilov/agent-chat-core@0.71.0
  - @ykurilov/agent-chat-react@0.71.0

## 0.70.1

### Patch Changes

- Updated dependencies [ba86a4a]
  - @ykurilov/agent-chat-core@0.70.1
  - @ykurilov/agent-chat-react@0.70.1

## 0.70.0

### Patch Changes

- Updated dependencies [7e54665]
  - @ykurilov/agent-chat-core@0.70.0
  - @ykurilov/agent-chat-react@0.70.0

## 0.69.1

### Patch Changes

- Updated dependencies [857777b]
  - @ykurilov/agent-chat-core@0.69.1
  - @ykurilov/agent-chat-react@0.69.1

## 0.69.0

### Patch Changes

- Updated dependencies [e6c03dc]
  - @ykurilov/agent-chat-core@0.69.0
  - @ykurilov/agent-chat-react@0.69.0

## 0.68.0

### Patch Changes

- @ykurilov/agent-chat-core@0.68.0
  - @ykurilov/agent-chat-react@0.68.0

## 0.67.0

### Patch Changes

- @ykurilov/agent-chat-core@0.67.0
  - @ykurilov/agent-chat-react@0.67.0

## 0.66.0

### Patch Changes

- Updated dependencies [1d57795]
  - @ykurilov/agent-chat-core@0.66.0
  - @ykurilov/agent-chat-react@0.66.0

## 0.65.1

### Patch Changes

- Updated dependencies [ca56c29]
  - @ykurilov/agent-chat-core@0.65.1
  - @ykurilov/agent-chat-react@0.65.1

## 0.65.0

### Patch Changes

- Updated dependencies [814ee7f]
  - @ykurilov/agent-chat-core@0.65.0
  - @ykurilov/agent-chat-react@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [99cded9]
  - @ykurilov/agent-chat-core@0.64.0
  - @ykurilov/agent-chat-react@0.64.0

## 0.63.2

### Patch Changes

- Updated dependencies [c772243]
  - @ykurilov/agent-chat-core@0.63.2
  - @ykurilov/agent-chat-react@0.63.2

## 0.63.1

### Patch Changes

- Updated dependencies [8bcee93]
  - @ykurilov/agent-chat-react@0.63.1
  - @ykurilov/agent-chat-core@0.63.1

## 0.63.0

### Patch Changes

- @ykurilov/agent-chat-core@0.63.0
  - @ykurilov/agent-chat-react@0.63.0

## 0.62.0

### Patch Changes

- @ykurilov/agent-chat-core@0.62.0
  - @ykurilov/agent-chat-react@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-core@0.61.0
  - @ykurilov/agent-chat-react@0.61.0

## 0.60.0

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-core@0.60.0
  - @ykurilov/agent-chat-react@0.60.0

## 0.59.0

### Patch Changes

- Updated dependencies [fc1f387]
  - @ykurilov/agent-chat-core@0.59.0
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
  - @ykurilov/agent-chat-react@0.58.0

## 0.57.0

### Patch Changes

- Updated dependencies [ade99cc]
- Updated dependencies [86afa20]
- Updated dependencies [624c10c]
  - @ykurilov/agent-chat-core@0.57.0
  - @ykurilov/agent-chat-react@0.57.0

## 0.56.0

### Patch Changes

- Updated dependencies [1eadba9]
- Updated dependencies [24c313e]
  - @ykurilov/agent-chat-react@0.56.0
  - @ykurilov/agent-chat-core@0.56.0

## 0.55.0

### Patch Changes

- Updated dependencies [51f7b38]
- Updated dependencies [cdc7dd7]
  - @ykurilov/agent-chat-core@0.55.0
  - @ykurilov/agent-chat-react@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [c8fb0dd]
- Updated dependencies [73d3aaa]
- Updated dependencies [fa90219]
  - @ykurilov/agent-chat-react@0.54.0
  - @ykurilov/agent-chat-core@0.54.0

## 0.53.0

### Patch Changes

- Updated dependencies [b6a7786]
  - @ykurilov/agent-chat-core@0.53.0
  - @ykurilov/agent-chat-react@0.53.0

## 0.52.0

### Patch Changes

- @ykurilov/agent-chat-core@0.52.0
  - @ykurilov/agent-chat-react@0.52.0

## 0.51.0

### Patch Changes

- Updated dependencies [41b1726]
  - @ykurilov/agent-chat-core@0.51.0
  - @ykurilov/agent-chat-react@0.51.0

## 0.50.0

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
  - @ykurilov/agent-chat-react@0.48.0

## 0.47.0

### Patch Changes

- Updated dependencies [5a59c33]
  - @ykurilov/agent-chat-core@0.47.0
  - @ykurilov/agent-chat-react@0.47.0

## 0.46.2

### Patch Changes

- Updated dependencies [3d0d2f2]
  - @ykurilov/agent-chat-core@0.46.2
  - @ykurilov/agent-chat-react@0.46.2

## 0.46.1

### Patch Changes

- @ykurilov/agent-chat-core@0.46.1
  - @ykurilov/agent-chat-react@0.46.1

## 0.46.0

### Patch Changes

- Updated dependencies [56d7528]
- Updated dependencies [a1933fd]
- Updated dependencies [52cc67d]
  - @ykurilov/agent-chat-core@0.46.0
  - @ykurilov/agent-chat-react@0.46.0

## 0.45.0

### Patch Changes

- Updated dependencies [eb74c58]
- Updated dependencies [ac9aede]
  - @ykurilov/agent-chat-react@0.45.0
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
  - @ykurilov/agent-chat-react@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [763f4c5]
  - @ykurilov/agent-chat-core@0.43.0
  - @ykurilov/agent-chat-react@0.43.0

## 0.42.0

### Patch Changes

- Updated dependencies [a385276]
  - @ykurilov/agent-chat-core@0.42.0
  - @ykurilov/agent-chat-react@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [9472fcb]
  - @ykurilov/agent-chat-core@0.41.0
  - @ykurilov/agent-chat-react@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [0e7aab3]
  - @ykurilov/agent-chat-core@0.40.0
  - @ykurilov/agent-chat-react@0.40.0

## 0.39.1

### Patch Changes

- Updated dependencies [5c0f3af]
  - @ykurilov/agent-chat-react@0.39.1
  - @ykurilov/agent-chat-core@0.39.1

## 0.39.0

### Patch Changes

- Updated dependencies [3b90429]
  - @ykurilov/agent-chat-core@0.39.0
  - @ykurilov/agent-chat-react@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [1cae504]
- Updated dependencies [4065a4a]
  - @ykurilov/agent-chat-core@0.38.0
  - @ykurilov/agent-chat-react@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [7f49d12]
- Updated dependencies [ea78982]
  - @ykurilov/agent-chat-core@0.37.0
  - @ykurilov/agent-chat-react@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [3487fb4]
- Updated dependencies [8c43b86]
- Updated dependencies [6f42418]
- Updated dependencies [5f13c74]
  - @ykurilov/agent-chat-core@0.36.0
  - @ykurilov/agent-chat-react@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6ceee78]
- Updated dependencies [2382026]
  - @ykurilov/agent-chat-react@0.35.0
  - @ykurilov/agent-chat-core@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [d039ce4]
  - @ykurilov/agent-chat-core@0.34.0
  - @ykurilov/agent-chat-react@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [4a72339]
  - @ykurilov/agent-chat-core@0.33.0
  - @ykurilov/agent-chat-react@0.33.0

## 0.32.0

### Minor Changes

- 2fa3104: Ломает приложения: файл или голосовое из мессенджера больше 20 МБ больше не принимается. Раньше такой файл
  скачивался целиком в память и уходил во вложения чата.
  
  Мессенджеры читают входящие данные с потолком размера. Тело вебхука Telegram, VK и MAX больше 1 МиБ не читается
  целиком — ответ 413. Файл и голосовое скачиваются не больше 20 МБ: чтение обрывается на пределе, даже если мессенджер
  не сообщил размер или занизил его. Человек получает фразу «файл слишком большой» (`fileTooBig`) или «голосовое
  слишком длинное» (`voiceTooLong`), а не «не получилось».
  
  ### Как обновить приложение
  
  1. Код менять не нужно. Если приложение принимало через мессенджер файлы больше 20 МБ, предупредите людей: такие файлы
     теперь загружаются через веб-чат.
  2. Если приложение задаёт свои фразы бота (`texts`), проверьте `fileTooBig`: теперь она приходит и тогда, когда
     мессенджер не сообщил размер файла.
  3. Проверка: файл до 20 МБ, отправленный боту, доходит до чата; файл больше — человек получает фразу `fileTooBig`.
- 853edb7: Ломает приложения: у `MessengerStore` три новых метода и новый аргумент `claimUpdate` — своё хранилище мессенджеров
  перестанет собираться. Хранилищ из пакета это не касается.
  
  Входящее сообщение из мессенджера больше не теряется навсегда.
  
  - Раньше сервер, упавший между записью обновления и ответом, терял сообщение: повтор от мессенджера отбрасывался, а
    недоделанное никто не подбирал. Теперь обновление лежит в хранилище с содержимым за копией сервера (аренда 2 минуты).
    Копия упала — его подбирает живая копия или эта же после `start()`.
  - База не приняла обновление — вебхук отвечает 503, и мессенджер повторяет. При опросе то же обновление пробуется
    снова с растущей паузой (от секунды до 30 секунд), а не пропускается. Не записывается десять минут подряд —
    пропускается с ошибкой в `logError`, чтобы одно битое обновление не держало бота.
  - Postgres-хранилище убирает символ NUL из строк от мессенджера и модели: раньше запись с ним падала.
  - Обработка сорвалась с ошибкой — повтор через полминуты. После трёх повторов или суток обновление брошено, ошибка
    уходит в `logError`.
  - Двойного ответа нет. Номер сообщения агенту берётся из ключа обновления. Повтор сверяется с историей чата: на
    отвеченное сообщение второго хода нет. Записанное без ответа служба доводит сама, файлы не скачиваются снова.
  - Приём — «хотя бы раз»: команда, обработанная перед падением сервера, может выполниться второй раз. Повтор встаёт
    за более поздними сообщениями, порядок при повторе не гарантирован.
  - Миграция `0003` для SQLite и Postgres добавляет колонки в `messenger_updates` и применяется сама.
  
  ### Как обновить приложение
  
  Хранилища пакета (память, SQLite, Postgres) и `ChatService` ядра — ничего делать не нужно, миграция применяется сама.
  
  1. Своё хранилище (поиск по `MessengerStore` в коде приложения): `claimUpdate` получает третий аргумент `work` и
     сохраняет его содержимое; добавьте методы `renewUpdates`, `releaseUpdate`, `takeAbandonedUpdates`.
  
     Было:
  
     ```ts
     claimUpdate(key: string, now: string): Promise<boolean>;
     ```
  
     Стало:
  
     ```ts
     claimUpdate(key: string, now: string, work?: UpdateWork): Promise<boolean>;
     renewUpdates(keys: readonly string[], holder: string, leaseUntil: string): Promise<void>;
     releaseUpdate(key: string, holder: string, retryAt: string): Promise<void>;
     takeAbandonedUpdates(bot: { messenger: MessengerName; botId: string }, holder: string, now: string, leaseUntil: string, limit: number): Promise<AbandonedUpdate[]>;
     ```
  
     Типы `UpdateWork` и `AbandonedUpdate` — из `@ykurilov/agent-chat-messengers`. Образец — `createMemoryMessengerStore` пакета. `purgeBefore` не должен удалять необработанные обновления
     с живой арендой (`lease_until` не раньше `before`); с арендой, истёкшей раньше `before`, — удаляет.
  2. Своя служба чата вместо `ChatService` ядра: `getHistory` отдаёт у сообщений номер (`id`). Без него повтор после
     сбоя не узнает уже отправленное сообщение.
  3. Проверка: `pnpm typecheck` без ошибок; сообщение боту получает ответ.
- e7d6d48: Ломает приложения: аккаунт мессенджера, уже привязанный к другому пользователю, новым кодом больше не переносится,
  а выдача и снятие привязки с чужой страницы получают 403.
  
  Привязка аккаунтов мессенджеров стала строже.
  
  - Аккаунт мессенджера, уже привязанный к одному пользователю, код другого пользователя больше не переносит. Человек
    получает новую фразу `linkTaken`, привязка остаётся прежней, `onUnlinked` и `onLinked` не приходят. Раньше аккаунт
    молча переезжал к владельцу кода. Чтобы перенести аккаунт, его сначала отключают в приложении у прежнего пользователя.
  - Выдача и снятие привязки (`POST /links`, `DELETE /links/<мессенджер>`) с чужой страницы с куками человека получают
    403 `{ error: { kind: "forbidden_origin" } }`, как запросы чата. Новая настройка `allowedOrigins` у `createMessengers`
    пускает нужные чужие страницы.
  - Битый адрес отвязки (`/links/%`) — 400 вместо сбоя; тело `POST /links` больше 1 МиБ — 413.
  
  ### Как обновить приложение
  
  1. Если панель «Подключить мессенджер» открыта на другом адресе, чем API (фронт на `https://app.example.com`, API на
     `https://api.example.com`, или чат встроен в GetCourse), передайте тот же список, что у `createChatServer`:
  
     ```ts
     createMessengers({ ...options, allowedOrigins: ["https://app.example.com"] });
     ```
  
     Своя страница на том же адресе работает без настройки.
  2. Если приложение задаёт свои фразы бота (`texts`), можно задать и `linkTaken`. Не задана — фраза по умолчанию.
  3. Если приложение рассчитывало на перенос аккаунта мессенджера к другому пользователю по новому коду, теперь
     человек сначала отключает аккаунт у прежнего пользователя.
  4. Проверка: в приложении «Подключить» выдаёт ссылку, привязка по ней проходит.
- dac242f: Ломает приложения: бот VK на Callback API без секретного ключа больше не запускается — `vkBot` бросает понятную
  ошибку при старте, если `receive.callback.secret` пустой или не задан.
  
  Раньше с пустым секретом настоящие события VK отклонялись (бот молчал), а подделка с `"secret": ""` проходила как
  настоящая. Подтверждение адреса (`confirmation`) теперь тоже всегда сверяет секрет. Бот на Long Poll секрет не требует.
  
  ### Как обновить приложение
  
  Касается только ботов VK с `receive: { callback: … }`. Бот на Long Poll (`receive: { longPoll: true }`) менять не нужно.
  
  1. В сообществе VK: «Управление» → «Работа с API» → «Callback API» → «Настройки сервера» — впишите «Секретный ключ»
     (латинские буквы и цифры) и сохраните.
  2. В файле, где создаётся бот (поиск по `vkBot(`), передайте тот же ключ, например из переменной окружения
     `VK_CALLBACK_SECRET`:
  
     Было:
  
     ```ts
     vkBot({ token, groupId, groupScreenName, receive: { callback: { secret: "", confirmation } } });
     ```
  
     Стало:
  
     ```ts
     vkBot({ token, groupId, groupScreenName, receive: { callback: { secret: process.env.VK_CALLBACK_SECRET!, confirmation } } });
     ```
  
  3. Проверка: `pnpm typecheck`, сервер стартует без ошибки «vk: для Callback API нужен секретный ключ», сообщение боту
     в VK получает ответ.

### Patch Changes

- 2f95dfa: Группы: имя участника из профиля мессенджера уходит модели одной строкой не длиннее 64 знаков, без переводов строк,
  управляющих и невидимых знаков. Так в имя не спрятать «инструкции» для модели. Пустое имя — номер участника (`id…`).
  
  Обновление ничего не требует.
- 294e1e8: Хранилище мессенджеров больше не растёт без конца. После `start()` записи старше 30 дней убираются при запуске и
  потом раз в час: коды привязки, принятые обновления, кнопки под ответами, обращения участников групп. Необработанное входящее обновление остаётся, пока
  его держат или ждут повтора; брошенное больше 30 дней назад (например, бот убран из настроек) убирается. Раньше
  `purgeBefore` никто не вызывал. У разговоров появился индекс по чату агента (миграция `0002` для SQLite и Postgres
  применяется сама при создании хранилища): поиск разговоров чата больше не просматривает всю таблицу.
  
  Обновление ничего не требует.
- Updated dependencies [4087a22]
- Updated dependencies [71c32b7]
- Updated dependencies [cae13bf]
- Updated dependencies [a94bda9]
- Updated dependencies [4e44492]
- Updated dependencies [ac9b7d3]
- Updated dependencies [27f4b1e]
  - @ykurilov/agent-chat-react@0.32.0
  - @ykurilov/agent-chat-core@0.32.0

## 0.31.2

### Patch Changes

- 6177508: VK Callback API: запрос подтверждения адреса (`confirmation`) теперь сверяет секрет, как и остальные события.
  Раньше строку подтверждения получал любой, кто знает номер сообщества. Если в `receive.callback.secret` секрет
  задан, `confirmation` с чужим или пустым `secret` получает 403. Секрет не задан — поведение прежнее.
- @ykurilov/agent-chat-core@0.31.2
  - @ykurilov/agent-chat-react@0.31.2

## 0.31.1

### Patch Changes

- 8c539eb: Фразы бота по умолчанию без пустого обещания «Пишите — отвечу»:
  
  - после привязки (`linked`) — «Готово: аккаунт подключён.»;
  - `/start` без кода (`hello`) — «Здравствуйте! Чем помочь?»;
  - `/help` (`helpSingle`, `helpMany`) — «Задайте вопрос сообщением. …» и список команд.
  
  ### Как обновить приложение
  
  Ничего менять не нужно. Если ваши тесты сравнивают ответ бота с прежними фразами — сравнивайте с
  `defaultMessengerTexts.linked` (и т. п.) или задайте свои фразы через `texts`. Прежние фразы вернуть можно так же:
  `texts: { linked: "Готово: аккаунт подключён. Пишите — отвечу." }`.
- @ykurilov/agent-chat-core@0.31.1
  - @ykurilov/agent-chat-react@0.31.1

## 0.31.0

### Minor Changes

- 7f10a41: Бот только для привязки и уведомлений теперь собирается без обходных путей.
  
  - **`service` необязателен.** Без службы чата бот привязывает и отвязывает аккаунты, а привязанному человеку на любое
    сообщение, команду, голосовое, файл и кнопку отвечает новой фразой `notifyOnly` (пустая — тишина). Ход агента не
    начинается, файлы и голосовые не скачиваются, нажатие кнопки подтверждается без текста. Отказ `resolveAccount`
    по-прежнему главнее. Фразы по умолчанию не обещают разговор: `linked` — «Готово: аккаунт подключён.», `howToConnect`
    зовёт подключить аккаунт ради уведомлений (`defaultMessengerTextsWithoutChat`). Порядок: фраза бота → общая `texts` →
    умолчание бота без чата. Настройки разговора (`groups`, `conversations`, `chatForConversation`, `attachments`,
    `transcribe`, `voiceReplies`, `taskReadyPing`, `webChatUrl`) без `service` задать нельзя: это ошибка типов. Типы
    настроек: `MessengersOptions = MessengersBaseOptions & (MessengersChatOptions | MessengersWithoutChatOptions)`.
  - **Меню команд по желанию.** `commandsMenu: false` в `createMessengers` или у бота (`telegramBot`, `maxBot`; бот
    главнее) — `start()` не ставит меню и снимает поставленное раньше. Без `service` меню снимается всегда. Пустой список
    в `adapter.setCommands([], scope)` теперь значит «снять меню»: Telegram зовёт `deleteMyCommands`, MAX шлёт пустой
    список `commands` (так велит документация dev.max.ru; живым ботом снятие меню MAX не проверено). По умолчанию меню ставится, как раньше.
  - **`onUnlinked(link)`.** Сигнал после того, как привязка удалена: человек отвязал аккаунт в приложении
    (`DELETE /links/<мессенджер>`, по сигналу на каждый аккаунт) или тот же аккаунт мессенджера привязал другой
    пользователь (сигнал о прежней привязке — перед `onLinked` новой). Сбой уходит в `logError` и отвязку не отменяет.
    Сигнал может повториться — обработчик должен быть идемпотентным. Ответ 204 на отвязку ждёт обработчик: долгий
    `onUnlinked` задерживает ответ.
  - **`close()` у хранилищ обязателен в типе.** `createPostgresMessengerStore` и `createSqliteMessengerStore` возвращают
    `ClosableMessengerStore`: `close()` закрывает свой пул или файл, повторный вызов ничего не делает. Не удалось
    подготовить хранилище — соединение закрывается до ошибки.
  
  ```ts
  const store = await createPostgresMessengerStore({ connectionString });
  const messengers = createMessengers({
    store,
    bots: [vkBot({ /* … */ texts: { linked: "Аккаунт привязан.", linkFailed: "", howToConnect: "", notifyOnly: "", writeInPrivate: "" } })],
    basePath: "/api/messengers",
    resolveUser,
    onUnlinked: (link) => newsletter.unsubscribe(link.userId, `${link.messenger}:${link.externalUserId}`),
  });
  await messengers.start();
  // при остановке: await messengers.stop(); await store.close();
  ```
  
  ### Как обновить приложение
  
  1. Если ничего не меняете — шагов нет: с `service` бот работает как в 0.30.0, меню ставится как раньше.
  2. Бот только для привязки, которому подсовывали пустую службу чата: уберите `service` и заглушку. Привязанным теперь
     отвечает `notifyOnly` — задайте свою фразу в `texts` (или `""`). `linked` и `howToConnect` по умолчанию сменились
     на фразы без обещания разговора; свои фразы из `texts` главнее. Если `resolveAccount` был нужен только для отказа
     всем, его можно убрать: непривязанным отвечает `howToConnect`, привязанным — `notifyOnly`.
  3. Не нужно меню команд — `commandsMenu: false`. Старое меню снимется при следующем `start()`.
  4. Убираете человека из рассылки при отвязке — `onUnlinked`, идемпотентно («убрать, если есть»). Тяжёлую работу
     ставьте в очередь: ответ 204 ждёт обработчик.
  5. При остановке сервера: `await messengers.stop(); await store.close();`. Вызов `store.close?.()` тоже работает.
  6. Свой адаптер мессенджера: `setCommands([], scope)` должен снимать меню (или ничего не делать, если меню нет).
  7. Тип службы брали из настроек (`MessengersOptions["service"]` или `Parameters<typeof createMessengers>[0]["service"]`)?
     Теперь в нём есть и `undefined`, и вместе с `webChatUrl`, `groups` и другими настройками разговора `typecheck`
     выдаст ошибку. Берите тип прямо: `import type { MessengerChatService } from "@ykurilov/agent-chat-messengers"`.
     То же, если служба в переменной с типом «служба или `undefined`»: настройки разговора задаются только вместе с
     настоящей службой.
  8. Проверка: `pnpm typecheck` проходит; после `start()` у бота без меню в Telegram нет `/help` и `/stop`. Снимаются
     меню личных и групповых чатов; общее меню из BotFather (и меню для отдельных языков) очистите там. Снятие меню MAX
     проверено только по документации MAX — посмотрите на живом боте.

### Patch Changes

- @ykurilov/agent-chat-core@0.31.0
  - @ykurilov/agent-chat-react@0.31.0

## 0.30.0

### Minor Changes

- 2514722: Фразы бота теперь настраиваются в приложении. Новая настройка `texts` есть у `createMessengers` (для всех ботов) и у
  каждого бота: `telegramBot`, `vkBot`, `maxBot`. Фраза бота главнее общей, общая главнее фразы по умолчанию. Все фразы по
  умолчанию и их тип — `defaultMessengerTexts` и `MessengerTexts` из `@ykurilov/agent-chat-messengers`. Пустая строка или
  фраза-функция, вернувшая `""`, значит «ничего не отправлять». Исключения:
  
  - нажатие своей кнопки бот всё равно подтверждает, только без текста, — иначе у человека вечно крутится загрузка. Без
    ответа остаются только чужие и неизвестные кнопки, кнопки от того, кому писать нельзя, и кнопки в группе не от
    плательщика;
  - пустые `done`, `stopped`, `answerFailed` на месте строки статуса («Работаю…») удаляют это сообщение. Для этого у
    адаптера появился необязательный метод `deleteMessage(sent)`; в Telegram, VK и MAX он есть. Свой адаптер без него
    оставит строку статуса как есть;
  - фразы над кнопками (`chatsTitle`, `approvalQuestion`, `taskApprovalQuestion`) заглушить нельзя: пустая — фраза по
    умолчанию.
  
  ```ts
  createMessengers({
    // …
    texts: { howToConnect: "Это бот уведомлений. Откройте приложение." },
    bots: [vkBot({ /* … */ texts: { linked: "Аккаунт привязан.", linkFailed: "", writeInPrivate: "" } })],
  });
  ```
  
  `/stop` в личке теперь подчиняется тем же правилам, что обычное сообщение. Если `resolveAccount` отказал, человек
  получает текст отказа, а пустой отказ — тишина. Раньше `/stop` от непривязанного шёл мимо `resolveAccount` и всегда
  получал «Чтобы я отвечал, подключите этот аккаунт…». Рецепт «бот только для привязки и уведомлений» — в README пакета.
  
  ### Как обновить приложение
  
  1. Если ничего не меняете — шагов нет: без `texts` бот говорит те же фразы, что в 0.29.0.
  2. Если в приложении есть `resolveAccount` с отказом (`{ refuse: "…" }`): теперь `/stop` от отказанного человека
     получает этот же текст, а не «подключите этот аккаунт». Если нужен прежний текст, верните его в отказе.
  3. Нужны свои фразы — передайте `texts` в `createMessengers` или в нужного бота. Список фраз —
     `defaultMessengerTexts`; тип `Partial<MessengerTexts>` подскажет имена.
  4. Проверка: `pnpm typecheck` проходит; непривязанный аккаунт пишет боту и получает вашу фразу (или ничего при `""`).

### Patch Changes

- @ykurilov/agent-chat-core@0.30.0
  - @ykurilov/agent-chat-react@0.30.0

## 0.29.0

### Minor Changes

- 4279ae0: Приложение теперь узнаёт, что человек привязал мессенджер: в `createMessengers` появилась необязательная настройка
  `onLinked(link)`. Её вызывают после того, как привязка сохранена, и ждут до ответа «Готово: аккаунт подключён». Так
  приложение может, например, выдать бонус за привязку ВК или Telegram. Неверный, просроченный и уже использованный код
  сигнала не дают. Ошибка внутри `onLinked` уходит в `logError`, привязка не отменяется, человек получает обычный ответ.
  
  ```ts
  createMessengers({
    // …
    onLinked: async (link) => {
      // link: { messenger, botId, externalUserId, userId, name, username?, linkedAt }
      await grantLimitReset(link.userId, `${link.messenger}:${link.externalUserId}`);
    },
  });
  ```
  
  Сигнал может прийти не один раз для одного аккаунта мессенджера: человек отвязал и привязал снова, или тот же аккаунт
  привязал другой пользователь приложения. Награду выдавайте идемпотентно, например по паре `messenger` + `externalUserId`.
  
  Обновление ничего не требует: без `onLinked` всё работает как раньше. Подробно — README пакета и `docs/messengers.md`,
  раздел «Сигнал о привязке».

### Patch Changes

- @ykurilov/agent-chat-core@0.29.0
  - @ykurilov/agent-chat-react@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [11c3c97]
- Updated dependencies [d63ccaa]
- Updated dependencies [6a2f903]
- Updated dependencies [189cba9]
  - @ykurilov/agent-chat-core@0.28.0
  - @ykurilov/agent-chat-react@0.28.0

## 0.27.0

### Minor Changes

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
- e0bb519: Маршруты OpenRouter и переход на запасного провайдера посреди ответа.
  
  - **Маршруты OpenRouter.** `createOpenRouterProvider({ id, displayName, only, order, allowFallbacks, requireParameters })`.
    Маршрут с `id` — отдельный провайдер каталога: например, `or-deepseek` только с хозяином `deepseek` и
    `or-fireworks` только с `fireworks`. Он обслуживает те же модели, что `openrouter`: id моделей, цены, закреплённые
    версии и отметка «видит картинку в результате инструмента» переходят сами. Своя запись модели для маршрута главнее.
    Провайдер `openrouter` должен остаться в каталоге, иначе ошибка при сборке каталога. Маршруты попадают и в порядок
    запасных провайдеров по умолчанию. С `order` сортировка `sort: "throughput"` по умолчанию больше не ставится; явный
    `sort` остаётся. Один хозяин и в `only`, и в `ignore` — ошибка при создании; все хозяева `only` запрещены профилем
    модели — понятная ошибка запроса.
  - **Переход посреди ответа** (по желанию): `agent.providerFallback: { onSilence: "restart-step-on-next" }`. Модель
    замолчала дольше `modelSilenceTimeout`, до первого куска или посреди ответа. Тогда шаг обрывается и начинается заново
    у следующего провайдера списка `byModel`, без повтора у того же. Показанный текст шага стирается: клиент получает часть
    `data-step-reset` («убрать всё от последней части `step-start`»). В сохранённом ответе и в запросе модели стёртого
    нет. `useAgentChat` и мессенджеры убирают стёртое сами, и решения хука («Повторить», «Ответить заново») стёртого не
    видят. Своя лента на сырых частях — `withoutResetSteps(parts)` из core или react. Ход с переходом сразу после `start`
    присылает кусок `data-steps-may-reset` (только клиенту): мессенджер по нему держит части идущего шага в живом
    сообщении до конца шага, а стёртый целиком текст заменяет фразой «Пишу ответ заново…».
    Шаг, где инструмент уже получил вход целиком, не стирается: ответ продолжается у запасного.
    `scope: "step"` — следующий шаг снова у основного провайдера (по умолчанию `"turn"`); только после перехода при
    молчании, запасной по перегрузке остаётся до конца хода. Перегрузка у запасного ведёт к следующему за ним.
    `maxSwitches` — переходов за ход, по умолчанию 1; каждый съедает шаг из предела шагов. Стёртый шаг оплачен и есть в
    расходе хода и в записи после перезапуска сервера. Срок хода `turnTimeoutMs` идёт и во время перехода;
    `maxOutputTokens` действует в каждом заходе; после начала `flush` новых заходов нет (`stopReason: "shutdown"`);
    при «Стоп» или остановке службы перехода нет и показанное не стирается. В журнале сервера — строка
    `[переход при молчании]`.
  - **Остановка службы — для всех приложений.** С этой версии `flush` с первых мгновений ожидания идущих ответов
    запрещает ходам новые заходы: к запасному провайдеру, автопродолжение, продолжение после сжатия. Ход, которому нужен новый
    заход, кончается остановкой (`stopReason: "shutdown"`), даже без `onSilence`. Раньше такой ход мог начать новый
    заход посреди остановки сервера.
  
  ### Как обновить приложение
  
  Ничего делать не нужно: без `onSilence` всё работает как раньше. Включить переход — `agent.providerFallback:
  { byModel: { "deepseek-4.1-flash": ["or-fireworks"] }, onSilence: "restart-step-on-next" }` и маршруты в
  `extendCatalog(..., { addProviders: [...] })`. Если лента строится на сохранённых или сырых частях без `useAgentChat` —
  пропускайте их через `withoutResetSteps` (есть в core и в react). Если маршрут OpenRouter задаёт `order` и рассчитывал
  на сортировку по скорости, задайте `sort: "throughput"` явно. Проверка: `pnpm typecheck`.

### Patch Changes

- Updated dependencies [d8341b2]
- Updated dependencies [5e4ed28]
- Updated dependencies [e0bb519]
  - @ykurilov/agent-chat-core@0.27.0
  - @ykurilov/agent-chat-react@0.27.0

## 0.26.2

### Patch Changes

- Updated dependencies [f24858a]
  - @ykurilov/agent-chat-core@0.26.2
  - @ykurilov/agent-chat-react@0.26.2

## 0.26.1

### Patch Changes

- Updated dependencies [5b52515]
  - @ykurilov/agent-chat-react@0.26.1
  - @ykurilov/agent-chat-core@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [eb43e47]
  - @ykurilov/agent-chat-core@0.26.0
  - @ykurilov/agent-chat-react@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [99d426e]
- Updated dependencies [d8201f6]
  - @ykurilov/agent-chat-core@0.25.0
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
  - @ykurilov/agent-chat-react@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [30fb729]
  - @ykurilov/agent-chat-react@0.23.0
  - @ykurilov/agent-chat-core@0.23.0

## 0.22.0

### Patch Changes

- @ykurilov/agent-chat-core@0.22.0
  - @ykurilov/agent-chat-react@0.22.0

## 0.21.0

### Patch Changes

- Updated dependencies [7c3bcc4]
  - @ykurilov/agent-chat-core@0.21.0
  - @ykurilov/agent-chat-react@0.21.0

## 0.20.0

### Minor Changes

- fd16b01: Два новых пакета.
  
  - `@ykurilov/agent-chat-background` — фоновые задачи: инструмент или помощник работает в фоне, итог приходит в чат служебным сообщением, задачи переживают перезапуск сервера. Хранилища: память, SQLite, PostgreSQL. README пакета и `docs/background.md`.
  - `@ykurilov/agent-chat-messengers` — чат приложения в Telegram, VK и MAX: привязка аккаунтов, вебхук или опрос, группы, файлы, голос, голосовые ответы, карточки задач, доставка «хотя бы раз». README пакета и `docs/messengers.md`. Для вида панели подключения — `MessengersSkin` v1.
  
  Что сделать в приложении: ставить нужно только если нужны фон или мессенджеры; подключение — по README пакетов.

### Patch Changes

- Updated dependencies [fd16b01]
- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-core@0.20.0
  - @ykurilov/agent-chat-react@0.20.0
