# @ykurilov/agent-chat-flows

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

### Minor Changes

- d7fc4e6: flow.reopen: брошенный разговор (`abandoned`) или законченный своей причиной приложения открывается заново в той же ноде с памятью; касания с первого шага, дни программы от исходного старта; событие onReopen; поле reopened_at (миграции SQLite и PostgreSQL).

### Patch Changes

- @ykurilov/agent-chat-core@0.68.0
  - @ykurilov/agent-chat-react@0.68.0

## 0.67.0

### Minor Changes

- 12c0dd8: Потолок «пишет первым» по дням программы: `schedule.firstMessages.maxPerDayByDay` (`[3, 2]` — день 1 три, со дня 2 по
  два; главнее `maxPerDay`; ответ человека счёт не обнуляет). Свои касания ноды до N-го дня программы:
  `nudges.untilProgramDay` (дошёл до ноды позже — сразу общий ряд). `checkFlow`: `nudges_until_day_invalid`,
  `nudges_until_day_after_end`, `max_per_day_by_day_after_end`. Доска: поле «по дням программы» и режим «до дня программы»
  (ru/en); `FlowStateTimingProps` + `nudgesUntilProgramDay`, `onNudgesUntilProgramDayChange`; выгружены `parseCapsByDay`,
  `capsByDayText`.

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

### Minor Changes

- 814ee7f: Пометка «Агент написал первым — человек молчал 1 ч 7 мин» перед ответом, который агент написал сам. Ядро: право чата `appNotices` (по умолчанию выключено) — служебные пометки приложения (`kind: "app"`) уходят в историю без текста для модели и только через белый список `appNoticeViews` (имя → безопасные данные для экрана; без функции пометка не уходит); `modelDetails: false` выключает и `appNotices`. React: `noticeLines` у `AgentChat` (имя пометки → строка), договор скина 27 — необязательный `ServiceLine`. Сценарии: в данных пометки `silentMs` (от последнего сообщения человека) и `exit`, проекция для экрана регистрируется в `withChat`, готовые строки `flowNoticeLines()` с подписями `russianFlowNoticeLabels`/`englishFlowNoticeLabels` (`FlowLabels.notices`); `FlowTestChat` передаёт их в `renderChat(chatId, { noticeLines })`. Тандем рисует `ServiceLine`. Как подключить — CHANGES.md, раздел 0.65.0.

### Patch Changes

- Updated dependencies [814ee7f]
  - @ykurilov/agent-chat-core@0.65.0
  - @ykurilov/agent-chat-react@0.65.0

## 0.64.0

### Minor Changes

- 1ea05c0: Тестовый чат: кнопка «К следующему напоминанию» проматывает часы ровно к моменту, когда сценарий сам напишет первым (касание, утреннее, выход по сроку, «срок вышел», «не завершил»; ночь и потолки учтены), и поле «своё время» («15 мин», «1 ч 30 мин», «2 дня»). Сервер: `flow.advanceTestClock({ ownerId, chatId, to: "next_first_message" })` → `{ timeOffset, reason }`, впереди ничего — `FlowTestClockError` с `code: "nothing_scheduled"`. Браузер: `FlowTestChatConnection.advanceToNextFirstMessage`. Разбор длительности — `parseDuration` из `/format`. Скин: необязательные `onNextFirstMessage`, `nothingScheduled`, `onAdvanceText` и пять надписей. Как подключить — CHANGES.md, раздел 0.64.0.

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

### Minor Changes

- 8a9e399: Доска сценария больше не показывает «Сохранено» для несохранённых правок после возвращения на вкладку: новое необязательное `savedValue` у `FlowEditor` и функция `sameFlow` из `@ykurilov/agent-chat-flows/react`.
  
  ### Как обновить приложение
  
  Если `FlowEditor` стоит на отдельной вкладке и размонтируется при уходе, передайте `savedValue={сценарий, как он лежит на сервере}`. Без него поведение прежнее.

### Patch Changes

- @ykurilov/agent-chat-core@0.63.0
  - @ykurilov/agent-chat-react@0.63.0

## 0.62.0

### Minor Changes

- 8e068e3: Судья после хода смотрит реплики с ответа агента, на котором чат вошёл в текущее состояние, до ответа этого хода — по истории ветки. Вопрос из прошлого состояния больше не переводит чат дальше. Место чата помнит `enteredAfterAnswer`. Ответ агента этого хода судья видит всегда, даже если прочитал историю раньше, чем ответ в неё лёг. Журнал судьи: вход (усечённо, без ключей) и ответ. По умолчанию тексты реплик — только в тестовом чате, боевой переход — без текстов (выход, вероятность, число и длины реплик). Настройка — `judge.journal` (`"transitions"`, `"always"`, `"off"`), приёмник — `logJudge`, по умолчанию `console.info`.

### Patch Changes

- @ykurilov/agent-chat-core@0.62.0
  - @ykurilov/agent-chat-react@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-core@0.61.0
  - @ykurilov/agent-chat-react@0.61.0

## 0.60.0

### Minor Changes

- 6e8723c: Снимок страницы в ответе инструмента уходит картинкой к Together и Fireworks (раньше — строкой текста, ход зависал); профиль DeepSeek 4.1 Flash видит снимки через DeepSeek, Together, Fireworks и OpenRouter. Сценарии не называют инструменты, которых нет у модели этого хода; правила просмотра ссылок — в описании инструмента.

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-core@0.60.0
  - @ykurilov/agent-chat-react@0.60.0

## 0.59.0

### Minor Changes

- fc1f387: Поддельные служебные блоки в ответе модели вырезаются сами. Один список форматов: ядро (`CORE_SERVICE_BLOCKS` — сводка, шаги ответа, место на экране, служебные пометки), пакеты (память `<agent_memory>`, вложения `<attachment>`, навыки `<skill>` и их список, строки сценария) и приложение — `agent.serviceBlocks` (`{ tag }` или `{ name, line, match?, until? }`, ошибка — `TypeError` при создании службы). Блок с начала строки вырезается в потоке до экрана, записи и следующего шага; в прошлых ответах — только в запросе, байт в байт одинаково (кэш). Код, цитаты и упоминания посреди фразы не трогаются, пустым ответ не остаётся. Журнал: `[служебный блок вырезан] тег=… чат=… ответ=… модель=… провайдер=…`.
  
  ### Как обновить приложение
  
  Ничего делать не нужно. Своя вырезка служебных блоков в приложении больше не нужна — свои теги передайте в `agent.serviceBlocks`.

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

### Minor Changes

- 7c82b87: Перевод чатов на новую версию теперь отбирает чаты. `flow.chatsByState` и `flow.migrateChats` по умолчанию не берут
  закончившиеся разговоры и тестовые чаты редактора (`FlowTestChat`). Свой отбор — `chatIds` и `filter(chat)` (запись
  прогона и `Chat.data`), одинаково в обоих вызовах: что посчитали, то и переведут. Вернуть прежнее поведение —
  `includeEnded: true, includeTestChats: true`. Окно «Перевести чаты» после перевода перечитывает счётчик.
  
  ### Как обновить приложение
  
  1. Если приложение держало чужие строки `agent_chat.flow_chats` своей транзакцией (`for update`), чтобы `migrateChats`
     их пропустил, — уберите этот обход и передайте отбор прямо в вызовы:
  
     Было:
  
     ```ts
     await client.query("select chat_id from agent_chat.flow_chats where ... for update", [...]);
     await flow.migrateChats({ flowId, toVersionId, map, flow: next });
     ```
  
     Стало:
  
     ```ts
     await flow.migrateChats({ flowId, toVersionId, map, flow: next, chatIds });
     ```
  
     В `chatsByState` передайте тот же отбор (`chatIds` или `filter`).
  2. Нужны закончившиеся разговоры или тестовые чаты в переводе — добавьте `includeEnded: true` или
     `includeTestChats: true` в оба вызова.
  3. Своё хранилище сценариев (`FlowStore`) — добавьте метод `listFlowChats({ flowId, exceptVersionId?, chatIds? })` и
     поддержку `chatIds` в `migrateBatch`. Хранилища SDK (память, SQLite, PostgreSQL) уже умеют.
  4. Проверка: `pnpm typecheck` проходит; окно «Перевести чаты» показывает число без закончившихся и тестовых чатов.

### Patch Changes

- 34074f9: Шапка доски сценария на телефоне: лишние кнопки уходят в меню «⋯», Прогон, Проверить граф и сохранение остаются на виду.
  Новая подпись `labels.header.more`.
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

### Minor Changes

- 7b5ed35: Сценарии: подписи событий приложения — `catalog.events` принимает `{ name, label }`; доска, прогон, карточка условия и
  `describeCondition` с каталогом показывают подпись.
- 98e1e86: Сценарии: утреннее сообщение перезапускает ряд касаний — молчун каждый день получает утреннее и ряд заново, до потолка
  дня. Смена поведения для сценариев с утренним и `afterSilence`.
- b17e389: Сценарии: таймер «наступил день N программы» (`{ type: "timer", from: "program_day", day }`) — выход в начале дня N
  по нумерации `readRun().day`, без хода приложения. Дополнение к формату v2; `checkFlow` проверяет день против
  `lengthDays`; на доске «Длится» → «до дня программы», подпись «с дня N».
  Вошёл в ноду уже в день N или позже — выход в том же ходе, один ответ из новой ноды; так же `since_start`, чей срок
  прошёл к входу.
- f1151a6: Сценарии: свои касания ноды на N дней (`nudges.days`) — потом утреннее и общий ряд сценария с начала. Доска:
  «Свои касания действуют», подпись на карточке.

### Patch Changes

- Updated dependencies [51f7b38]
- Updated dependencies [cdc7dd7]
  - @ykurilov/agent-chat-core@0.55.0
  - @ykurilov/agent-chat-react@0.55.0

## 0.54.0

### Minor Changes

- bc3cef1: Доска сценария: больше места графу. Узкая шапка (`header="compact"`), легенда «Условий выхода» по умолчанию свёрнута в кнопку
  (`legend`), панель «Сценарий» сворачивается (`inspector`), мини-карта сворачивается (`minimap`), редактор разворачивается на
  весь экран (`fullscreen`). Свёрнутое запоминается в localStorage (`storageKey`). Договор скина: необязательные `compact` и
  `fullscreen` у шапки, `compact` у рамки, часть `FlowBoardToggle`.

### Patch Changes

- Updated dependencies [c8fb0dd]
- Updated dependencies [73d3aaa]
- Updated dependencies [fa90219]
  - @ykurilov/agent-chat-react@0.54.0
  - @ykurilov/agent-chat-core@0.54.0

## 0.53.0

### Minor Changes

- b6a7786: Сценарии: конец разговора без сбоев, «не сейчас», пояс по умолчанию, реплика сотрудника, тихое утро, касания с
  карточками; расход по списку чатов.
  
  - Конец разговора («срок вышел», «не завершил», прощание) больше не зависит от того, начался ли ход касания. Касания
    сценария не режет потолок ядра «5 ходов сервера подряд»; у `deliverNotices` — свой потолок `maxServerTurnsInRow`
    (число или `false`, по умолчанию 5, `MAX_SERVER_TURNS_IN_ROW`).
  - Мягкий потолок сценария: 50 ходов сервера подряд без человека (`timers.maxServerTurnsInRow`), дальше касания ждут
    его сообщения, конец разговора — в свой срок. Срок без причин писать не повторяется каждый час.
  - `canWriteNow` → `false` — «не сейчас»: касание через час; `"never"` — молчать до сообщения человека; `{ retryAt: Date }`
    — в свой момент (негодная дата — как `false`, прошлая — через минуту). Сроки конца разговора не снимаются.
  - Человек писал до начала дня меньше 3 часов назад (`skipMorningIfHumanWithinMin`) — касания в начале дня ждут, не только
    утреннее. Переход ноды по сроку и ответ на ночные сообщения не ждут.
  - Сообщения после жёсткой рамки дня ставят срок на утро сами: ответ на накопленное приходит в `dayStart` при любых
    касаниях. Их время — в данных чата (`flowHeldHuman`); для правила 3 часов, «не завершил» и перехода «человек молчит»
    они — сообщения человека.
  - `attach.deliver` получает `parts` — все части ответа для человека (карточка ролика, картинка, файл, виджет), `text`
    прежний; `deliverNotices({ awaitAnswer }).answer.parts`; `deliverableParts` из ядра.
  - `storage.sumUsageByChat({ chatIds, ownerId?, source?, since? })` — расход по списку чатов одним запросом (память,
    SQLite, PostgreSQL; общие тесты хранилищ).
  - `createAgentFlow({ defaultTimeZone })` — пояс, пока пояс человека неизвестен. Порядок: человек → страница →
    `defaultTimeZone` → пояс службы → сервер. `prepareTurn` получает `pageTimeZone` — пояс, присланный страницей.
  - `service.appendStaffMessage({ ownerId, chatId, text, staffName?, wakeAgent? })` — реплика живого сотрудника: модель
    видит её словами сотрудника, `person_link_view` словами человека её не считает, проверки ответа агента её текст знают,
    ход сама не начинает.
    `flow.noteStaffReply` пишет тем же путём и принимает `staffName`. Экран: необязательный `StaffMessage` скина (договор 25),
    без него — ответ агента с подписью `labels.notices.staffSaid`.
  - `flow.tick()` в публичном типе, `factId` из пакета, перемотка до утра у чата, закреплённого через `adopt` без хода.
  
  Как обновить приложение: снимите `it.fails` у теста «молчун все три дня»; ответ эксперта кладите
  `appendStaffMessage` / `noteStaffReply` вместо сообщения собеседника и уберите обёртку `withoutNonPersonWords`; по желанию
  `defaultTimeZone` и `StaffMessage` в своём скине; снимите `it.fails` у теста «касание, отложенное ночью до утра»;
  доставляйте `message.parts` в своей доставке касаний; расход по чатам — `sumUsageByChat`.

### Patch Changes

- Updated dependencies [b6a7786]
  - @ykurilov/agent-chat-core@0.53.0
  - @ykurilov/agent-chat-react@0.53.0

## 0.52.0

### Minor Changes

- d9b2ea5: Редактор сценариев (`FlowEditor`) для кабинета эксперта: три мелочи.
  
  - `readOnly` — доска только для просмотра, пока сценарий правит внешний агент. Нельзя двигать, соединять и удалять узлы,
    править панели, сохранять, загружать JSON и переводить чаты. Открывать узлы, проверять граф, прогонять и смотреть JSON
    можно. В шапке плашка «Только просмотр» (`labels.header.readOnly`).
  - `onSave` может вернуть `{ ok: false, issues?: [{ path, message }] }`: отказ без исключения. Шапка пишет «Не
    сохранено», `issues` встают у нод и выходов и видны в «Проверить граф». Ничего (`void`) и `{ ok: true }` — успех, как
    раньше. Исключение из `onSave` — такой же отказ, без необработанной ошибки в консоли.
  - `className` и `style` у `FlowEditor` идут на корень. Корень по умолчанию занимает высоту родителя, но не меньше 60%
    экрана (не меньше 420 px), на телефоне — экрана целиком (не меньше 640 px): холст не схлопывается.
  
  Как обновить приложение: вместо обёртки «inert» на время правок агента передайте `readOnly`; из `onSave` возвращайте
  `{ ok: false, issues }` при отказе сервера; ручную высоту у родителя редактора можно убрать. Договор скина редактора: все
  новые поля необязательные (`saveFailed`, `readOnly` у шапки, `readOnly` у окна JSON, `className` и `style` у раскладки),
  свой скин без них работает.

### Patch Changes

- @ykurilov/agent-chat-core@0.52.0
  - @ykurilov/agent-chat-react@0.52.0

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
