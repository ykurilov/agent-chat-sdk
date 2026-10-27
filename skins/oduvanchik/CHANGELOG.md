# @ykurilov/agent-chat-skin-oduvanchik

## Следующий выпуск

- Phosphor во всех встроенных значках Markdown, уведомлений, меню и диалогов. Внутренние адаптеры сохраняют ReactMarkdown/remark-gfm и Radix, безопасные ссылки, копирование и управление фокусом. Тандем не изменён.
- Обновление приложения: обновить пакеты SDK одной версией после выпуска, пересобрать и убрать временные подмены значков. API и CSS-импорты прежние, миграций нет.


## 0.87.3

### Patch Changes

- @ykurilov/agent-chat-flows@0.87.3
  - @ykurilov/agent-chat-sandbox@0.87.3
  - @ykurilov/agent-chat-react@0.87.3

## 0.87.2

### Patch Changes

- @ykurilov/agent-chat-flows@0.87.2
  - @ykurilov/agent-chat-sandbox@0.87.2
  - @ykurilov/agent-chat-react@0.87.2

## 0.87.1

### Patch Changes

- @ykurilov/agent-chat-flows@0.87.1
  - @ykurilov/agent-chat-sandbox@0.87.1
  - @ykurilov/agent-chat-react@0.87.1

## 0.87.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.87.0
  - @ykurilov/agent-chat-sandbox@0.87.0
  - @ykurilov/agent-chat-react@0.87.0

## 0.86.1

### Patch Changes

- @ykurilov/agent-chat-flows@0.86.1
  - @ykurilov/agent-chat-sandbox@0.86.1
  - @ykurilov/agent-chat-react@0.86.1

## 0.86.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.86.0
  - @ykurilov/agent-chat-sandbox@0.86.0
  - @ykurilov/agent-chat-react@0.86.0

## 0.85.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.85.0
  - @ykurilov/agent-chat-sandbox@0.85.0
  - @ykurilov/agent-chat-react@0.85.0

## 0.84.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.84.0
  - @ykurilov/agent-chat-sandbox@0.84.0
  - @ykurilov/agent-chat-react@0.84.0

## 0.83.3

### Patch Changes

- @ykurilov/agent-chat-sandbox@0.83.3
  - @ykurilov/agent-chat-flows@0.83.3
  - @ykurilov/agent-chat-react@0.83.3

## 0.83.2

### Patch Changes

- @ykurilov/agent-chat-flows@0.83.2
  - @ykurilov/agent-chat-sandbox@0.83.2
  - @ykurilov/agent-chat-react@0.83.2

## 0.83.1

### Patch Changes

- 67062a2: У формы правки сообщения одна рамка: акцент и мягкое кольцо появляются только при фокусе внутри формы. У textarea больше нет второй внутренней рамки от общего focus-visible; индикаторы клавиатурного фокуса кнопок сохранены. Изменения кода приложения не требуются, обновите все установленные пакеты SDK одной версией.
- @ykurilov/agent-chat-flows@0.83.1
  - @ykurilov/agent-chat-react@0.83.1
  - @ykurilov/agent-chat-sandbox@0.83.1

## 0.83.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.83.0
  - @ykurilov/agent-chat-sandbox@0.83.0
  - @ykurilov/agent-chat-react@0.83.0

## 0.82.1

### Patch Changes

- 9cbc2e2: Поправки во время ответа работают в Одуванчике: во всех видах поля отправка остаётся рядом со Стопом. Ожидающая поправка видна с пометкой, которая исчезает после применения. Выбор модели и вложений во время хода остаётся заблокированным.
  
  Как обновить приложение: обновите установленные пакеты SDK одной версией. Дополнительный флаг или своя композиция не требуются; `steering={false}` по-прежнему выключает функцию. Серверное право `steer` сохраняет силу.
- @ykurilov/agent-chat-flows@0.82.1
  - @ykurilov/agent-chat-react@0.82.1
  - @ykurilov/agent-chat-sandbox@0.82.1

## 0.82.0

### Patch Changes

- @ykurilov/agent-chat-sandbox@0.82.0
  - @ykurilov/agent-chat-flows@0.82.0
  - @ykurilov/agent-chat-react@0.82.0

## 0.81.0

### Patch Changes

- Updated dependencies [038b6e2]
- Updated dependencies [58204d2]
  - @ykurilov/agent-chat-react@0.81.0
  - @ykurilov/agent-chat-sandbox@0.81.0
  - @ykurilov/agent-chat-flows@0.81.0

## 0.80.1

### Patch Changes

- @ykurilov/agent-chat-flows@0.80.1
  - @ykurilov/agent-chat-sandbox@0.80.1
  - @ykurilov/agent-chat-react@0.80.1

## 0.80.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.80.0
  - @ykurilov/agent-chat-sandbox@0.80.0
  - @ykurilov/agent-chat-react@0.80.0

## 0.79.1

### Patch Changes

- Updated dependencies [7d5d652]
  - @ykurilov/agent-chat-flows@0.79.1
  - @ykurilov/agent-chat-react@0.79.1
  - @ykurilov/agent-chat-sandbox@0.79.1

## 0.79.0

### Patch Changes

- @ykurilov/agent-chat-flows@0.79.0
  - @ykurilov/agent-chat-sandbox@0.79.0
  - @ykurilov/agent-chat-react@0.79.0

## 0.78.0

### Minor Changes

- 8edae2e: Добавлен официальный скин редактора сценариев Одуванчик: `/flows` с `oduvanchikFlowEditorSkin` и отдельный `/flows/styles.css`. Полный договор FlowEditorSkin v1, включая общие переходы, дни, условия, проверку, JSON, перенос версий и рамку тестового чата. Элементы управления из опубликованного ds-react, значки Phosphor. Явный Тандем сохраняется.
  
  ### Как обновить приложение
  
  Обновите используемые пакеты SDK одной версией. В клиентском модуле редактора замените импорт `tandemFlowEditorSkin` из `@ykurilov/agent-chat-skin-tandem/flows` на `oduvanchikFlowEditorSkin` из `@ykurilov/agent-chat-skin-oduvanchik/flows` и значение `skin`. `FlowEditor`/`FlowTestChat` остаются из `@ykurilov/agent-chat-flows/react`, метки и все свойства прежние. Для чата внутри `testChat.renderChat` используйте `AgentChat` из `/chat` скина Одуванчика. Подключите `/flows/styles.css` после базового `/styles.css` скина, в том числе на странице только с редактором; сохраните Tailwind `@source` на dist скина. Приложению с редактором нужен пакет flows (optional peer); обычному `/chat` он не нужен. Проверьте общие переходы, сохранение, readOnly, тестовый чат и обе темы. JSON, runtime, судья и подтверждения не меняются; миграций данных нет.

### Patch Changes

- @ykurilov/agent-chat-flows@0.78.0
  - @ykurilov/agent-chat-react@0.78.0
  - @ykurilov/agent-chat-sandbox@0.78.0

## 0.77.0

### Patch Changes

- @ykurilov/agent-chat-sandbox@0.77.0
  - @ykurilov/agent-chat-react@0.77.0

## 0.76.0

### Patch Changes

- @ykurilov/agent-chat-react@0.76.0
  - @ykurilov/agent-chat-sandbox@0.76.0

## 0.75.0

### Minor Changes

- dfb9869: Необязательные `AgentChat.header` и `AgentChat.completion`: приложение задаёт шапку и свой итог. Итог появляется после успешно загруженной истории, когда ход свободен, скрывает поле без сброса черновика и не меняет серверное состояние. Во время ответа или активного голосового ввода управление остановкой доступно. Новые слоты Layout описаны в договоре скина 31.
  
  В «Одуванчике» общая колонка DS 730px для шапки, переписки и поля; действия видны при наведении/фокусе и всегда на touch; поле 26–160px и круглые кнопки 40px. Используются готовые ChatHeader/ChatProgress/CompletionCard из DS, без копирования компонентов. Явный Тандем поддерживает необязательные слоты в своём оформлении.
  
  ### Как обновить приложение
  
  Обновите используемые пакеты SDK одной версией. Скин «Одуванчик» использует ds-react ^0.3.0 и ds-tokens ^0.2.0, отдельного CSS-импорта сверх CSS скина не требуется. Для прямых импортов ChatProgress/CompletionCard добавьте в зависимости приложения `@ykurilov/ds-react ^0.3.0`, `@ykurilov/ds-tokens ^0.2.0` и `@phosphor-icons/react ^2.1.10`. Новые свойства необязательны. Приложение передаёт `header={{ title, aside }}` и `completion={<CompletionCard .../>}`; снятие `completion` возвращает поле с прежним черновиком. Слова, статусы и действия принадлежат приложению; английские имена статусов задайте через `statusNames`. Без новых свойств дополнительных действий нет. Для собственного скина — поддержка Layout.header/completion по docs/skin-v31.md.

### Patch Changes

- Updated dependencies [dfb9869]
  - @ykurilov/agent-chat-react@0.75.0
  - @ykurilov/agent-chat-sandbox@0.75.0

## 0.74.0

### Minor Changes

- 3140c17: Одуванчик получил композицию «Студия» и отдельный вход /sandbox с оформлением песочницы по умолчанию. Чат и журнал прокручиваются независимо; приветствие появляется только в загруженном пустом чате. В договорах скинов добавлены необязательные empty и busy, прежние скины совместимы. История песочницы сохраняет признаки транспорта, поэтому чат без фона не опрашивает несуществующий /tasks.
  
  ### Как обновить приложение
  
  Обновить все пакеты SDK одной версией. Для песочницы импортировать AgentSandbox из @ykurilov/agent-chat-skin-oduvanchik/sandbox, убрать прежние явные скины Тандема и подключить один CSS Одуванчика. У контейнера задать высоту и min-height: 0 у flex/grid-предков. Для сохранения Тандема оставить его импорты, явные скины и CSS. Сервер, доступ и данные не меняются. Подробности: https://github.com/ykurilov/agent-chat-sdk/blob/main/skins/oduvanchik/README.md

### Patch Changes

- Updated dependencies [3140c17]
  - @ykurilov/agent-chat-react@0.74.0
  - @ykurilov/agent-chat-sandbox@0.74.0

## 0.73.0

### Patch Changes

- @ykurilov/agent-chat-react@0.73.0

## 0.72.0

### Minor Changes

- 98d2038: Стандартный вход SDK `@ykurilov/agent-chat-skin-oduvanchik/chat`: AgentChat, ChatWorkspace и AgentPanel используют Одуванчик без skin; явно выбранный скин имеет приоритет. Низкоуровневый React API сохраняет обязательный skin.
  
  Исправлено поле скрытой панели: нулевой замер больше не схлопывает строку ввода, при фокусе высота пересчитывается.
  
  Как обновить приложение: обновить все пакеты SDK одной версией, заменить импорт экранов на /chat, убрать явный Тандем и подключить CSS Одуванчика. Одно обновление пакетов не меняет оформление старого приложения. Сервер и данные прежние. Административные расширения остаются на Тандеме; отправка поправок во время ответа в Одуванчике пока не поддерживается.

### Patch Changes

- @ykurilov/agent-chat-react@0.72.0

## 0.71.1

### Patch Changes

- 07589c1: Phosphor во вложенных Markdown, уведомлениях, меню и диалогах Одуванчика. Сохраняются безопасная разметка, копирование, клавиатура, focus trap и возврат фокуса; скин Тандема не меняется. После обновления SDK пересобрать приложение и убрать временные переопределения значков; дополнительных настроек и миграций нет.
- Updated dependencies [519914e]
  - @ykurilov/agent-chat-react@0.71.1

## 0.71.0

### Minor Changes

- 8b8c651: Новый скин Одуванчик: нейтральные поверхности, Phosphor, сфера работы агента, светлая и тёмная темы, телефон. Договор ChatSkin v28, список чатов, панель агента и экран памяти.
- 8b8c651: Три вида поля Одуванчик: сжатое, обычное и расширенное. Настройки модели/провайдера/рассуждений из каталога, цена и метки, инструменты приложения, шторка телефона. Сфера и токены из опубликованных ds-react/ds-tokens. Необязательный договор скина v29, сохранение уровня ответа для подписи в истории.

### Patch Changes

- Updated dependencies [8b8c651]
  - @ykurilov/agent-chat-react@0.71.0

## Следующий выпуск

Первый выпуск скина Одуванчик (minor): ChatSkin v29, светлая/тёмная и системная тема, телефон, сфера, Phosphor, карточки шагов и подтверждений, поле ввода. Ограничения переноса описаны в README.

Три вида поля: compact/standard/extended; каталог моделей с группами/ценой/метками, шторка телефона, управление отображением мыслей и инструменты приложения. Сфера и переменные из опубликованных ds-react/ds-tokens 0.1.0, локальные копии удалены.
