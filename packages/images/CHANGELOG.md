# @ykurilov/agent-chat-images

## 0.70.1

### Patch Changes

- Updated dependencies [ba86a4a]
  - @ykurilov/agent-chat-core@0.70.1
  - @ykurilov/agent-chat-attachments@0.70.1
  - @ykurilov/agent-chat-react@0.70.1

## 0.70.0

### Patch Changes

- Updated dependencies [7e54665]
  - @ykurilov/agent-chat-core@0.70.0
  - @ykurilov/agent-chat-attachments@0.70.0
  - @ykurilov/agent-chat-react@0.70.0

## 0.69.1

### Patch Changes

- Updated dependencies [857777b]
  - @ykurilov/agent-chat-core@0.69.1
  - @ykurilov/agent-chat-attachments@0.69.1
  - @ykurilov/agent-chat-react@0.69.1

## 0.69.0

### Patch Changes

- Updated dependencies [e6c03dc]
  - @ykurilov/agent-chat-core@0.69.0
  - @ykurilov/agent-chat-react@0.69.0
  - @ykurilov/agent-chat-attachments@0.69.0

## 0.68.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.68.0
  - @ykurilov/agent-chat-core@0.68.0
  - @ykurilov/agent-chat-react@0.68.0

## 0.67.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.67.0
  - @ykurilov/agent-chat-core@0.67.0
  - @ykurilov/agent-chat-react@0.67.0

## 0.66.0

### Patch Changes

- Updated dependencies [1d57795]
  - @ykurilov/agent-chat-core@0.66.0
  - @ykurilov/agent-chat-attachments@0.66.0
  - @ykurilov/agent-chat-react@0.66.0

## 0.65.1

### Patch Changes

- Updated dependencies [ca56c29]
  - @ykurilov/agent-chat-core@0.65.1
  - @ykurilov/agent-chat-attachments@0.65.1
  - @ykurilov/agent-chat-react@0.65.1

## 0.65.0

### Patch Changes

- Updated dependencies [814ee7f]
  - @ykurilov/agent-chat-core@0.65.0
  - @ykurilov/agent-chat-react@0.65.0
  - @ykurilov/agent-chat-attachments@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [99cded9]
  - @ykurilov/agent-chat-core@0.64.0
  - @ykurilov/agent-chat-react@0.64.0
  - @ykurilov/agent-chat-attachments@0.64.0

## 0.63.2

### Patch Changes

- Updated dependencies [c772243]
  - @ykurilov/agent-chat-core@0.63.2
  - @ykurilov/agent-chat-attachments@0.63.2
  - @ykurilov/agent-chat-react@0.63.2

## 0.63.1

### Patch Changes

- Updated dependencies [8bcee93]
  - @ykurilov/agent-chat-react@0.63.1
  - @ykurilov/agent-chat-attachments@0.63.1
  - @ykurilov/agent-chat-core@0.63.1

## 0.63.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.63.0
  - @ykurilov/agent-chat-core@0.63.0
  - @ykurilov/agent-chat-react@0.63.0

## 0.62.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.62.0
  - @ykurilov/agent-chat-core@0.62.0
  - @ykurilov/agent-chat-react@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [ebfbed9]
- Updated dependencies [b3f42a3]
  - @ykurilov/agent-chat-attachments@0.61.0
  - @ykurilov/agent-chat-core@0.61.0
  - @ykurilov/agent-chat-react@0.61.0

## 0.60.0

### Patch Changes

- Updated dependencies [6e8723c]
  - @ykurilov/agent-chat-core@0.60.0
  - @ykurilov/agent-chat-attachments@0.60.0
  - @ykurilov/agent-chat-react@0.60.0

## 0.59.0

### Patch Changes

- Updated dependencies [fc1f387]
  - @ykurilov/agent-chat-core@0.59.0
  - @ykurilov/agent-chat-attachments@0.59.0
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
  - @ykurilov/agent-chat-attachments@0.58.0
  - @ykurilov/agent-chat-react@0.58.0

## 0.57.0

### Patch Changes

- Updated dependencies [ade99cc]
- Updated dependencies [86afa20]
- Updated dependencies [624c10c]
  - @ykurilov/agent-chat-core@0.57.0
  - @ykurilov/agent-chat-attachments@0.57.0
  - @ykurilov/agent-chat-react@0.57.0

## 0.56.0

### Patch Changes

- Updated dependencies [1eadba9]
- Updated dependencies [24c313e]
  - @ykurilov/agent-chat-react@0.56.0
  - @ykurilov/agent-chat-core@0.56.0
  - @ykurilov/agent-chat-attachments@0.56.0

## 0.55.0

### Patch Changes

- Updated dependencies [51f7b38]
- Updated dependencies [cdc7dd7]
  - @ykurilov/agent-chat-core@0.55.0
  - @ykurilov/agent-chat-react@0.55.0
  - @ykurilov/agent-chat-attachments@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [c8fb0dd]
- Updated dependencies [73d3aaa]
- Updated dependencies [fa90219]
  - @ykurilov/agent-chat-react@0.54.0
  - @ykurilov/agent-chat-core@0.54.0
  - @ykurilov/agent-chat-attachments@0.54.0

## 0.53.0

### Patch Changes

- Updated dependencies [b6a7786]
  - @ykurilov/agent-chat-core@0.53.0
  - @ykurilov/agent-chat-react@0.53.0
  - @ykurilov/agent-chat-attachments@0.53.0

## 0.52.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.52.0
  - @ykurilov/agent-chat-core@0.52.0
  - @ykurilov/agent-chat-react@0.52.0

## 0.51.0

### Patch Changes

- Updated dependencies [41b1726]
  - @ykurilov/agent-chat-core@0.51.0
  - @ykurilov/agent-chat-attachments@0.51.0
  - @ykurilov/agent-chat-react@0.51.0

## 0.50.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.50.0
  - @ykurilov/agent-chat-core@0.50.0
  - @ykurilov/agent-chat-react@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [084cef7]
  - @ykurilov/agent-chat-core@0.49.0
  - @ykurilov/agent-chat-react@0.49.0
  - @ykurilov/agent-chat-attachments@0.49.0

## 0.48.0

### Patch Changes

- Updated dependencies [fa10d5a]
  - @ykurilov/agent-chat-core@0.48.0
  - @ykurilov/agent-chat-attachments@0.48.0
  - @ykurilov/agent-chat-react@0.48.0

## 0.47.0

### Patch Changes

- Updated dependencies [5a59c33]
  - @ykurilov/agent-chat-core@0.47.0
  - @ykurilov/agent-chat-attachments@0.47.0
  - @ykurilov/agent-chat-react@0.47.0

## 0.46.2

### Patch Changes

- Updated dependencies [3d0d2f2]
  - @ykurilov/agent-chat-core@0.46.2
  - @ykurilov/agent-chat-attachments@0.46.2
  - @ykurilov/agent-chat-react@0.46.2

## 0.46.1

### Patch Changes

- @ykurilov/agent-chat-attachments@0.46.1
  - @ykurilov/agent-chat-core@0.46.1
  - @ykurilov/agent-chat-react@0.46.1

## 0.46.0

### Patch Changes

- Updated dependencies [56d7528]
- Updated dependencies [a1933fd]
- Updated dependencies [52cc67d]
  - @ykurilov/agent-chat-core@0.46.0
  - @ykurilov/agent-chat-react@0.46.0
  - @ykurilov/agent-chat-attachments@0.46.0

## 0.45.0

### Patch Changes

- Updated dependencies [eb74c58]
- Updated dependencies [ac9aede]
  - @ykurilov/agent-chat-react@0.45.0
  - @ykurilov/agent-chat-attachments@0.45.0
  - @ykurilov/agent-chat-core@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [6a2b5d9]
  - @ykurilov/agent-chat-core@0.44.0
  - @ykurilov/agent-chat-react@0.44.0
  - @ykurilov/agent-chat-attachments@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [763f4c5]
  - @ykurilov/agent-chat-core@0.43.0
  - @ykurilov/agent-chat-attachments@0.43.0
  - @ykurilov/agent-chat-react@0.43.0

## 0.42.0

### Patch Changes

- Updated dependencies [a385276]
  - @ykurilov/agent-chat-core@0.42.0
  - @ykurilov/agent-chat-react@0.42.0
  - @ykurilov/agent-chat-attachments@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [9472fcb]
  - @ykurilov/agent-chat-core@0.41.0
  - @ykurilov/agent-chat-react@0.41.0
  - @ykurilov/agent-chat-attachments@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [0e7aab3]
  - @ykurilov/agent-chat-core@0.40.0
  - @ykurilov/agent-chat-react@0.40.0
  - @ykurilov/agent-chat-attachments@0.40.0

## 0.39.1

### Patch Changes

- Updated dependencies [5c0f3af]
  - @ykurilov/agent-chat-react@0.39.1
  - @ykurilov/agent-chat-attachments@0.39.1
  - @ykurilov/agent-chat-core@0.39.1

## 0.39.0

### Patch Changes

- Updated dependencies [3b90429]
  - @ykurilov/agent-chat-core@0.39.0
  - @ykurilov/agent-chat-react@0.39.0
  - @ykurilov/agent-chat-attachments@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [1cae504]
- Updated dependencies [4065a4a]
  - @ykurilov/agent-chat-core@0.38.0
  - @ykurilov/agent-chat-attachments@0.38.0
  - @ykurilov/agent-chat-react@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [7f49d12]
- Updated dependencies [ea78982]
  - @ykurilov/agent-chat-core@0.37.0
  - @ykurilov/agent-chat-attachments@0.37.0
  - @ykurilov/agent-chat-react@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [3487fb4]
- Updated dependencies [8c43b86]
- Updated dependencies [6f42418]
- Updated dependencies [5f13c74]
  - @ykurilov/agent-chat-core@0.36.0
  - @ykurilov/agent-chat-react@0.36.0
  - @ykurilov/agent-chat-attachments@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6ceee78]
- Updated dependencies [2382026]
  - @ykurilov/agent-chat-react@0.35.0
  - @ykurilov/agent-chat-core@0.35.0
  - @ykurilov/agent-chat-attachments@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [d039ce4]
  - @ykurilov/agent-chat-core@0.34.0
  - @ykurilov/agent-chat-react@0.34.0
  - @ykurilov/agent-chat-attachments@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [4a72339]
  - @ykurilov/agent-chat-core@0.33.0
  - @ykurilov/agent-chat-attachments@0.33.0
  - @ykurilov/agent-chat-react@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [bc78aec]
- Updated dependencies [4087a22]
- Updated dependencies [71c32b7]
- Updated dependencies [cae13bf]
- Updated dependencies [a94bda9]
- Updated dependencies [4e44492]
- Updated dependencies [ac9b7d3]
- Updated dependencies [27f4b1e]
  - @ykurilov/agent-chat-attachments@0.32.0
  - @ykurilov/agent-chat-react@0.32.0
  - @ykurilov/agent-chat-core@0.32.0

## 0.31.2

### Patch Changes

- @ykurilov/agent-chat-attachments@0.31.2
  - @ykurilov/agent-chat-core@0.31.2
  - @ykurilov/agent-chat-react@0.31.2

## 0.31.1

### Patch Changes

- @ykurilov/agent-chat-attachments@0.31.1
  - @ykurilov/agent-chat-core@0.31.1
  - @ykurilov/agent-chat-react@0.31.1

## 0.31.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.31.0
  - @ykurilov/agent-chat-core@0.31.0
  - @ykurilov/agent-chat-react@0.31.0

## 0.30.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.30.0
  - @ykurilov/agent-chat-core@0.30.0
  - @ykurilov/agent-chat-react@0.30.0

## 0.29.0

### Patch Changes

- @ykurilov/agent-chat-attachments@0.29.0
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
  - @ykurilov/agent-chat-attachments@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [d8341b2]
- Updated dependencies [5e4ed28]
- Updated dependencies [e0bb519]
  - @ykurilov/agent-chat-core@0.27.0
  - @ykurilov/agent-chat-react@0.27.0
  - @ykurilov/agent-chat-attachments@0.27.0

## 0.26.2

### Patch Changes

- Updated dependencies [f24858a]
  - @ykurilov/agent-chat-core@0.26.2
  - @ykurilov/agent-chat-attachments@0.26.2
  - @ykurilov/agent-chat-react@0.26.2

## 0.26.1

### Patch Changes

- Updated dependencies [5b52515]
  - @ykurilov/agent-chat-react@0.26.1
  - @ykurilov/agent-chat-attachments@0.26.1
  - @ykurilov/agent-chat-core@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [eb43e47]
  - @ykurilov/agent-chat-core@0.26.0
  - @ykurilov/agent-chat-attachments@0.26.0
  - @ykurilov/agent-chat-react@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [99d426e]
- Updated dependencies [d8201f6]
  - @ykurilov/agent-chat-core@0.25.0
  - @ykurilov/agent-chat-attachments@0.25.0
  - @ykurilov/agent-chat-react@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [9b895cd]
  - @ykurilov/agent-chat-core@0.24.0
  - @ykurilov/agent-chat-react@0.24.0
  - @ykurilov/agent-chat-attachments@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [30fb729]
  - @ykurilov/agent-chat-react@0.23.0
  - @ykurilov/agent-chat-attachments@0.23.0
  - @ykurilov/agent-chat-core@0.23.0

## 0.22.0

### Minor Changes

- e9c768f: Размер 1K, цены GPT Image по замеру Runware, GPT Image 2 без прозрачного фона.
  
  - `size: "1k"` в `createImageGeneration`, `createImageQueue` и в назначении: длинная сторона около 1024 (1:1 — 1024×1024, 16:9 — 1088×608), стороны кратны 16, площадь не меньше 655 360. Без настройки — размер как раньше (1:1 — 816×816). Назначение главнее общей настройки.
  - Цены GPT Image 2, 2.5 Flare и 2.5 Sunburst — по замеру Runware (1024×1024, low: $0.00602, $0.00602, $0.00599). Было 0.02, 0.04 и 0.02. Цена из каталога учитывает размер и качество: medium вчетверо дороже low, high и auto — в 16 раз. По ней бронь в лимитах и расход, если провайдер не прислал цену.
  - GPT Image 2 больше не обещает прозрачный фон: Runware отвечает `invalidOpenAiBackground`. Настройка `transparentBackground: true` с этой моделью — ошибка при создании.
  - Очередь с Runware проверена тестами: ответ сразу, без опроса; прозрачный фон без `removeBackground`; `maxImagesPerTurn`.
  
  ### Как обновить приложение
  
  1. `pnpm up "@ykurilov/agent-chat-*@^0.22.0"`.
  2. Нужна картинка покрупнее — добавить `size: "1k"` рядом с `model` или в назначении.
  3. Если где-то стоит `gpt-image-2` с `transparentBackground: true` — сервер не запустится с ошибкой «модель gpt-image-2 не умеет прозрачный фон». Поменять модель на `gpt-image-2.5-sunburst` (или `gpt-image-2.5-flare`).
  4. Свои тесты, которые сверяли расход GPT Image с 0.02 или 0.04, обновить: без цены от провайдера теперь пишется 0.005 (наименьший размер, low) или 0.007 (1K, low).

### Patch Changes

- @ykurilov/agent-chat-attachments@0.22.0
  - @ykurilov/agent-chat-core@0.22.0
  - @ykurilov/agent-chat-react@0.22.0

## 0.21.0

### Minor Changes

- 7c3bcc4: Картинки в файлы приложения и ход, который не ждёт картинку. Всё новое включается опциями: без них `createImageGeneration` работает как раньше.
  
  - `createImageQueue` — своя очередь картинок для инструментов приложения: заказ отвечает сразу, готовая картинка приходит в `deliver(image, job, ctx)`; `ctx.isCurrent()` и `ctx.signal` — картинка ещё нужна (запись файла делать условной). Задачи лежат в базе (`sqliteImageJobStore` из `@ykurilov/agent-chat-images/sqlite`, `postgresImageJobStore` из `/postgres`), переживают перезапуск сервера, расход пишется ровно один раз. Есть «Повторить» (`retry`), замена прежнего заказа на то же место (`key`), предел за ход, `stop()`.
  - `createImageGeneration`: `deliver` — картинка приложению, а не во вложения; `mode: "background"` — инструмент отвечает сразу (с `jobStore`, `pollIntervalMs`, `attempts`, `onQueued`); `maxImagesPerTurn` — предел картинок за ход; `start()` и `stop()`.
  - Ядро: `agent.tools(model)` получает `model.turnId` — номер хода, один на все попытки и запасного провайдера.
  - Ядро: необязательный `ChatStorage.hasUsageRecord(id)` — есть ли запись расхода (память, SQLite, PostgreSQL). Своё хранилище может его не делать.
  - Хранилища задач картинок: одна открытая задача на место (`ownerId` + `key`) — уникальный индекс; своё хранилище бросает `ImageJobKeyTakenError`.
  - Экспорт `DEFAULT_REMOVE_BACKGROUND_PROMPT` — подсказка разделения фона.
  - Защита денег: срок у каждого обращения к провайдеру, повторное скачивание того же адреса вместо нового заказа, второй шаг не оплачивает первый заново.
  
  Фоновый режим и очередь с базой: при остановке сервера до закрытия базы вызвать `await images.stop()` (или `imageQueue.stop()`).

### Patch Changes

- Updated dependencies [7c3bcc4]
  - @ykurilov/agent-chat-core@0.21.0
  - @ykurilov/agent-chat-attachments@0.21.0
  - @ykurilov/agent-chat-react@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [fd16b01]
- Updated dependencies [fd16b01]
- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-core@0.20.0
  - @ykurilov/agent-chat-attachments@0.20.0
  - @ykurilov/agent-chat-react@0.20.0

## 0.19.0

### Minor Changes

- 427e742: Картинки умеют больше, старые приложения работают как раньше. По умолчанию по-прежнему GPT Image 2 в низком качестве, JPG.
  
  - Второй провайдер — KIE.ai (`KIE_API_KEY`): `z-image` (дешёвая картинка без текста, $0.004), `seedream-5-flash-kie` (держит надписи)
    и `seedream-5-flash-layers` (разделение на слои, для предмета без фона). Не успела к сроку — опрос продолжается в фоне,
    повтор того же вызова не создаёт новую платную задачу, о поздней картинке приложение узнаёт в `onLateImage`.
  - `purposes`: приложение задаёт назначения (имя → модель и описание), агент выбирает нужное параметром `purpose`.
    Описание инструмента постоянное. `removeBackground` — сначала картинка, потом предмет без фона.
  - `quality` (`low`, `medium`, `high`, `auto`) и `transparentBackground` для GPT Image 2 и 2.5 у Runware.
  - `output: { format, maxSide }` — формат файла и предел большей стороны; прозрачность сохраняется.
  
  Подробно — `docs/images.md`, разделы «Назначения» и «KIE.ai: очередь, повтор и поздний результат».
  
  ### Как обновить приложение
  
  Ничего менять не нужно. Если в приложении есть тест, который ждёт в `standardImageCatalog` ровно пять моделей
  или одного провайдера, — теперь их восемь и два (`runware`, `kie`), модели Runware идут первыми, как раньше.
- aa0fd51: Расход картинок будит пороги лимитов: после каждой записи расхода зовётся `limits.afterSpending` (если он есть), так что
  события 80% и 100% (`onThreshold` в `@ykurilov/agent-chat-limits`) приходят и от картинок. Зовётся фоном, сбой уходит
  в `logError`, картинка не теряется.
  
  Обновление ничего не требует: `spending.limits` из `createSpendingLimits` уже содержит `afterSpending`.

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
  - @ykurilov/agent-chat-attachments@0.19.0

## 0.18.6

### Patch Changes

- @ykurilov/agent-chat-attachments@0.18.6
  - @ykurilov/agent-chat-core@0.18.6
  - @ykurilov/agent-chat-react@0.18.6

## 0.18.5

### Patch Changes

- Updated dependencies [56b9ab6]
  - @ykurilov/agent-chat-react@0.18.5
  - @ykurilov/agent-chat-attachments@0.18.5
  - @ykurilov/agent-chat-core@0.18.5

## 0.18.4

### Patch Changes

- @ykurilov/agent-chat-attachments@0.18.4
  - @ykurilov/agent-chat-core@0.18.4
  - @ykurilov/agent-chat-react@0.18.4

## 0.18.3

### Patch Changes

- Updated dependencies [ce3c26f]
  - @ykurilov/agent-chat-react@0.18.3
  - @ykurilov/agent-chat-attachments@0.18.3
  - @ykurilov/agent-chat-core@0.18.3

## 0.18.2

### Patch Changes

- Updated dependencies [7e7e966]
  - @ykurilov/agent-chat-react@0.18.2
  - @ykurilov/agent-chat-attachments@0.18.2
  - @ykurilov/agent-chat-core@0.18.2

## 0.18.1

### Patch Changes

- Updated dependencies [179ad9d]
  - @ykurilov/agent-chat-react@0.18.1
  - @ykurilov/agent-chat-attachments@0.18.1
  - @ykurilov/agent-chat-core@0.18.1

## 0.18.0

### Patch Changes

- Updated dependencies [43d7ebe]
  - @ykurilov/agent-chat-core@0.18.0
  - @ykurilov/agent-chat-react@0.18.0
  - @ykurilov/agent-chat-attachments@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [e5d0860]
  - @ykurilov/agent-chat-react@0.17.0
  - @ykurilov/agent-chat-attachments@0.17.0
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
  - @ykurilov/agent-chat-attachments@0.16.0
