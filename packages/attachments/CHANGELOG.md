# @ykurilov/agent-chat-attachments

## 0.87.9

### Patch Changes

- Updated dependencies [16dfbcd]
  - @ykurilov/agent-chat-core@0.87.9
  - @ykurilov/agent-chat-react@0.87.9

## 0.87.8

### Patch Changes

- Updated dependencies [5fed519]
  - @ykurilov/agent-chat-react@0.87.8
  - @ykurilov/agent-chat-core@0.87.8

## 0.87.7

### Patch Changes

- @ykurilov/agent-chat-core@0.87.7
  - @ykurilov/agent-chat-react@0.87.7

## 0.87.6

### Patch Changes

- @ykurilov/agent-chat-core@0.87.6
  - @ykurilov/agent-chat-react@0.87.6

## 0.87.5

### Patch Changes

- @ykurilov/agent-chat-core@0.87.5
  - @ykurilov/agent-chat-react@0.87.5

## 0.87.4

### Patch Changes

- @ykurilov/agent-chat-core@0.87.4
  - @ykurilov/agent-chat-react@0.87.4

## 0.87.3

### Patch Changes

- Updated dependencies [eb19945]
  - @ykurilov/agent-chat-core@0.87.3
  - @ykurilov/agent-chat-react@0.87.3

## 0.87.2

### Patch Changes

- Updated dependencies [9c34bd4]
  - @ykurilov/agent-chat-core@0.87.2
  - @ykurilov/agent-chat-react@0.87.2

## 0.87.1

### Patch Changes

- Updated dependencies [820bc3b]
  - @ykurilov/agent-chat-core@0.87.1
  - @ykurilov/agent-chat-react@0.87.1

## 0.87.0

### Minor Changes

- eec4550: Внешний исполнитель принимает вложения и даёт выбирать свою модель. Swift-клиент сохраняет файлы до отправки, восстанавливает загрузку после перезапуска; «Одуванчик» показывает пикеры фото/камеры/файлов, карточки и подтверждение смены модели. Произвольные файлы и ZIP включаются отдельно, без распаковки. Сбой сверки сам по себе больше не объявляет исполнителя offline.
  
  ### Как обновить приложение
  
  1. Обновите все установленные пакеты SDK одной версией и Swift SPM-тег до 0.87.0. Существующий текстовый API не меняется. Новых обязательных env и SQL-миграций нет.
  2. Для файлов создайте `createExternalAttachments({storage,allowGenericFiles:true})` из `@ykurilov/agent-chat-attachments` и передайте один объект в `attachments` сервиса и HTTP-обработчика внешних бесед. Используйте постоянное AttachmentStorage и задайте ограничения приложения. Если собственное хранилище или код исчерпывающе перечисляет AttachmentKind, добавьте новый `file`; этот вид используется для opt-in произвольных файлов. Адаптер реализует необязательный `sendMessage({text,messageId,attachments})`, каждый файл имеет `readBytes()`. Текст бывает пустым. Текстовый replay того же ID сохраняет файлы SDK.
  3. В Swift готовый экран принимает `attachmentsEnabled:true`; свой экран использует `AgentChatAttachmentController`, `AgentChatComposer(attachmentController:)` и `AgentChatMessageAttachments`. При отправке передайте `attachmentIds:controller.readyAttachmentIds` в `client.send`. Для камеры добавьте `NSCameraUsageDescription`. Фото преобразуются в JPEG до 2048 px и base64 до 5 МиБ.
  4. Для выбора модели адаптер реализует `models()` и `setModel({commandId,expectedRevision,choice})`, передаёт изменения событием `model_state`. Каталог, текущий выбор и revision исходят от исполнителя. После неоднозначной ошибки команда не повторяется автоматически. Swift скрывает выбор reasoning по умолчанию; включение отдельное. Точный контракт и машинные коды - `docs/external-native.md`.
  5. Собственный ConversationStore должен сохранять необязательные `messages[].attachments`, `modelState`, `modelCommands` атомарно с остальной записью. Встроенный SQLite готов. Обновите Swift-клиент до включения новых событий. Перед закрытием адаптера/хранилища дождитесь `service.close()`.
  6. Проверьте сообщение только с файлом, повторное подключение без дублей, загрузку после перезапуска и смену модели с подтверждением исполнителя. Запрет смены во время хода должен вернуть машинный busy; файлы другого владельца - 404.

### Patch Changes

- Updated dependencies [eec4550]
  - @ykurilov/agent-chat-core@0.87.0
  - @ykurilov/agent-chat-react@0.87.0

## 0.86.1

### Patch Changes

- Updated dependencies [f23e7bc]
  - @ykurilov/agent-chat-core@0.86.1
  - @ykurilov/agent-chat-react@0.86.1

## 0.86.0

### Patch Changes

- Updated dependencies [ae9467a]
  - @ykurilov/agent-chat-core@0.86.0
  - @ykurilov/agent-chat-react@0.86.0

## 0.85.0

### Patch Changes

- Updated dependencies [1f7a921]
  - @ykurilov/agent-chat-core@0.85.0
  - @ykurilov/agent-chat-react@0.85.0

## 0.84.0

### Patch Changes

- Updated dependencies [5e90be0]
  - @ykurilov/agent-chat-core@0.84.0
  - @ykurilov/agent-chat-react@0.84.0

## 0.83.3

### Patch Changes

- @ykurilov/agent-chat-core@0.83.3
  - @ykurilov/agent-chat-react@0.83.3

## 0.83.2

### Patch Changes

- Updated dependencies [f63dea9]
  - @ykurilov/agent-chat-core@0.83.2
  - @ykurilov/agent-chat-react@0.83.2

## 0.83.1

### Patch Changes

- @ykurilov/agent-chat-core@0.83.1
  - @ykurilov/agent-chat-react@0.83.1

## 0.83.0

### Patch Changes

- Updated dependencies [bad76a9]
  - @ykurilov/agent-chat-core@0.83.0
  - @ykurilov/agent-chat-react@0.83.0

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

- 038b6e2: Исправления аудита клиентской зоны. `useAgentChat` без `key` при смене чата больше не переносит в новый чат дела прежнего: «Стоп», ответ на подтверждение или виджет, передачу поправок и сорвавшуюся голосовую замену; новый чат не остаётся «занятым», повторное открытие того же чата начинается с чистого состояния. Песочница не зовёт хуки приложения, которые пишут данные (`onStateChanged`, `onTurnFinished`, `onModelChosen`), ни в песочном чате, ни в копии чата человека; `newChatGreeting` и `modelMenu` решаются для настоящего админа. Вложения: удаление человеком и чистка брошенных больше не убирают файл, который отправляемое сообщение уже отметило; `confirmUserParts` отказывает `AttachmentRejectedError` (`attachment_not_found` — файла нет или отметка не записана, `attachment_unavailable` — сбой хранилища), а не отмечает молча.
  
  ### Как обновить приложение
  
  Обновите пакеты SDK одной версией. Со встроенными хранилищами вложений (`createDiskAttachmentStorage`, `createMemoryAttachmentStorage`) ничего менять не нужно. Своё хранилище (`AttachmentStorage`, например S3) должно получить метод `removeUnattached(id): Promise<boolean>` — удалить файл, только если он не прикреплён, атомарно с `markAttached` того же файла; `removeUnattachedOlderThan` должен следовать тому же правилу. Без метода `createAttachments` бросает ошибку при запуске. Проверьте хранилище обновлённым `describeAttachmentStorageContract`. Если песочница полагалась на `onStateChanged`, `onTurnFinished` или `onModelChosen` в песочных чатах — в песочнице они больше не зовутся. [Подробности](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/audit-client.md).

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

### Minor Changes

- 88886de: Новые контракты приложения: HTTP `newChatGreeting` после `newChatData`, проверенное `createChat.title`, текущий вопрос `contextBlocks.userMessage` для ожидаемой асинхронной классификации, direct DeepSeek `low/high/max` и опциональные устойчивые номера фото.
  
  `createAttachments({ imageNumbers: true })` сохраняет серверный номер вместе с принятой картинкой; `service.getChatImages(userId, chatId)` возвращает соответствие номер/attachmentId полной активной ветки. Номера не меняются при повторе файла, перезапуске, компакции и переключении ветки; скрытые ветки не отдают свои номера другим файлам. Старые файлы без меток не заполняются задним числом, без настройки запрос модели прежний. Одновременные процессы используют существующую распределённую аренду чата.
  
  Приветствие вызывается только при HTTP-создании, не при GET/reload; повтор POST создаёт другой чат. `userMessage` равен null у служебного хода, approval/resume сохраняет исходный вопрос. Данные и название не попадают автоматически в системные инструкции. `importChat.chat.data` уже доступно в 0.77.0; тестовая модель — существующий AI SDK `ai/test`, новый тестовый пакет не нужен. Полные принятые contextBlocks после компакции передаются без обрезания, в прежнем порядке.
  
  Как обновить: все SDK-пакеты одной версией; новые настройки включать явно. SQL-схемы не меняются. [Точные примеры и ограничения](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/app-chat-contracts.md).

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

- ebfbed9: PDF-«бомба» (маленький сжатый поток, который распаковывается в сотни мегабайт) теперь всегда получает отказ `unreadable`. До разбора каждый сжатый поток PDF, кроме картинок, распаковывается с жёстким пределом — по умолчанию 64 МБ, настраивается `maxStreamBytes` в параметрах `extractText`. Раньше отказ держался только на потолке памяти потока разбора и зависел от сборки мусора: иногда вместо отказа приходили мегабайты текста. Потолок памяти остался второй линией защиты.
- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-core@0.61.0
  - @ykurilov/agent-chat-react@0.61.0

## 0.60.0

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

### Patch Changes

- Updated dependencies [084cef7]
  - @ykurilov/agent-chat-core@0.49.0
  - @ykurilov/agent-chat-react@0.49.0

## 0.48.0

### Patch Changes

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

### Patch Changes

- bc78aec: Вложения: идентификатор чата теперь кодируется в адресах загрузки, удаления и показа файлов. Раньше чат со «/», «?», «#» или пробелом в идентификаторе загружал и удалял файлы по неверному адресу.
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

- @ykurilov/agent-chat-core@0.31.2
  - @ykurilov/agent-chat-react@0.31.2

## 0.31.1

### Patch Changes

- @ykurilov/agent-chat-core@0.31.1
  - @ykurilov/agent-chat-react@0.31.1

## 0.31.0

### Patch Changes

- @ykurilov/agent-chat-core@0.31.0
  - @ykurilov/agent-chat-react@0.31.0

## 0.30.0

### Patch Changes

- @ykurilov/agent-chat-core@0.30.0
  - @ykurilov/agent-chat-react@0.30.0

## 0.29.0

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

- fd16b01: Вложения и голос можно подключить к мессенджерам. У маршрутов `@ykurilov/agent-chat-attachments` появился `ingestFile` — файл из мессенджера становится вложением чата. `@ykurilov/agent-chat-voice/server` отдаёт `transcribeAudioFile` — голосовое сообщение превращается в текст через Soniox. Примеры обёрток — в README `@ykurilov/agent-chat-messengers`.
  
  Что сделать в приложении: ничего, пока мессенджеры не подключены.

### Patch Changes

- Updated dependencies [fd16b01]
- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-core@0.20.0
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
  - @ykurilov/agent-chat-react@0.19.0

## 0.18.6

### Patch Changes

- @ykurilov/agent-chat-core@0.18.6
  - @ykurilov/agent-chat-react@0.18.6

## 0.18.5

### Patch Changes

- Updated dependencies [56b9ab6]
  - @ykurilov/agent-chat-react@0.18.5
  - @ykurilov/agent-chat-core@0.18.5

## 0.18.4

### Patch Changes

- @ykurilov/agent-chat-core@0.18.4
  - @ykurilov/agent-chat-react@0.18.4

## 0.18.3

### Patch Changes

- Updated dependencies [ce3c26f]
  - @ykurilov/agent-chat-react@0.18.3
  - @ykurilov/agent-chat-core@0.18.3

## 0.18.2

### Patch Changes

- Updated dependencies [7e7e966]
  - @ykurilov/agent-chat-react@0.18.2
  - @ykurilov/agent-chat-core@0.18.2

## 0.18.1

### Patch Changes

- Updated dependencies [179ad9d]
  - @ykurilov/agent-chat-react@0.18.1
  - @ykurilov/agent-chat-core@0.18.1

## 0.18.0

### Patch Changes

- Updated dependencies [43d7ebe]
  - @ykurilov/agent-chat-core@0.18.0
  - @ykurilov/agent-chat-react@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [e5d0860]
  - @ykurilov/agent-chat-react@0.17.0
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
  - @ykurilov/agent-chat-react@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [f05ad23]
- Updated dependencies [f05ad23]
  - @ykurilov/agent-chat-core@0.15.0
  - @ykurilov/agent-chat-react@0.15.0

## 0.14.0

### Minor Changes

- 96098be: Мелкие исправления (022). Символ с кодом ноль в первом сообщении больше не роняет отправку на Postgres: он выбрасывается из названия чата, из записей памяти и из сводки сжатия истории (иначе запись сжатия падала бы при каждой попытке); в самом тексте сообщения он лежит как раньше. Вложения отмечаются прикреплёнными до записи сообщения, а не после: если сервер упал между двумя шагами, чистка брошенных файлов не удалит их через сутки (файл, отмеченный зря, безвреден и уходит вместе с чатом). Во всех пакетах появилось поле `engines: { node: ">=22" }`; голосовой сервер (`createVoiceRelay`) и голосовой диалог (`createDialogRelay`) на Node 20 сразу при создании говорят понятной ошибкой, что нужен Node 22 (раньше падали при первом соединении; со своим `connectUpstream` проверки нет). В пакете вложений `react` и `@ykurilov/agent-chat-react` стали необязательными peer-зависимостями: серверу без экрана они больше не ставятся. Приложению, которое берёт `@ykurilov/agent-chat-attachments/react`, достаточно иметь их в проекте — для чата на экране они нужны и так; если они подтягивались только через вложения, добавьте их в зависимости приложения.
- 84ad64f: Укрепление по третьему проходу Pi (022, этап S9). **Большие фото уменьшаются при загрузке**: поворот по EXIF, не больше 2000×2000 пикселей и ~4,5 МБ в base64; хранится уменьшенная копия, старые картинки ужимаются при сборке запроса (результат запоминается), нечитаемая картинка и картинка больше 60 млн пикселей — отказ 422 `unreadable` (в старой истории — пометка «пропущена»). Новая зависимость `sharp` (готовые сборки для macOS и Linux, в том числе Alpine; порядок ужатия из pi-mono, MIT). **Секреты в ошибке инструмента** вычищаются до того, как текст уйдёт человеку, в базу и модели: пароль в адресе, `password=`/`password: …`/`token=`, `"secret": "…"`, заголовок `Authorization`, `X-Api-Key`, ключи сервисов, закрытые ключи PEM и значения секретных переменных окружения (кроме путей, адресов без пароля и простых слов); чистятся сообщение, стек и `cause`; `scrubSecrets` и `environmentSecrets` экспортированы из ядра. **Внешние картинки** в ответе модели и в сводке сжатия скин Тандема показывает ссылкой и не грузит (новая необязательная надпись словаря `externalImageLink`, по умолчанию «картинка»; свои словари без неё работают); инструкция веб-инструментов называет страницы данными, а не указаниями. **Ступени цены** по длине контекста: `pricing.tiers` (`inputTokensAbove` и цены), ход считается по шагам; у GPT 6 Luna выше 272 тысяч токенов. Пауза в `useAgentChat` больше не копит слушатели отмены.
- 0cdf102: Несколько копий сервера на одной базе (022, этап 8в). Идущий ответ раз в 5 с отмечает «жив» (новая колонка `alive_at`: миграция SQLite `0012`, PostgreSQL `0011`, применяются сами). `recoverInterruptedAnswers` прерывает только брошенные ответы — без отметки дольше 15 с — и дальше сам проверяет их раз в 5 с до `flush`. Штатная остановка помечает свои ответы брошенными, и следующий старт прерывает их сразу. Новая копия при старте и обновление с перекрытием больше не обрывают живые ответы соседа; две копии, прервавшие один ответ, не задваивают расход. Цена: после падения сервера ответ ещё до ~20 с выглядит идущим (раньше перезапуск прерывал его сразу). Экран человека в это время сам перечитывает историю раз в 3 с и показывает «прерван» с «Повторить», как только сервер прервёт ответ; обновлять страницу не нужно (история отдаёт признак `detachedAnswer`, чтение истории сразу прерывает брошенный дольше порога ответ этого чата). Ход, чей ответ прервала другая копия, останавливается сам: человек видит «прерван», расход не задваивается. Время знака «жив» ставит хранилище: PostgreSQL — по часам базы, часы машин с копиями могут расходиться. Запросы одного чата держите на одной копии. Свои хранилища: два новых необязательных метода — `listSilentAnswerIds({ silentForMs, chatId? })` и лёгкая отметка `markAnswerAlive(messageId)` — и поле записи `alive` (`"now"` или `"released"`, время ставит само хранилище); общий набор контракта их проверяет. Хранилище без `listSilentAnswerIds` продолжает работать только с одной копией сервера: при старте `recoverInterruptedAnswers` прерывает все идущие ответы, проверок брошенных ответов дальше нет, а в журнал сервера пишется предупреждение. Без `markAnswerAlive` знак в тишине идёт полной записью ответа. Поле `alive` приходит в `insertMessage`, `updateStreamingMessage` и `updateAwaitingMessage`: если хранилище не ведёт знак, уберите поле перед записью, а не передавайте его в базу целиком. Переход на эту версию — один раз без перекрытия копий: старые копии не отмечают «жив», и новая прервала бы их ответы старше 15 с; сначала остановите все старые копии, потом запускайте новые. Дальше перекрытие безопасно. Если запрос истории попал не на ту копию, экран через 30 с сам покажет «прерван», хотя ответ идёт: держите запросы одного чата на одной копии. Сбой базы при конечной записи ответа повторяется через 1 и 3 с, а если не вышло — ответ остаётся для восстановления вместо вечного «идёт»; если запись прошла, а потерялся только ответ базы, повтор узнаёт свой итог и считает его удачным. Инструмент «по очереди», не слушающий отмену, после обрыва попытки держит очередь не дольше своего срока; очередь одна на чат, так что «Стоп» и сразу «Повторить» не запустят его второй раз параллельно. Восстановление пропускает ответ, на котором упало, с записью в журнал сервера, и прерывает остальные: битая запись не мешает серверу стартовать. Мелочи: адрес ответа вкладки на браузерный инструмент отвечает 413 `too_large` на слишком большое тело; неотвеченный запрос подтверждения закрывается только после сохранения нового сообщения, а если закрыть не вышло — повтор того же сообщения или «Повторить» доводят дело до конца; вызов веб-инструмента, оборванный «Стопом» или сбоем после отправки запроса, пишется в расход `web_tools`; картинки при загрузке ужимаются через очередь — разом не больше половины ядер (`limits.maxParallelImageFits`).
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

- 8b59096: Настоящий расход оборванных ответов и надёжнее переходы между попытками (022, этап 8б). «Стоп» или обрыв посреди ответа у OpenRouter сначала записывается оценкой «примерно», а затем сервер в фоне узнаёт у OpenRouter настоящий расход генерации по её номеру и дописывает запись `answer_correction` — разницу с оценкой (может быть меньше нуля); сумма записей ответа становится точной. Не узнал за ~10 минут или сервер перезапустился — остаётся оценка. Свой провайдер подключает то же новым необязательным полем описания `generationUsage` (номер генерации из заголовков и запрос расхода по номеру). Запрос, открытый, но оборванный до первого куска, теперь оценивается входом; отказ провайдера — нет. Расход хода пишется по каждому провайдеру отдельно и по его цене: основной, с которого ушли на запасной, — по своему тарифу; восстановление после перезапуска делает так же и считает ступень цены у каждого шага (идущая запись несёт `usage.pendingSteps`). У каждой попытки хода своя отмена: переход к повтору, запасному провайдеру или автопродолжению отменяет инструменты старой попытки; запущенный инструмент из `sequentialTools` держит очередь до своего конца, так что новая попытка не запустит второе «спиши деньги» поверх первого. Фоновая память после ответа идёт к провайдеру, который ответил, а не к лежащему основному. Старые картинки ужимаются один раз: кэш решений ограничен памятью копий, а не 20 местами, и чат с десятками старых картинок не ужимает их заново на каждом шаге. Память под копии — новая настройка `createAttachments({ limits: { imageCacheBytes } })`, по умолчанию 128 МБ.
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
- Updated dependencies [6335921]
- Updated dependencies [00965e1]
- Updated dependencies [0e8e0ae]
- Updated dependencies [6b20d83]
- Updated dependencies [1402afe]
- Updated dependencies [d12dcf3]
- Updated dependencies [366d785]
- Updated dependencies [946e5d8]
  - @ykurilov/agent-chat-core@0.14.0
  - @ykurilov/agent-chat-react@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [4793e4d]
  - @ykurilov/agent-chat-core@0.13.0
  - @ykurilov/agent-chat-react@0.13.0

## 0.12.0

### Patch Changes

- @ykurilov/agent-chat-core@0.12.0
  - @ykurilov/agent-chat-react@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [9d510b8]
  - @ykurilov/agent-chat-react@0.11.0
  - @ykurilov/agent-chat-core@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [4a76ff3]
  - @ykurilov/agent-chat-core@0.10.0
  - @ykurilov/agent-chat-react@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [d07a1c3]
  - @ykurilov/agent-chat-core@0.9.0
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
  - @ykurilov/agent-chat-core@0.8.0
  - @ykurilov/agent-chat-react@0.8.0

## 0.7.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [b8f9e9f]
- Updated dependencies [7c205c4]
- Updated dependencies [e741e6d]
  - @ykurilov/agent-chat-core@0.7.0
  - @ykurilov/agent-chat-react@0.7.0
