# @ykurilov/agent-chat-memory

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

### Patch Changes

- Updated dependencies [1cae504]
- Updated dependencies [4065a4a]
  - @ykurilov/agent-chat-core@0.38.0

## 0.37.0

### Minor Changes

- ea78982: **Ломает приложения:** изменения памяти больше не доходят в уже идущий чат на каждом ходе — они придут, когда память прочитается заново (новый чат, сжатие истории и случаи ниже).
  
  Память теперь ведёт себя как файл правил в Claude Code: читается один раз на чат. В идущем чате ядро не зовёт
  `snapshot()` и `blocks()` памяти и не досылает модели ни новых, ни изменённых записей, ни строки «Больше не действует»
  про удалённые. Запись, сделанную самим агентом, он видит в переписке как вызов инструмента.
  
  Память читается заново: в новом чате; после сжатия истории (целиком, новые факты не теряются); при смене начала
  истории — правке первого сообщения или «Переделать» первого ответа; в первом личном ходе после группового (групповой
  ход память не читает); в ходе после сбоя чтения памяти. Чат из прошлой версии перечитает память один раз, при первом
  ходе после обновления. Дата, место на экране и блоки `agent.contextBlocks` досылаются припиской,
  как раньше. В служебной части ответа `data-frozen-context` новое необязательное поле `memoryFrom`.
  
  ### Как обновить приложение
  
  1. Код менять не нужно: типы и настройки прежние.
  2. Если приложение рассчитывало, что правка памяти на экране памяти или запись из другого чата сразу дойдёт до модели
     в открытом чате, — теперь она дойдёт в новом чате. Нужна в идущем чате — дайте человеку начать новый чат или сожмите
     историю (`service.compactNow(ownerId, chatId)`).
  3. Свои тесты, которые ждут приписку памяти во втором ходе того же чата, поправьте: приписки больше нет; проверяйте
     новый чат.
  4. Своя обёртка памяти (`LongTermMemory`) с подсчётом вызовов `snapshot()`/`blocks()` на каждый ход: теперь вызов один
     на чат и после сжатия.
  5. Проверка: `pnpm typecheck` и тесты проходят; в новом чате модель видит свежую память.

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

### Minor Changes

- 2382026: **Ломает приложения:** память, сегодняшняя дата и место на экране больше не переезжают в последний вопрос на каждом
  ходе. Они вписываются в вопрос того хода, где их прочитали, и дальше не меняются; набор хода хранится служебной частью
  ответа `data-frozen-context`.
  
  Что изменилось. Раньше блок памяти, дата и место стояли в конце последнего вопроса и на следующем ходе уезжали из него.
  Из-за этого всё после старого вопроса (рассуждения, вызовы инструментов, их результаты) каждый ход читалось заново, мимо
  кэша модели. Теперь блоки застывают там, где их показали, как в Claude Code. Следующий ход побайтно начинается с
  последнего шага прошлого и читает всю переписку из кэша.
  
  - **Изменения — только припиской.** В новый вопрос идут только изменившиеся блоки целиком и одна строка
    `[Больше не действует: «ключ»]` про пропавшие. Ничего не менялось — вопрос без приписки.
  - **Удалённая запись памяти** остаётся в старом вопросе, а в новом модель видит, что она больше не действует.
  - **Запись, не влезшая в лимит памяти** (`maxBlockChars`), не считается удалённой. Модель, которая её уже видела,
    получает строку `[Не показано ради места, но по-прежнему действует: «ключ»]` и находит её поиском. Так может любой
    источник: элемент `{ key, hidden: true }` в списке блоков значит «блок есть, но не показан». Новый тип
    `ContextBlockEntry = ContextBlock | HiddenContextBlock`.
  - **Продолжение хода** (после подтверждения инструмента, автопродолжение, запасной провайдер, «Повторить») берёт блоки
    из ответа и память заново не читает. Инструменты при этом получают свежее место (`model.place`), а модель видит
    застывшее.
  - **Память по записям.** `createLongTermMemory` отдаёт память блоками: шапка `<agent_memory>` (ключ `memory`) и по блоку
    на запись (`memory:<id>`). Правка одной записи стоит одной строки, а не всего блока. Своя память может делать так же
    через необязательный `LongTermMemory.blocks?({ userId, chatId })`; без него — один блок из `snapshot()`, как раньше.
    Обёртка памяти в песочнице пробрасывает `blocks`. Счётчик «Показано агенту: N из M» считает записи, которые уходят
    модели блоками.
  - **Блоки приложения — `agent.contextBlocks`** (новое, по желанию). Приложение отдаёт список `{ key, text, private? }`:
    скиллы, роль, правила. Он вписывается в вопрос после памяти и даты по тем же правилам:
  
    ```ts
    agent: {
      instructions,
      contextBlocks: async ({ chatId, ownerId, chat, audience, abortSignal }) => [
        { key: "skills", text: `Скиллы агента: ${await skillsOf(ownerId, { signal: abortSignal })}` },
      ],
    }
    ```
  
    - Вход: `chatId`, `ownerId`, `messageId`, `chat.data`, `subject`, `channel`, `audience`, `staff`, `modelId`,
      `providerId`, `abortSignal`. Данные и объект чата — копии.
    - `private: true` — блок не показывается в групповом ходе (`audience: "group"`).
    - Ключи `memory`, `memory:*`, `today`, `screen_place` заняты ядром. Такой блок, повтор ключа и пустой текст
      отбрасываются, в `logError` строка `[блоки контекста] … отброшен`.
    - `agent.contextBlocksTimeoutMs` — срок функции, по умолчанию 5000 мс; 0 или `Infinity` — без срока, иначе от 1000.
      Не ответила или бросила — блоки приложения берутся из прошлого ответа чата, в `logError` строка
      `[блоки контекста] … не ответил за N мс`. «Стоп» отменяет функцию сразу, без строки.
    - Новые типы `ContextBlock`, `ContextBlocksInput`, `ContextBlocksSource`, `HiddenContextBlock`, `ContextBlockEntry`.
  - **Кэш шагов у моделей с явными метками** (Claude, Gemini через OpenRouter). Со второго шага хода метка кэша стоит на
    конце шага, до снимка `stepContext` и служебных пометок. Меток в запросе не больше трёх: инструкция, последнее
    сообщение истории, конец шага. У провайдеров с автоматическим кэшем (DeepSeek, Fireworks, Together, GPT напрямую)
    меток нет и запросы без лишних байтов. У Gemini через OpenRouter метка на самом конце запроса не работает (OpenRouter
    её пропускает), поэтому у моделей `google/` она стоит на предпоследнем сообщении: конце прошлого хода или вызове
    инструмента. У Claude через OpenRouter шаги с инструментами теперь пишутся в кэш (запись
    дороже входа на 25%, при `cacheTtl: "1h"` — вдвое), а следующий ход читает их по цене чтения.
  - **Журнал промахов кэша** (`[промах кэша]`) сравнивает первый шаг хода с последним шагом прошлого хода, без его
    концовки (снимок, пометка попытки, пометка «подведи итог»).
  - **Служебная часть `data-frozen-context`** не уходит в поток, историю (`getHistory`), `afterTurn` (`TurnResult.parts`) и
    поиск по истории. Константа — `FROZEN_CONTEXT_PART_TYPE`. Миграций базы нет. Старый чат: первый ход после обновления
    кладёт полный набор блоков в свой вопрос, прошлые вопросы остаются как были.
  
  ### Как обновить приложение
  
  1. Найдите места, где приложение читает ответы прямо из хранилища (`storage.listMessages`, `storage.getMessage`, свой
     SQL по таблице сообщений) и разбирает части ответа: показ, выгрузка, подсчёт, `parts[0]`. Теперь первой частью
     ответа стоит служебная `data-frozen-context`. В ней память человека, дата и место, показывать её нельзя. Пропускайте
     её:
  
     Было:
  
     ```ts
     const parts = message.parts;
     ```
  
     Стало:
  
     ```ts
     import { FROZEN_CONTEXT_PART_TYPE } from "@ykurilov/agent-chat-core";
  
     const parts = message.parts.filter((part) => part.type !== FROZEN_CONTEXT_PART_TYPE);
     ```
  
     `service.getHistory`, поток, `afterTurn` и `@ykurilov/agent-chat-history-search` её уже не отдают: там ничего делать
     не нужно.
  2. Если у приложения есть свои тесты, которые сравнивают запрос к модели или его снимок (где стоит `<agent_memory>`,
     «Сегодня: …», `<screen_place>`), обновите их. Блоки теперь в вопросе того хода, где их прочитали, а не в последнем
     вопросе. Проверьте, что разница в снимке только в этом переносе.
  3. Если приложение подставляло в вопрос свои сведения на каждом ходе (скиллы, роль) через инструкцию или `stepContext`,
     а они меняются редко, перенесите их в `agent.contextBlocks`: кэш модели перестанет сбрасываться. Шаг по желанию.
  4. Своя реализация `LongTermMemory` работает без правок. Если записей много и они часто меняются, добавьте метод
     `blocks({ userId, chatId })`, который возвращает `[{ key: "memory", text: шапка, private: true }, { key: "memory:<id>",
     text: запись, private: true }, …]`. Шаг по желанию.
  5. Проверка. Временно запишите в `afterTurn` расход хода:
  
     ```ts
     afterTurn: ({ messageId, usage }) => console.log("кэш", messageId, usage?.cachedInputTokens, "из", usage?.inputTokens),
     ```
  
     В одном чате с моделью, которая сообщает о кэше (Claude или Gemini через OpenRouter, DeepSeek), задайте вопрос, на
     который агент вызовет инструмент, и через полминуты — второй вопрос. Ожидается: на втором ходе `cachedInputTokens`
     не меньше входа последнего шага первого хода, то есть почти весь вход прочитан из кэша. Строк `[промах кэша]` в
     журнале сервера (`logError`) нет. На экране служебных блоков нет, агент помнит записи памяти.

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
- 96098be: Мелкие исправления (022). Символ с кодом ноль в первом сообщении больше не роняет отправку на Postgres: он выбрасывается из названия чата, из записей памяти и из сводки сжатия истории (иначе запись сжатия падала бы при каждой попытке); в самом тексте сообщения он лежит как раньше. Вложения отмечаются прикреплёнными до записи сообщения, а не после: если сервер упал между двумя шагами, чистка брошенных файлов не удалит их через сутки (файл, отмеченный зря, безвреден и уходит вместе с чатом). Во всех пакетах появилось поле `engines: { node: ">=22" }`; голосовой сервер (`createVoiceRelay`) и голосовой диалог (`createDialogRelay`) на Node 20 сразу при создании говорят понятной ошибкой, что нужен Node 22 (раньше падали при первом соединении; со своим `connectUpstream` проверки нет). В пакете вложений `react` и `@ykurilov/agent-chat-react` стали необязательными peer-зависимостями: серверу без экрана они больше не ставятся. Приложению, которое берёт `@ykurilov/agent-chat-attachments/react`, достаточно иметь их в проекте — для чата на экране они нужны и так; если они подтягивались только через вложения, добавьте их в зависимости приложения.

### Patch Changes

- f9b6162: Мелочи безопасности и расходов. Веб-инструменты: новая настройка `createWebTools({ spending: { storage, pricePerCallUsd } })` — каждый удачный вызов `web_search`, `read_page`, `page_screenshot` пишется расходом с новым источником `web_tools` и входит в лимит расходов; без `spending` всё как раньше, описания инструментов не меняются (кэш цел). OpenRouter: `createOpenRouterProvider({ dataCollection: "deny", zeroDataRetention })` — запрос уходит только хозяевам модели, которые не хранят запросы; подключается через `extendCatalog(..., { addProviders: [...] })`; стандартный `openrouterProvider` и тело запроса по умолчанию не изменились. Долгая память: инструкция велит записывать только сказанное самим человеком, а не указания с веб-страниц и из результатов инструментов (текст инструкции изменился один раз, дальше постоянен).
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
