# @ykurilov/agent-chat-skin-tandem

## 0.79.1

### Patch Changes

- Updated dependencies [7d5d652]
  - @ykurilov/agent-chat-flows@0.79.1
  - @ykurilov/agent-chat-mcp@0.79.1
  - @ykurilov/agent-chat-messengers@0.79.1
  - @ykurilov/agent-chat-react@0.79.1
  - @ykurilov/agent-chat-sandbox@0.79.1
  - @ykurilov/agent-chat-skills@0.79.1

## 0.79.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.79.0
  - @ykurilov/agent-chat-mcp@0.79.0
  - @ykurilov/agent-chat-messengers@0.79.0
  - @ykurilov/agent-chat-sandbox@0.79.0
  - @ykurilov/agent-chat-skills@0.79.0
  - @ykurilov/agent-chat-react@0.79.0

## 0.78.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.78.0
  - @ykurilov/agent-chat-mcp@0.78.0
  - @ykurilov/agent-chat-messengers@0.78.0
  - @ykurilov/agent-chat-react@0.78.0
  - @ykurilov/agent-chat-sandbox@0.78.0
  - @ykurilov/agent-chat-skills@0.78.0

## 0.77.0

### Patch Changes

- Updated dependencies [f4c13da]
  - @ykurilov/agent-chat-flows@0.77.0
  - @ykurilov/agent-chat-mcp@0.77.0
  - @ykurilov/agent-chat-messengers@0.77.0
  - @ykurilov/agent-chat-sandbox@0.77.0
  - @ykurilov/agent-chat-skills@0.77.0
  - @ykurilov/agent-chat-react@0.77.0

## 0.76.0

### Minor Changes

- 6a50705: Общие переходы `anyState` перенесены из служебной ноды в отдельную панель настроек сценария. Шапка, меню телефона и обзор дают явный доступ; правила показывают условие и цель, сохраняют порядок, исключения и все настройки. Холст и мини-карта содержат только реальные состояния; старый `layout["@any"]` сохраняется, но не влияет на место или масштаб. Замечания проверки ведут к разделу и фокусируют правило; `readOnly` оставляет просмотр без изменений.
  
  ### Как обновить приложение
  
  Обновите используемые пакеты SDK одной версией. `FlowEditor`/`FlowTestChat` с `tandemFlowEditorSkin` не требуют новых пропсов. JSON и runtime не меняются, удалять legacy-раскладку не требуется. Собственный скин может обработать необязательные `FlowHeaderProps.onOpenAnyState` и `FlowExitCardProps.summary`, а существующий слот обзора `sections` должен отображаться. Старый экспорт `FlowAnyStateNode` сохранён, доска его не вызывает. Проверьте компактную шапку, переход из замечаний при закрытом инспекторе и сохранение правил.

### Patch Changes

- Updated dependencies [6a50705]
  - @ykurilov/agent-chat-flows@0.76.0
  - @ykurilov/agent-chat-mcp@0.76.0
  - @ykurilov/agent-chat-messengers@0.76.0
  - @ykurilov/agent-chat-react@0.76.0
  - @ykurilov/agent-chat-sandbox@0.76.0
  - @ykurilov/agent-chat-skills@0.76.0

## 0.75.0

### Minor Changes

- dfb9869: Необязательные `AgentChat.header` и `AgentChat.completion`: приложение задаёт шапку и свой итог. Итог появляется после успешно загруженной истории, когда ход свободен, скрывает поле без сброса черновика и не меняет серверное состояние. Во время ответа или активного голосового ввода управление остановкой доступно. Новые слоты Layout описаны в договоре скина 31.
  
  В «Одуванчике» общая колонка DS 730px для шапки, переписки и поля; действия видны при наведении/фокусе и всегда на touch; поле 26–160px и круглые кнопки 40px. Используются готовые ChatHeader/ChatProgress/CompletionCard из DS, без копирования компонентов. Явный Тандем поддерживает необязательные слоты в своём оформлении.
  
  ### Как обновить приложение
  
  Обновите используемые пакеты SDK одной версией. Скин «Одуванчик» использует ds-react ^0.3.0 и ds-tokens ^0.2.0, отдельного CSS-импорта сверх CSS скина не требуется. Для прямых импортов ChatProgress/CompletionCard добавьте в зависимости приложения `@ykurilov/ds-react ^0.3.0`, `@ykurilov/ds-tokens ^0.2.0` и `@phosphor-icons/react ^2.1.10`. Новые свойства необязательны. Приложение передаёт `header={{ title, aside }}` и `completion={<CompletionCard .../>}`; снятие `completion` возвращает поле с прежним черновиком. Слова, статусы и действия принадлежат приложению; английские имена статусов задайте через `statusNames`. Без новых свойств дополнительных действий нет. Для собственного скина — поддержка Layout.header/completion по docs/skin-v31.md.

### Patch Changes

- Updated dependencies [dfb9869]
  - @ykurilov/agent-chat-react@0.75.0
  - @ykurilov/agent-chat-flows@0.75.0
  - @ykurilov/agent-chat-messengers@0.75.0
  - @ykurilov/agent-chat-sandbox@0.75.0
  - @ykurilov/agent-chat-mcp@0.75.0
  - @ykurilov/agent-chat-skills@0.75.0

## 0.74.0

### Patch Changes

- Updated dependencies [3140c17]
  - @ykurilov/agent-chat-react@0.74.0
  - @ykurilov/agent-chat-sandbox@0.74.0
  - @ykurilov/agent-chat-flows@0.74.0
  - @ykurilov/agent-chat-messengers@0.74.0
  - @ykurilov/agent-chat-mcp@0.74.0
  - @ykurilov/agent-chat-skills@0.74.0

## 0.73.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.73.0
  - @ykurilov/agent-chat-mcp@0.73.0
  - @ykurilov/agent-chat-messengers@0.73.0
  - @ykurilov/agent-chat-sandbox@0.73.0
  - @ykurilov/agent-chat-skills@0.73.0
  - @ykurilov/agent-chat-react@0.73.0

## 0.72.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.72.0
  - @ykurilov/agent-chat-mcp@0.72.0
  - @ykurilov/agent-chat-messengers@0.72.0
  - @ykurilov/agent-chat-react@0.72.0
  - @ykurilov/agent-chat-sandbox@0.72.0
  - @ykurilov/agent-chat-skills@0.72.0

## 0.71.1

### Patch Changes

- Updated dependencies [519914e]
  - @ykurilov/agent-chat-react@0.71.1
  - @ykurilov/agent-chat-flows@0.71.1
  - @ykurilov/agent-chat-messengers@0.71.1
  - @ykurilov/agent-chat-sandbox@0.71.1
  - @ykurilov/agent-chat-mcp@0.71.1
  - @ykurilov/agent-chat-skills@0.71.1

## 0.71.0

### Patch Changes

- Updated dependencies [8b8c651]
  - @ykurilov/agent-chat-react@0.71.0
  - @ykurilov/agent-chat-flows@0.71.0
  - @ykurilov/agent-chat-mcp@0.71.0
  - @ykurilov/agent-chat-messengers@0.71.0
  - @ykurilov/agent-chat-sandbox@0.71.0
  - @ykurilov/agent-chat-skills@0.71.0

## 0.70.1

### Patch Changes

- @ykurilov/agent-chat-flows@0.70.1
  - @ykurilov/agent-chat-mcp@0.70.1
  - @ykurilov/agent-chat-messengers@0.70.1
  - @ykurilov/agent-chat-sandbox@0.70.1
  - @ykurilov/agent-chat-skills@0.70.1
  - @ykurilov/agent-chat-react@0.70.1

## 0.70.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.70.0
  - @ykurilov/agent-chat-mcp@0.70.0
  - @ykurilov/agent-chat-messengers@0.70.0
  - @ykurilov/agent-chat-sandbox@0.70.0
  - @ykurilov/agent-chat-skills@0.70.0
  - @ykurilov/agent-chat-react@0.70.0

## 0.69.1

### Patch Changes

- 857777b: Ряд значков шагов в Тандеме — по настоящей ширине строки, «+N» всегда помещается, не вылезает за край узкой колонки; модели заголовков раздумий уходит не больше 1200 знаков раздумья (начало и конец) — длинный заголовок вдвое дешевле.
- @ykurilov/agent-chat-flows@0.69.1
  - @ykurilov/agent-chat-mcp@0.69.1
  - @ykurilov/agent-chat-messengers@0.69.1
  - @ykurilov/agent-chat-sandbox@0.69.1
  - @ykurilov/agent-chat-skills@0.69.1
  - @ykurilov/agent-chat-react@0.69.1

## 0.69.0

### Minor Changes

- e6c03dc: Значки шагов и заголовки раздумий (106): в простом виде — ряд значков у «Сделано N шагов» и список «значок + фраза» (`StepIcon`, `icon` в `stepPhrases`, `guessStepIcon`); `thoughtTitles` у службы чата — заголовок раздумья от провайдера или пересказ дешёвой моделью в фоне, хранится в части раздумья, в запрос основной модели не идёт, расход `thought_title`; договор скина 28 (`WorkStepsView.live.icon`, `done.items`, `icons`, `moreIcons`, `Reasoning.title`); фраза навыка с именем.

### Patch Changes

- Updated dependencies [e6c03dc]
  - @ykurilov/agent-chat-react@0.69.0
  - @ykurilov/agent-chat-skills@0.69.0
  - @ykurilov/agent-chat-flows@0.69.0
  - @ykurilov/agent-chat-mcp@0.69.0
  - @ykurilov/agent-chat-messengers@0.69.0
  - @ykurilov/agent-chat-sandbox@0.69.0

## 0.68.0

### Patch Changes

- Updated dependencies [d7fc4e6]
  - @ykurilov/agent-chat-flows@0.68.0
  - @ykurilov/agent-chat-mcp@0.68.0
  - @ykurilov/agent-chat-messengers@0.68.0
  - @ykurilov/agent-chat-react@0.68.0
  - @ykurilov/agent-chat-sandbox@0.68.0
  - @ykurilov/agent-chat-skills@0.68.0

## 0.67.0

### Minor Changes

- 12c0dd8: Потолок «пишет первым» по дням программы: `schedule.firstMessages.maxPerDayByDay` (`[3, 2]` — день 1 три, со дня 2 по
  два; главнее `maxPerDay`; ответ человека счёт не обнуляет). Свои касания ноды до N-го дня программы:
  `nudges.untilProgramDay` (дошёл до ноды позже — сразу общий ряд). `checkFlow`: `nudges_until_day_invalid`,
  `nudges_until_day_after_end`, `max_per_day_by_day_after_end`. Доска: поле «по дням программы» и режим «до дня программы»
  (ru/en); `FlowStateTimingProps` + `nudgesUntilProgramDay`, `onNudgesUntilProgramDayChange`; выгружены `parseCapsByDay`,
  `capsByDayText`.

### Patch Changes

- Updated dependencies [12c0dd8]
  - @ykurilov/agent-chat-flows@0.67.0
  - @ykurilov/agent-chat-mcp@0.67.0
  - @ykurilov/agent-chat-messengers@0.67.0
  - @ykurilov/agent-chat-react@0.67.0
  - @ykurilov/agent-chat-sandbox@0.67.0
  - @ykurilov/agent-chat-skills@0.67.0

## 0.66.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.66.0
  - @ykurilov/agent-chat-mcp@0.66.0
  - @ykurilov/agent-chat-messengers@0.66.0
  - @ykurilov/agent-chat-sandbox@0.66.0
  - @ykurilov/agent-chat-skills@0.66.0
  - @ykurilov/agent-chat-react@0.66.0

## 0.65.1

### Patch Changes

- @ykurilov/agent-chat-flows@0.65.1
  - @ykurilov/agent-chat-mcp@0.65.1
  - @ykurilov/agent-chat-messengers@0.65.1
  - @ykurilov/agent-chat-sandbox@0.65.1
  - @ykurilov/agent-chat-skills@0.65.1
  - @ykurilov/agent-chat-react@0.65.1

## 0.65.0

### Minor Changes

- 814ee7f: Пометка «Агент написал первым — человек молчал 1 ч 7 мин» перед ответом, который агент написал сам. Ядро: право чата `appNotices` (по умолчанию выключено) — служебные пометки приложения (`kind: "app"`) уходят в историю без текста для модели и только через белый список `appNoticeViews` (имя → безопасные данные для экрана; без функции пометка не уходит); `modelDetails: false` выключает и `appNotices`. React: `noticeLines` у `AgentChat` (имя пометки → строка), договор скина 27 — необязательный `ServiceLine`. Сценарии: в данных пометки `silentMs` (от последнего сообщения человека) и `exit`, проекция для экрана регистрируется в `withChat`, готовые строки `flowNoticeLines()` с подписями `russianFlowNoticeLabels`/`englishFlowNoticeLabels` (`FlowLabels.notices`); `FlowTestChat` передаёт их в `renderChat(chatId, { noticeLines })`. Тандем рисует `ServiceLine`. Как подключить — CHANGES.md, раздел 0.65.0.

### Patch Changes

- Updated dependencies [814ee7f]
  - @ykurilov/agent-chat-react@0.65.0
  - @ykurilov/agent-chat-flows@0.65.0
  - @ykurilov/agent-chat-mcp@0.65.0
  - @ykurilov/agent-chat-messengers@0.65.0
  - @ykurilov/agent-chat-sandbox@0.65.0
  - @ykurilov/agent-chat-skills@0.65.0

## 0.64.0

### Minor Changes

- 1ea05c0: Тестовый чат: кнопка «К следующему напоминанию» проматывает часы ровно к моменту, когда сценарий сам напишет первым (касание, утреннее, выход по сроку, «срок вышел», «не завершил»; ночь и потолки учтены), и поле «своё время» («15 мин», «1 ч 30 мин», «2 дня»). Сервер: `flow.advanceTestClock({ ownerId, chatId, to: "next_first_message" })` → `{ timeOffset, reason }`, впереди ничего — `FlowTestClockError` с `code: "nothing_scheduled"`. Браузер: `FlowTestChatConnection.advanceToNextFirstMessage`. Разбор длительности — `parseDuration` из `/format`. Скин: необязательные `onNextFirstMessage`, `nothingScheduled`, `onAdvanceText` и пять надписей. Как подключить — CHANGES.md, раздел 0.64.0.

### Patch Changes

- Updated dependencies [1ea05c0]
- Updated dependencies [99cded9]
  - @ykurilov/agent-chat-flows@0.64.0
  - @ykurilov/agent-chat-react@0.64.0
  - @ykurilov/agent-chat-mcp@0.64.0
  - @ykurilov/agent-chat-messengers@0.64.0
  - @ykurilov/agent-chat-sandbox@0.64.0
  - @ykurilov/agent-chat-skills@0.64.0

## 0.63.2

### Patch Changes

- @ykurilov/agent-chat-flows@0.63.2
  - @ykurilov/agent-chat-mcp@0.63.2
  - @ykurilov/agent-chat-messengers@0.63.2
  - @ykurilov/agent-chat-sandbox@0.63.2
  - @ykurilov/agent-chat-skills@0.63.2
  - @ykurilov/agent-chat-react@0.63.2

## 0.63.1

### Patch Changes

- Updated dependencies [8bcee93]
  - @ykurilov/agent-chat-react@0.63.1
  - @ykurilov/agent-chat-flows@0.63.1
  - @ykurilov/agent-chat-messengers@0.63.1
  - @ykurilov/agent-chat-sandbox@0.63.1
  - @ykurilov/agent-chat-mcp@0.63.1
  - @ykurilov/agent-chat-skills@0.63.1

## 0.63.0

### Patch Changes

- Updated dependencies [8a9e399]
  - @ykurilov/agent-chat-flows@0.63.0
  - @ykurilov/agent-chat-mcp@0.63.0
  - @ykurilov/agent-chat-messengers@0.63.0
  - @ykurilov/agent-chat-react@0.63.0
  - @ykurilov/agent-chat-sandbox@0.63.0
  - @ykurilov/agent-chat-skills@0.63.0

## 0.62.0

### Patch Changes

- Updated dependencies [8e068e3]
  - @ykurilov/agent-chat-flows@0.62.0
  - @ykurilov/agent-chat-mcp@0.62.0
  - @ykurilov/agent-chat-messengers@0.62.0
  - @ykurilov/agent-chat-react@0.62.0
  - @ykurilov/agent-chat-sandbox@0.62.0
  - @ykurilov/agent-chat-skills@0.62.0

## 0.61.0

### Patch Changes

- @ykurilov/agent-chat-messengers@0.61.0
  - @ykurilov/agent-chat-sandbox@0.61.0
  - @ykurilov/agent-chat-flows@0.61.0
  - @ykurilov/agent-chat-mcp@0.61.0
  - @ykurilov/agent-chat-skills@0.61.0
  - @ykurilov/agent-chat-react@0.61.0

## 0.60.0

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-flows@0.60.0
  - @ykurilov/agent-chat-mcp@0.60.0
  - @ykurilov/agent-chat-messengers@0.60.0
  - @ykurilov/agent-chat-sandbox@0.60.0
  - @ykurilov/agent-chat-skills@0.60.0
  - @ykurilov/agent-chat-react@0.60.0

## 0.59.0

### Patch Changes

- Updated dependencies [fc1f387]
  - @ykurilov/agent-chat-skills@0.59.0
  - @ykurilov/agent-chat-flows@0.59.0
  - @ykurilov/agent-chat-mcp@0.59.0
  - @ykurilov/agent-chat-messengers@0.59.0
  - @ykurilov/agent-chat-sandbox@0.59.0
  - @ykurilov/agent-chat-react@0.59.0

## 0.58.0

### Patch Changes

- Updated dependencies [760962e]
  - @ykurilov/agent-chat-sandbox@0.58.0
  - @ykurilov/agent-chat-flows@0.58.0
  - @ykurilov/agent-chat-mcp@0.58.0
  - @ykurilov/agent-chat-messengers@0.58.0
  - @ykurilov/agent-chat-skills@0.58.0
  - @ykurilov/agent-chat-react@0.58.0

## 0.57.0

### Patch Changes

- 34074f9: Шапка доски сценария на телефоне: лишние кнопки уходят в меню «⋯», Прогон, Проверить граф и сохранение остаются на виду.
  Новая подпись `labels.header.more`.
- Updated dependencies [34074f9]
- Updated dependencies [7c82b87]
  - @ykurilov/agent-chat-flows@0.57.0
  - @ykurilov/agent-chat-mcp@0.57.0
  - @ykurilov/agent-chat-messengers@0.57.0
  - @ykurilov/agent-chat-sandbox@0.57.0
  - @ykurilov/agent-chat-skills@0.57.0
  - @ykurilov/agent-chat-react@0.57.0

## 0.56.0

### Minor Changes

- 949d3b2: Навыки агента: новый пакет `@ykurilov/agent-chat-skills` (список включённых навыков в блоке контекста, загрузка указаний
  инструментом `use_skill`, версии, учёт загрузок, API и экран для админа) и скин экрана `@ykurilov/agent-chat-skin-tandem/skills`.
- 1eadba9: Библиотека готовых картинок: новый пакет `@ykurilov/agent-chat-image-library` с инструментами `find_images` и
  `show_image` поверх каталога приложения. Картинка показывается по ширине ответа с подписью, по нажатию — окно просмотра.
  
  - `images` у `AgentChat`, `ChatWorkspace`, `AgentPanel` принимает и список клиентов: `images={[imagesClient, imageLibraryClient]}`.
    Одиночный клиент работает как раньше.
  - Договор скина версии 26: у `GeneratedImages` необязательные `wide` и `caption`. Тандем их рисует. Скин версии 25
    работает без правок: картинка будет плиткой ближайшей обычной пропорции (1:1, 3:2, 2:3, 16:9, 9:16) без подписи.
  
  Подробно и как подключить — `docs/image-library.md`.
  
  Отказ `show_image`, `show_video` и недоступный каталог в `find_images`, `find_videos` теперь ошибка инструмента (`ImageLibraryError`, `VideoLibraryError` с полем `kind`).
  В ленте строка «ошибка» вместо зелёной галочки, модель получает тот же текст. Код, который читал `{ отказ }` из
  результата `show_video` или `find_videos`, должен смотреть на `state: "output-error"` у части сообщения.
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

- Updated dependencies [949d3b2]
- Updated dependencies [1eadba9]
- Updated dependencies [24c313e]
  - @ykurilov/agent-chat-skills@0.56.0
  - @ykurilov/agent-chat-react@0.56.0
  - @ykurilov/agent-chat-mcp@0.56.0
  - @ykurilov/agent-chat-sandbox@0.56.0
  - @ykurilov/agent-chat-flows@0.56.0
  - @ykurilov/agent-chat-messengers@0.56.0

## 0.55.0

### Minor Changes

- 7b5ed35: Сценарии: подписи событий приложения — `catalog.events` принимает `{ name, label }`; доска, прогон, карточка условия и
  `describeCondition` с каталогом показывают подпись.
- b17e389: Сценарии: таймер «наступил день N программы» (`{ type: "timer", from: "program_day", day }`) — выход в начале дня N
  по нумерации `readRun().day`, без хода приложения. Дополнение к формату v2; `checkFlow` проверяет день против
  `lengthDays`; на доске «Длится» → «до дня программы», подпись «с дня N».
  Вошёл в ноду уже в день N или позже — выход в том же ходе, один ответ из новой ноды; так же `since_start`, чей срок
  прошёл к входу.
- f1151a6: Сценарии: свои касания ноды на N дней (`nudges.days`) — потом утреннее и общий ряд сценария с начала. Доска:
  «Свои касания действуют», подпись на карточке.

### Patch Changes

- Updated dependencies [7b5ed35]
- Updated dependencies [98e1e86]
- Updated dependencies [b17e389]
- Updated dependencies [f1151a6]
- Updated dependencies [cdc7dd7]
  - @ykurilov/agent-chat-flows@0.55.0
  - @ykurilov/agent-chat-react@0.55.0
  - @ykurilov/agent-chat-messengers@0.55.0
  - @ykurilov/agent-chat-sandbox@0.55.0

## 0.54.0

### Minor Changes

- bc3cef1: Доска сценария: больше места графу. Узкая шапка (`header="compact"`), легенда «Условий выхода» по умолчанию свёрнута в кнопку
  (`legend`), панель «Сценарий» сворачивается (`inspector`), мини-карта сворачивается (`minimap`), редактор разворачивается на
  весь экран (`fullscreen`). Свёрнутое запоминается в localStorage (`storageKey`). Договор скина: необязательные `compact` и
  `fullscreen` у шапки, `compact` у рамки, часть `FlowBoardToggle`.

### Patch Changes

- Updated dependencies [c8fb0dd]
- Updated dependencies [73d3aaa]
- Updated dependencies [bc3cef1]
  - @ykurilov/agent-chat-react@0.54.0
  - @ykurilov/agent-chat-flows@0.54.0
  - @ykurilov/agent-chat-messengers@0.54.0
  - @ykurilov/agent-chat-sandbox@0.54.0

## 0.53.0

### Patch Changes

- Updated dependencies [b6a7786]
  - @ykurilov/agent-chat-flows@0.53.0
  - @ykurilov/agent-chat-react@0.53.0
  - @ykurilov/agent-chat-messengers@0.53.0
  - @ykurilov/agent-chat-sandbox@0.53.0

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

- Updated dependencies [d9b2ea5]
  - @ykurilov/agent-chat-flows@0.52.0
  - @ykurilov/agent-chat-messengers@0.52.0
  - @ykurilov/agent-chat-react@0.52.0
  - @ykurilov/agent-chat-sandbox@0.52.0

## 0.51.0

### Patch Changes

- Updated dependencies [cd55c82]
- Updated dependencies [41b1726]
  - @ykurilov/agent-chat-flows@0.51.0
  - @ykurilov/agent-chat-messengers@0.51.0
  - @ykurilov/agent-chat-sandbox@0.51.0
  - @ykurilov/agent-chat-react@0.51.0

## 0.50.0

### Patch Changes

- Updated dependencies [68b0629]
- Updated dependencies [25aaf22]
  - @ykurilov/agent-chat-flows@0.50.0
  - @ykurilov/agent-chat-messengers@0.50.0
  - @ykurilov/agent-chat-react@0.50.0
  - @ykurilov/agent-chat-sandbox@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [084cef7]
  - @ykurilov/agent-chat-flows@0.49.0
  - @ykurilov/agent-chat-messengers@0.49.0
  - @ykurilov/agent-chat-react@0.49.0
  - @ykurilov/agent-chat-sandbox@0.49.0

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
  - @ykurilov/agent-chat-flows@0.48.0
  - @ykurilov/agent-chat-messengers@0.48.0
  - @ykurilov/agent-chat-sandbox@0.48.0
  - @ykurilov/agent-chat-react@0.48.0

## 0.47.0

### Patch Changes

- @ykurilov/agent-chat-messengers@0.47.0
  - @ykurilov/agent-chat-sandbox@0.47.0
  - @ykurilov/agent-chat-react@0.47.0

## 0.46.2

### Patch Changes

- @ykurilov/agent-chat-messengers@0.46.2
  - @ykurilov/agent-chat-sandbox@0.46.2
  - @ykurilov/agent-chat-react@0.46.2

## 0.46.1

### Patch Changes

- bb729a1: Кнопка-значок (`Button size="icon"`) в `composerActions` остаётся по центру: прижатие к левому краю теперь только у широких элементов. Обёртку вокруг значка можно убрать.
- @ykurilov/agent-chat-messengers@0.46.1
  - @ykurilov/agent-chat-react@0.46.1
  - @ykurilov/agent-chat-sandbox@0.46.1

## 0.46.0

### Patch Changes

- 56d7528: Наблюдения приложения с формами, без ломающих изменений.
  
  - **Начатый вызов в базе до выполнения.** Вызов инструмента пишется в хранилище сразу, как модель его прислала, а
    инструмент ждёт этой записи (не дольше 5 с). Упади сервер посреди инструмента — восстановленный ответ показывает
    вызов прерванным, «Повторить» продолжает с него.
  - **Последний шаг без действий.** На шаге без инструментов (последний шаг хода и помощника, итог по потолку хода)
    вызов вопреки запрету не выполняется: у него закрывающий результат-отказ с постоянным текстом, подтверждение не
    спрашивается.
  - **`afterTurn` видит `stepLimit: true`**, когда ход упёрся в `agent.maxSteps`; в журнале строка `[предел шагов]`, в
    ответе часть `data-step-limit` (модель её не видит). Человеку на экране ничего не показывается.
  - **«Повторить» передаёт `previousAnswerId` и `abandonedAnswerIds`** в `beforeTurn` и `turnNotStarted`: оборванный
    ответ, который заменит новый ответ-сосед.
  - **React: «ответа уже нет» — лента сразу перечитывает историю.** Виджет, подтверждение и браузерный вызов, на которые
    сервер ответил «не ждёт», перечитывают историю; сорвавшееся под нагрузкой чтение повторяется, лента не застывает.
  - **Тандем: поле ввода не пересоздаётся**, когда приходят меню моделей, вложения, голос и другие поздние части
    панели. Текст, набранный до загрузки меню, и фокус остаются.
  
  ### Как обновить приложение
  
  Обновление само по себе ничего не требует. Обходы, которые теперь можно убрать:
  
  1. Тесты, которые перед вводом текста ждут кнопку «Модель» (например, `tests/support/test-chat-ready.ts`), — ждать её
     больше не нужно: текст, набранный раньше меню, не пропадает.
  2. Тесты восстановления, которые перед остановкой сервера ждут `status: complete` в базе, могут обрывать сервер
     посреди инструмента: вызов уже в базе и после восстановления виден прерванным.
  3. Свои проверки «последний ли это шаг» внутри инструментов с последствиями (бронь, оплата) — SDK сам не выполняет
     вызов на последнем шаге.
  4. Свой подсчёт шагов в `afterTurn`, чтобы понять, что ход упёрся в предел, — заменить на `turn.stepLimit`.
  5. Своё вычисление прежнего ответа для «Повторить» — брать `previousAnswerId` из `beforeTurn` / `turnNotStarted`.
- Updated dependencies [56d7528]
  - @ykurilov/agent-chat-react@0.46.0
  - @ykurilov/agent-chat-messengers@0.46.0
  - @ykurilov/agent-chat-sandbox@0.46.0

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
- ac9aede: Скин Тандема ставит надписи дизайн-системы Тандем (`@ykurilov/tandem-ui` 0.7.0) на языке словаря чата: с `englishLabels`
  в чате нет русских надписей. В словаре — поле `locale`.

### Patch Changes

- Updated dependencies [eb74c58]
- Updated dependencies [ac9aede]
  - @ykurilov/agent-chat-react@0.45.0
  - @ykurilov/agent-chat-messengers@0.45.0
  - @ykurilov/agent-chat-sandbox@0.45.0

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
  - @ykurilov/agent-chat-react@0.44.0
  - @ykurilov/agent-chat-messengers@0.44.0
  - @ykurilov/agent-chat-sandbox@0.44.0

## 0.43.0

### Patch Changes

- @ykurilov/agent-chat-messengers@0.43.0
  - @ykurilov/agent-chat-sandbox@0.43.0
  - @ykurilov/agent-chat-react@0.43.0

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
  - @ykurilov/agent-chat-react@0.42.0
  - @ykurilov/agent-chat-messengers@0.42.0
  - @ykurilov/agent-chat-sandbox@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [9472fcb]
  - @ykurilov/agent-chat-react@0.41.0
  - @ykurilov/agent-chat-messengers@0.41.0
  - @ykurilov/agent-chat-sandbox@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [0e7aab3]
  - @ykurilov/agent-chat-react@0.40.0
  - @ykurilov/agent-chat-messengers@0.40.0
  - @ykurilov/agent-chat-sandbox@0.40.0

## 0.39.1

### Patch Changes

- Updated dependencies [5c0f3af]
  - @ykurilov/agent-chat-react@0.39.1
  - @ykurilov/agent-chat-messengers@0.39.1
  - @ykurilov/agent-chat-sandbox@0.39.1

## 0.39.0

### Patch Changes

- Updated dependencies [3b90429]
  - @ykurilov/agent-chat-react@0.39.0
  - @ykurilov/agent-chat-messengers@0.39.0
  - @ykurilov/agent-chat-sandbox@0.39.0

## 0.38.0

### Patch Changes

- @ykurilov/agent-chat-messengers@0.38.0
  - @ykurilov/agent-chat-sandbox@0.38.0
  - @ykurilov/agent-chat-react@0.38.0

## 0.37.0

### Patch Changes

- @ykurilov/agent-chat-messengers@0.37.0
  - @ykurilov/agent-chat-sandbox@0.37.0
  - @ykurilov/agent-chat-react@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [3487fb4]
- Updated dependencies [5f13c74]
  - @ykurilov/agent-chat-react@0.36.0
  - @ykurilov/agent-chat-messengers@0.36.0
  - @ykurilov/agent-chat-sandbox@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6ceee78]
- Updated dependencies [2382026]
  - @ykurilov/agent-chat-react@0.35.0
  - @ykurilov/agent-chat-sandbox@0.35.0
  - @ykurilov/agent-chat-messengers@0.35.0

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
  - @ykurilov/agent-chat-react@0.34.0
  - @ykurilov/agent-chat-messengers@0.34.0
  - @ykurilov/agent-chat-sandbox@0.34.0

## 0.33.0

### Patch Changes

- @ykurilov/agent-chat-messengers@0.33.0
  - @ykurilov/agent-chat-sandbox@0.33.0
  - @ykurilov/agent-chat-react@0.33.0

## 0.32.0

### Patch Changes

- 9bde63b: Тандем: пока модель ещё ничего не написала, снова виден статус «Думает…» (раньше рисовался пустой пузырь). В окне просмотра картинок Esc, стрелки и Tab продолжают работать после клика по картинке или сцене.
- Updated dependencies [4087a22]
- Updated dependencies [2fa3104]
- Updated dependencies [2f95dfa]
- Updated dependencies [853edb7]
- Updated dependencies [e7d6d48]
- Updated dependencies [294e1e8]
- Updated dependencies [dac242f]
  - @ykurilov/agent-chat-react@0.32.0
  - @ykurilov/agent-chat-messengers@0.32.0
  - @ykurilov/agent-chat-sandbox@0.32.0

## 0.31.2

### Patch Changes

- Updated dependencies [6177508]
  - @ykurilov/agent-chat-messengers@0.31.2
  - @ykurilov/agent-chat-react@0.31.2
  - @ykurilov/agent-chat-sandbox@0.31.2

## 0.31.1

### Patch Changes

- Updated dependencies [8c539eb]
  - @ykurilov/agent-chat-messengers@0.31.1
  - @ykurilov/agent-chat-react@0.31.1
  - @ykurilov/agent-chat-sandbox@0.31.1

## 0.31.0

### Patch Changes

- Updated dependencies [7f10a41]
  - @ykurilov/agent-chat-messengers@0.31.0
  - @ykurilov/agent-chat-react@0.31.0
  - @ykurilov/agent-chat-sandbox@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [2514722]
  - @ykurilov/agent-chat-messengers@0.30.0
  - @ykurilov/agent-chat-react@0.30.0
  - @ykurilov/agent-chat-sandbox@0.30.0

## 0.29.0

### Patch Changes

- Updated dependencies [4279ae0]
  - @ykurilov/agent-chat-messengers@0.29.0
  - @ykurilov/agent-chat-react@0.29.0
  - @ykurilov/agent-chat-sandbox@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [d63ccaa]
- Updated dependencies [189cba9]
  - @ykurilov/agent-chat-react@0.28.0
  - @ykurilov/agent-chat-messengers@0.28.0
  - @ykurilov/agent-chat-sandbox@0.28.0

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

### Patch Changes

- Updated dependencies [d8341b2]
- Updated dependencies [5e4ed28]
- Updated dependencies [e0bb519]
  - @ykurilov/agent-chat-sandbox@0.27.0
  - @ykurilov/agent-chat-messengers@0.27.0
  - @ykurilov/agent-chat-react@0.27.0

## 0.26.2

### Patch Changes

- @ykurilov/agent-chat-messengers@0.26.2
  - @ykurilov/agent-chat-sandbox@0.26.2
  - @ykurilov/agent-chat-react@0.26.2

## 0.26.1

### Patch Changes

- Updated dependencies [5b52515]
  - @ykurilov/agent-chat-react@0.26.1
  - @ykurilov/agent-chat-messengers@0.26.1
  - @ykurilov/agent-chat-sandbox@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [eb43e47]
  - @ykurilov/agent-chat-sandbox@0.26.0
  - @ykurilov/agent-chat-messengers@0.26.0
  - @ykurilov/agent-chat-react@0.26.0

## 0.25.0

### Patch Changes

- @ykurilov/agent-chat-messengers@0.25.0
  - @ykurilov/agent-chat-sandbox@0.25.0
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
  - @ykurilov/agent-chat-react@0.24.0
  - @ykurilov/agent-chat-sandbox@0.24.0
  - @ykurilov/agent-chat-messengers@0.24.0

## 0.23.0

### Minor Changes

- 30fb729: Живая надпись «думает»: пока модель думает и текста ответа нет, фраза сменяется каждые 3–4 с, рядом идёт время.
  
  - Фразы не повторяются подряд. Набор по умолчанию — десять спокойных русских фраз («Прикидываю…», «Раскладываю по полочкам…», «Сверяю детали…»). Время: «12 с», после минуты — «1 мин 5 с».
  - Новые необязательные ключи словаря: `thinkingPhrases` (свой набор фраз) и `thinkingElapsed` (запись времени). Пустой набор — одна фраза `reasoningRunning`, время остаётся. Словарь со своей `reasoningRunning` без `thinkingPhrases` показывает только её, а время без `thinkingElapsed` — цифрами («0:12»).
  - Строка ожидания и блок рассуждений одного ответа идут по одним часам: счёт не сбрасывается, когда начинаются рассуждения или когда ответ прокрутили из вида и вернули. После перезагрузки страницы счёт начинается заново.
  - Экранный диктор слышит одну постоянную `reasoningRunning`, а не каждую фразу. Смена фразы плавная только без prefers-reduced-motion.
  - Новый хук `useThinkingStatus(active?)` → `{ phrase, seconds, elapsed }` для своего скина. Договор скина не менялся.
  
  ### Как обновить приложение
  
  1. `pnpm up "@ykurilov/agent-chat-*@^0.23.0"`. Со скином Тандема больше ничего не нужно.
  2. Свои фразы — в словаре: `<ChatLabelsProvider labels={{ ...russianLabels, thinkingPhrases: ["Собираю экран…", "Подключаю базу…"] }}>`.
  3. Свой скин: в `Reasoning` (пока `streaming`) и в строке ожидания `AgentMessage` взять `const { phrase, elapsed } = useThinkingStatus()`; фразу и время пометить `aria-hidden`, а для диктора оставить постоянную `labels.reasoningRunning`.
  4. Тесты приложения, которые искали на экране текст «Думает…», искать по роли `status` или по имени кнопки рассуждений — видимый текст теперь меняется.

### Patch Changes

- Updated dependencies [30fb729]
  - @ykurilov/agent-chat-react@0.23.0
  - @ykurilov/agent-chat-messengers@0.23.0
  - @ykurilov/agent-chat-sandbox@0.23.0

## 0.22.0

### Patch Changes

- @ykurilov/agent-chat-sandbox@0.22.0
  - @ykurilov/agent-chat-messengers@0.22.0
  - @ykurilov/agent-chat-react@0.22.0

## 0.21.0

### Patch Changes

- @ykurilov/agent-chat-sandbox@0.21.0
  - @ykurilov/agent-chat-messengers@0.21.0
  - @ykurilov/agent-chat-react@0.21.0

## 0.20.0

### Minor Changes

- fd16b01: Вкладка показывает помощников, фоновые задачи и служебные сообщения. Договор скина `ChatSkin` поднялся с версии 17 до 18: добавились только необязательные `HelperCallRow`, `TaskCard`, `AgentNoticeView` и пометка мессенджера в списке чатов (`ChatListItem.origin`). Скин версии 17 работает без правок: помощник показывается обычной строкой инструмента, задачи не рисуются.
  
  Скин Тандем уже умеет всё это. Вкладка сама обновляет карточку задачи и показывает итог без перезагрузки; ответ на подтверждение не затирается.
  
  Что сделать в приложении со своим скином: ничего обязательного. Чтобы показать новое, реализуйте три компонента (описание: `docs/skin-v18.md`).

### Patch Changes

- Updated dependencies [fd16b01]
- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-messengers@0.20.0
  - @ykurilov/agent-chat-react@0.20.0
  - @ykurilov/agent-chat-sandbox@0.20.0

## 0.19.0

### Minor Changes

- 9e6da83: Скин Тандема рисует свои кнопки приложения под ответом агента (`messageActions`, договор скина версии 17): в ряду действий
  после копирования, в том же виде — с иконкой как кнопка-иконка с подсказкой, без иконки как подпись текстом. Пока обработчик
  кнопки идёт, она неактивна. Без `messageActions` ряд прежний.

### Patch Changes

- Updated dependencies [aa0fd51]
- Updated dependencies [6f26b93]
  - @ykurilov/agent-chat-react@0.19.0
  - @ykurilov/agent-chat-sandbox@0.19.0

## 0.18.6

### Patch Changes

- @ykurilov/agent-chat-react@0.18.6
  - @ykurilov/agent-chat-sandbox@0.18.6

## 0.18.5

### Patch Changes

- fcf4476: Тандем поднят до 0.6.1 (`@ykurilov/tandem-ui@^0.6.1`): боковое меню `AppShell` больше не роняет серверные страницы Next.js, скрипт против мигания меню вынесен в отдельный `<AppShellScript />` для `<head>`, у счётчика в меню нет лишнего пробела в подписи. Скин чата это не меняет. Приложению с Тандемом поднять `@tandem/ui` до `npm:@ykurilov/tandem-ui@^0.6.1`.
- Updated dependencies [56b9ab6]
  - @ykurilov/agent-chat-react@0.18.5
  - @ykurilov/agent-chat-sandbox@0.18.5

## 0.18.4

### Patch Changes

- fbfa601: Поле ввода: «Стоп» теперь родная кнопка поля из Тандема 0.5.1 (`@ykurilov/tandem-ui` поднят до `^0.6.0`). Раньше скин прятал «Отправить» через DOM и ставил свою кнопку. Для человека ничего не меняется: пока идёт ответ, на месте «Отправить» стоит «Стоп». В голосовом диалоге поле скрыто, поэтому «Стоп» там по-прежнему отдельная кнопка рядом с панелью. Приложению нужно поднять `@tandem/ui` до `npm:@ykurilov/tandem-ui@^0.6.0`. Вместе с Тандемом 0.5.1 приходит защита от случайных касаний на телефоне: страница не зумится двойным тапом, нет серой вспышки на кнопках, нет «резинки» прокрутки, кнопки не выделяются долгим нажатием, поля на сенсорных экранах 16 px, чтобы iOS не приближал страницу при вводе.
  
  Тандем 0.6.0 добавляет готовое боковое меню приложения `AppShell` (меню + содержимое, сворачивание, ширина с запоминанием, панель на телефоне, меню профиля). Скин его не использует, приложение может взять для своего каркаса: см. README `@ykurilov/tandem-ui`.
- Updated dependencies [8b1343d]
  - @ykurilov/agent-chat-sandbox@0.18.4
  - @ykurilov/agent-chat-react@0.18.4

## 0.18.3

### Patch Changes

- ce3c26f: Если сервер отказал ходу ответом 4xx со своим текстом (`{ error: "Разговор завершён" }` или `{ error: { message } }`),
  чат показывает этот текст вместо «Что-то пошло не так». Когда повтор не поможет (все 4xx, кроме 408, 425 и 429),
  кнопки «Повторить» нет, а отправленный текст возвращается в поле. Касается отправки, «Повторить», «Переделать»
  и правки сообщения: у правки текст сервера появляется в редакторе. Отказы без текста, ошибки 5xx и обрыв связи
  выглядят как раньше. Скин получает текст в новом необязательном `ErrorNotice.text` (договор скина 16), Тандем
  его показывает; старые скины работают без правок.
- Updated dependencies [ce3c26f]
  - @ykurilov/agent-chat-react@0.18.3
  - @ykurilov/agent-chat-sandbox@0.18.3

## 0.18.2

### Patch Changes

- Updated dependencies [7e7e966]
  - @ykurilov/agent-chat-react@0.18.2
  - @ykurilov/agent-chat-sandbox@0.18.2

## 0.18.1

### Patch Changes

- 2b059b5: Тандем, поле ввода: пока идёт ответ, кнопка «Отправить» внутри рамки сама становится кнопкой «Стоп» — на том же месте и того же размера. Раньше на её месте крутилось колёсико, а «Стоп» висел отдельной кнопкой справа, за рамкой. В голосовом режиме «Стоп» остаётся рядом с панелью режима, как и было. Остальные скины (в том числе пример plain-skin) этой проблемы не имели: там кнопка уже подменяется на месте.
- Updated dependencies [179ad9d]
  - @ykurilov/agent-chat-react@0.18.1
  - @ykurilov/agent-chat-sandbox@0.18.1

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
  - @ykurilov/agent-chat-sandbox@0.18.0
  - @ykurilov/agent-chat-react@0.18.0

## 0.17.0

### Minor Changes

- e5d0860: Видео от агента: новый пакет `@ykurilov/agent-chat-videos`. Агент находит видео в каталоге приложения (`find_videos`) и
  присылает карточкой (`show_video`), можно с нужной минуты. По нажатию плеер YouTube (`youtube-nocookie.com`) или Kinescope
  играет в ленте, есть «На весь экран». До нажатия к площадкам не уходит ни одного запроса.
  
  - сервер: `createVideoLibrary({ videos })` или `({ source: { search, get } })`, `videos.tools(model)` в `agent.tools`;
  - страница: `videos={videosClient}` у `AgentChat`, `ChatWorkspace` и `AgentPanel`;
  - договор скина версии 14: необязательная часть `AgentVideo` (`AgentVideoView`); скин без неё показывает видео ссылкой;
  - надписи `videos.play`, `videos.from`, `videos.fullscreen` и `voice.videoOnScreen` («видео на экране» в голосовом режиме).
  
  Подробно: `docs/videos.md`.
  
  ### Как обновить приложение
  
  Обычному приложению делать ничего не нужно: видео включается отдельно, миграций нет.
  
  1. Полный словарь надписей, написанный вручную без `{ ...russianLabels }`, — добавьте `voice.videoOnScreen`.
  2. Проверка: `pnpm typecheck`, затем в чате отправить сообщение и получить ответ.

### Patch Changes

- Updated dependencies [e5d0860]
  - @ykurilov/agent-chat-react@0.17.0

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
  - @ykurilov/agent-chat-react@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [f05ad23]
  - @ykurilov/agent-chat-react@0.15.0

## 0.14.0

### Minor Changes

- dac20ea: Скин Тандема: панель агента (договор скина v12) — `TandemAgentPanelLauncher` и `TandemAgentPanel`, входят в `tandemSkin`. Панель без затемнения страницы, на экране до 640 px — на весь экран, список чатов поверх чата.
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
- 84ad64f: Укрепление по третьему проходу Pi (022, этап S9). **Большие фото уменьшаются при загрузке**: поворот по EXIF, не больше 2000×2000 пикселей и ~4,5 МБ в base64; хранится уменьшенная копия, старые картинки ужимаются при сборке запроса (результат запоминается), нечитаемая картинка и картинка больше 60 млн пикселей — отказ 422 `unreadable` (в старой истории — пометка «пропущена»). Новая зависимость `sharp` (готовые сборки для macOS и Linux, в том числе Alpine; порядок ужатия из pi-mono, MIT). **Секреты в ошибке инструмента** вычищаются до того, как текст уйдёт человеку, в базу и модели: пароль в адресе, `password=`/`password: …`/`token=`, `"secret": "…"`, заголовок `Authorization`, `X-Api-Key`, ключи сервисов, закрытые ключи PEM и значения секретных переменных окружения (кроме путей, адресов без пароля и простых слов); чистятся сообщение, стек и `cause`; `scrubSecrets` и `environmentSecrets` экспортированы из ядра. **Внешние картинки** в ответе модели и в сводке сжатия скин Тандема показывает ссылкой и не грузит (новая необязательная надпись словаря `externalImageLink`, по умолчанию «картинка»; свои словари без неё работают); инструкция веб-инструментов называет страницы данными, а не указаниями. **Ступени цены** по длине контекста: `pricing.tiers` (`inputTokensAbove` и цены), ход считается по шагам; у GPT 6 Luna выше 272 тысяч токенов. Пауза в `useAgentChat` больше не копит слушатели отмены.
- aba59fe: Цикл агента и учёт расхода крепче (022, этап 8). Когда шаги хода кончаются, последний запрос идёт без инструментов (счёт по шагам всего хода, ход из одного шага не ограничивается) и с пометкой «подведи итог» в самом конце: ход кончается сводкой для человека, а не обрывом на вызове. Новая настройка `agent.sequentialTools` (`true` или список имён) пускает инструменты с последствиями по одному: «спиши деньги» не пойдёт одновременно с другим таким вызовом; очередь одна на чат (во всех ходах и повторах), ожидание очереди не съедает срок инструмента, «Стоп» отменяет ждущий вызов, и модель видит, что он не запускался. Оборванный вызов инструмента теперь говорит модели, что действие могло выполниться частично, и показывает последний промежуточный вывод. Ответ, упёршийся в предел длины, получает отметку: человек видит надпись «Ответ оборван по длине» (`labels.answerCutByLength`, в скине — `AgentMessage.cutByLength`), модель в следующих ходах видит пометку в конце своего ответа. Ответ из одних рассуждений (например, «Стоп» на рассуждении) больше не идёт в запрос, а сообщения человека, оказавшиеся подряд, склеиваются в одно (строгие провайдеры не принимают два подряд). Сегодняшняя дата словами идёт в конце последнего сообщения человека, только в запросе — начало запроса не меняется, кэш цел. Дата берётся по часовому поясу человека: браузер шлёт свой пояс (`timeZone`) с каждым запросом хода, сервер берёт только настоящий пояс IANA, иначе — новая настройка `agent.timeZone`, без неё — пояс сервера. Ни один ответ больше не бесплатен в журнале расхода: шаг, оборванный «Стопом» или сбоем после первых слов, и шаг, по которому провайдер не прислал числа, прикидываются по длине текста с учётом письма (кириллица, JSON и иероглифы плотнее латиницы; прикидка скорее завышает), а ответ, оборванный перезапуском сервера, записывается при следующем запуске (`recoverInterruptedAnswers`): только то, чего ещё нет в журнале, поэтому сбой после «Разрешить» не задваивает расход. Такие записи и итог ответа помечены «примерно» (`estimated`). В SQLite и PostgreSQL у записей расхода новая колонка `estimated`: миграция применяется сама при открытии хранилища. Своим хранилищам менять ничего не нужно: без колонки теряется только пометка. Фильтр `sumUsage` получил поля `messageId` и `source`: свои хранилища должны их учитывать (общие тесты `describeChatStorageContract` это проверяют).
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

- 42d17cc: Панель агента надёжнее. Место вложенной страницы всегда главнее места макета, в котором она стоит, — и при первом показе, и после переходов; `data` с циклом или `BigInt` больше не роняет страницу. Смена человека (`userKey`) в том же кадре убирает чат и список прежнего, а его недоигранный ответ не раздаёт изменения данных и не делает действий на странице; «Новый чат», переименование и удаление прежнего, закончившиеся после смены, нового не трогают. Сообщение об изменении данных не раздаётся второй раз и после перезагрузки страницы во время ответа (вкладка помнит последние 500 в `sessionStorage`). У дубликата вкладки («Дублировать вкладку») свой номер: браузерный вызов не исполнится дважды. Esc при открытом списке чатов сначала возвращает к чату, второй — закрывает панель. Делать в приложении ничего не нужно.
- 96098be: Мелкие исправления (022). Символ с кодом ноль в первом сообщении больше не роняет отправку на Postgres: он выбрасывается из названия чата, из записей памяти и из сводки сжатия истории (иначе запись сжатия падала бы при каждой попытке); в самом тексте сообщения он лежит как раньше. Вложения отмечаются прикреплёнными до записи сообщения, а не после: если сервер упал между двумя шагами, чистка брошенных файлов не удалит их через сутки (файл, отмеченный зря, безвреден и уходит вместе с чатом). Во всех пакетах появилось поле `engines: { node: ">=22" }`; голосовой сервер (`createVoiceRelay`) и голосовой диалог (`createDialogRelay`) на Node 20 сразу при создании говорят понятной ошибкой, что нужен Node 22 (раньше падали при первом соединении; со своим `connectUpstream` проверки нет). В пакете вложений `react` и `@ykurilov/agent-chat-react` стали необязательными peer-зависимостями: серверу без экрана они больше не ставятся. Приложению, которое берёт `@ykurilov/agent-chat-attachments/react`, достаточно иметь их в проекте — для чата на экране они нужны и так; если они подтягивались только через вложения, добавьте их в зависимости приложения.
- Updated dependencies [4f33e85]
- Updated dependencies [15fbbcc]
- Updated dependencies [c09c1e2]
- Updated dependencies [41992d0]
- Updated dependencies [42d17cc]
- Updated dependencies [062ce36]
- Updated dependencies [5e99fb2]
- Updated dependencies [ecd63f8]
- Updated dependencies [656233a]
- Updated dependencies [96098be]
- Updated dependencies [be77ee2]
- Updated dependencies [84ad64f]
- Updated dependencies [0cdf102]
- Updated dependencies [aba59fe]
- Updated dependencies [f9b6162]
- Updated dependencies [1b2f9f1]
- Updated dependencies [6335921]
- Updated dependencies [00965e1]
- Updated dependencies [0e8e0ae]
- Updated dependencies [6b20d83]
- Updated dependencies [1402afe]
- Updated dependencies [d12dcf3]
- Updated dependencies [946e5d8]
  - @ykurilov/agent-chat-react@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [4793e4d]
  - @ykurilov/agent-chat-react@0.13.0

## 0.12.0

### Minor Changes

- fe88968: В скине Тандема кнопка микрофона теперь стоит внутри рамки поля ввода, в нижнем ряду, слева от «Отправить», в том же стиле, что скрепка и выбор модели. Так во всех видах поля и на телефоне. Во время записи кнопка подсвечена и мигает, при чистке текста показывает спиннер. Кнопка «стоп» ответа осталась справа за рамкой.
  
  Скин теперь требует `@ykurilov/tandem-ui` версии `^0.4.0` (в ней у поля ввода появился слот `actions`). Приложению со скином достаточно обновить оба пакета вместе; менять свой код не нужно. Собственные скины не затронуты.

### Patch Changes

- @ykurilov/agent-chat-react@0.12.0

## 0.11.0

### Minor Changes

- 9d510b8: **Ломает приложения:** только если вы сами собрали словарь надписей целиком (без `{ ...russianLabels, … }`): в `ChatLabels` появилась надпись `voicePolishing`. Кроме того, клиент голоса `mode: "relay"` теперь шлёт серверу команду `finalize`, которую старый сервер relay не знает (закрывает соединение кодом 4400): сервер обновляйте раньше клиента или вместе с ним.
  
  Голос стал точнее и быстрее, а основной путь — через ваш сервер.
  
  Что изменилось:
  
  - **Через сервер — основной путь.** Ключ Soniox не уходит в браузер даже в виде временного. В документации relay первый и рекомендуемый; прямой режим (`createVoiceHandler`) работает как раньше, но помечен «не рекомендуется».
  - **Soniox `stt-rt-v5`.** Включено определение конца фразы. По «стоп» клиент шлёт `finalize`, Soniox закрепляет всё сказанное и присылает метку `<fin>`; после неё текст готов. Не ответил за `stopTimeoutMs` (3 с) — остаётся то, что пришло, без ошибки.
  - **Чистка текста моделью (по желанию, только relay):** `createVoiceRelay({ polish: { provider: "together" } })` (ключ `TOGETHER_API_KEY`, модель по умолчанию `deepseek-ai/DeepSeek-V4.1-Flash`) или `polish: { clean: async (text) => … }`. После «стоп» сервер убирает «э-э», повторы и оговорки, расставляет знаки и заглавные. Заменяется только надиктованный кусок: набранное руками и правка во время чистки не теряются. Сбой или тишина дольше 5 секунд — остаётся текст Soniox. Пока идёт чистка, кнопка микрофона крутится (`VoiceInputView.polishing`, подпись `voicePolishing`). Ответ, похожий на ответ на вопрос или отказ (мало слов из исходника, слишком короткий или длинный), отбрасывается. Текст уходит в модель чистки (Together), ключ остаётся на сервере. Лимиты расходов (`@ykurilov/agent-chat-limits`) чистку не учитывают; у неё свой лимит `polishRateLimit` (6 в минуту на человека, `false` — выключить). Новый `maxConnectionsPerUser` (по умолчанию 2 соединения на человека, `false` — выключить).
  - Серверная сессия Soniox вынесена в `createSonioxSession` (`@ykurilov/agent-chat-voice/server`): её можно использовать без поля ввода.
  - Исправлено: два сообщения Soniox подряд могли продублировать хвост фразы в поле; при длинной диктовке поле теперь прокручивается к последним словам.
  
  ### Как обновить приложение
  
  1. Сначала обновите сервер, потом клиент (или оба вместе): `pnpm update "@ykurilov/agent-chat-*" --latest`.
  2. Только если словарь надписей собран целиком: добавьте `voicePolishing: "Приводим текст в порядок…"`.
  3. Хотите основной путь: замените `createVoiceHandler` на `createVoiceRelay` + `mountVoiceRelay` и `createVoiceInput({ api: "/api/voice", mode: "relay" })` (код — в README пакета `voice`). Нужен WebSocket на сервере и (если есть прокси) `ws: true`.
  4. Хотите чистку: добавьте `polish: { provider: "together" }` в `createVoiceRelay` и `TOGETHER_API_KEY` в окружение сервера.
  5. Проверка: `pnpm typecheck`; продиктуйте фразу с «э-э» и нажмите «стоп»: текст должен замениться на исправленный.

### Patch Changes

- 9d510b8: Исправлен фон экрана «Чат не найден», рабочей области и раскладки: они брали несуществующую переменную `--background`, а нужна `--canvas` Тандема. Обновление ничего не требует.
- Updated dependencies [9d510b8]
  - @ykurilov/agent-chat-react@0.11.0

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
  - @ykurilov/agent-chat-react@0.10.0

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
  - @ykurilov/agent-chat-react@0.9.0

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
  - @ykurilov/agent-chat-react@0.8.0

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
- Updated dependencies [e741e6d]
  - @ykurilov/agent-chat-react@0.7.0

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
  - @ykurilov/agent-chat-react@0.6.0

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

### Patch Changes

- Updated dependencies [62027c6]
- Updated dependencies [2deeab3]
  - @ykurilov/agent-chat-react@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [2e526d2]
  - @ykurilov/agent-chat-react@0.4.0

## 0.3.0

### Patch Changes

- @ykurilov/agent-chat-react@0.3.0

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
  - @ykurilov/agent-chat-react@0.2.0
