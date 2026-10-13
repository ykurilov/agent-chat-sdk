# @ykurilov/agent-chat-core

Ядро чата с агентом. Работает только на сервере: ходит к провайдерам моделей, ведёт ход
агента с инструментами, хранит переписку, останавливает и повторяет ответы.

Обычно напрямую нужны только каталог моделей и, если нужна своя база, договор хранилища.
HTTP-адреса даёт `@ykurilov/agent-chat-server`.

```ts
import { extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
```

- `standardCatalog` — стандартные модели и провайдеры. Модели: `deepseek-4.1-flash`, `glm-5.3-flash`,
  `gpt-6-luna`, `gemini-3.8-flash`, `claude-haiku-5.5` (через OpenRouter, кэш на час). Провайдеры и ключи: `deepseek` (`DEEPSEEK_API_KEY`), `fireworks`
  (`FIREWORKS_API_KEY`), `together` (`TOGETHER_API_KEY`), `openrouter` (`OPENROUTER_API_KEY`, сортировка по скорости).
  Кто какую модель отдаёт — в [docs/getting-started.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/getting-started.md), шаг 3.
- `extendCatalog(base, { addModels, removeModels, addProviders, removeProviders, pinModelVersions, connectProviders })` — свой набор
  моделей: убрать, добавить, закрепить версию модели у провайдера. Порядок: убрать → добавить → закрепить.
- Провайдеры через прокси (сервер в России): `connectProviders: { openrouter: { baseURL, headers } }` в `extendCatalog`
  или `createOpenRouterProvider`, `createDeepSeekProvider`, `createFireworksProvider`, `createTogetherProvider` с
  `{ baseURL, headers }`. Через прокси идёт всё: ход, память, сжатие, сверка расхода OpenRouter. Значения заголовков
  вычищаются из ошибок и журналов (`environmentSecrets`); короче 8 знаков и `Authorization` — ошибка при сборке.
  Прокси должен пробрасывать заголовок ответа `x-generation-id`, иначе расход OpenRouter останется оценкой
  (`proxy.example.com` его пробрасывает).
- Маршруты OpenRouter: `createOpenRouterProvider({ id: "or-deepseek", only: ["deepseek"], allowFallbacks: false })` —
  отдельный провайдер каталога с теми же моделями, что `openrouter` (ещё `order`, `requireParameters`, `displayName`).
- Часовой кэш Anthropic через OpenRouter: срок `ttl: "1h"` на всех метках кэша запроса (инструкция, последнее сообщение,
  конец шага). Кто главнее: `createOpenRouterProvider({ cacheTtlByModel: { "claude-haiku-5.5": "5m" } })` → `cacheTtl` провайдера →
  `cacheTtl` профиля модели (у `claude-haiku-5.5` — `"1h"`) → 5 минут (метки без срока, запрос прежний).
  Запись в часовой кэш дороже (у Anthropic 2× цены входа вместо 1.25×), чтение то же; выгодно, когда между ходами больше
  5 минут. Цена записи по сроку: `cacheWritePerMillion` (5 минут) и `cacheWrite1hPerMillion` (час) в `pricing` профиля.

  ```ts
  const catalog = extendCatalog(standardCatalog, {
    connectProviders: {
      openrouter: {
        baseURL: "https://proxy.example.com/openrouter/api/v1",
        headers: { "X-Proxy-Token": process.env.PROXY_TOKEN! },
      },
    },
  });
  ```
- Профиль модели описывает уровни рассуждений (`reasoning.levels`, `defaultLevel`, `encrypted`); провайдер переводит
  уровень в запрос (`reasoningRequest`). Выбор модели и уровня хранится в чате (`Chat.reasoning`); `defaultChoice`
  задаёт выбор для нового чата человека, который ещё ничего не выбирал; дальше новый чат берёт последний выбор человека
  (хранилище: необязательные `getUserModelChoice` и `saveUserModelChoice`, без них — всегда `defaultChoice`). Смена модели посреди чата: рассуждения прежней модели в запрос не уходят.
- `agent.tools` — набор инструментов или функция `(model) => ToolSet` от выбранной модели. Функция зовётся раз на ход и получает `model.ownerId` (кто спрашивает), `model.chatId` и `model.place` — где человек в приложении (`{ description, data? }` или `null`, приходит с запросом; в историю не пишется). Модель видит описание места хвостом последнего входа хода (сообщения человека; после ответа на виджет или подтверждения — заметкой сразу за этим ответом), кэш не страдает; предел описания — `agent.placeMaxLength` (1000 по умолчанию).
- `notifyDataChanged({ tag, details? })` в `model` функции `agent.tools`: инструмент сообщает странице, что изменил данные (метка 1–100 знаков, `details` — JSON до 4 КБ; неверная форма — `TypeError`). Сообщение уходит той вкладке, где идёт ответ, сразу; в историю не пишется. Тесты, собирающие `AgentToolsModel` вручную, добавляют это поле.
- `agent.browserTools` — описания инструментов, которые исполняет страница человека (`tool({ description, inputSchema })` без `execute`; имя не должно совпадать с инструментом приложения или памяти). `agent.browserToolTimeoutMs` — срок ответа вкладки: 30 с по умолчанию, от 1 с до 2³¹−1 мс. Результат до 16 КБ, ошибка обрезается до 1000 знаков, пустой результат — «готово». Служба чата получила метод `answerBrowserCall`: свои реализации `ChatService` добавляют его; повторный, чужой и поздний ответ — `BrowserCallNotPendingError` (вид `not_pending`). Ожидание живёт в памяти процесса: работает на одном сервере.
- Инструмент с `needsApproval: true` (или функцией от входных данных) не выполняется без решения человека: ход останавливается со статусом
  ответа `awaiting_approval`, после решения продолжается в том же сообщении. `answerApproval` сервиса чата (`createChatService`) принимает решение; «всегда в этом чате» помнится по истории чата и предлагается только для `needsApproval: true` (у функции кнопки нет). Хранилище обязано уметь `getMessage`. Сбой или «Стоп» после «Разрешить» закрывают вызов как прервавшийся; ответ на карточку проверяет лимит расходов.
- `ChatStorage` — интерфейс хранилища; `createInMemoryChatStorage()` — хранилище в памяти
  для тестов приложений (отдельного пакета нет: оно часть ядра, ничего лишнего не тянет).
  Настоящие хранилища — пакеты `@ykurilov/agent-chat-storage-sqlite` и `@ykurilov/agent-chat-storage-postgres`.
- Ветки ответов: `ChatStorage` дописывает выбор варианта (`insertBranchSelection`, `listBranchSelections`); `createChatService` умеет
  `selectBranch`, `regenerate`, `editMessage`, `getBranchForks`. Сообщения, сжатие и поиск работают по текущей ветке (`loadCurrentBranch`).
- Поправка на лету: `service.steer(userId, chatId, message, { page? })` → `{ status: "queued" | "started", messageId }`. Сообщение пишется сразу
  (отметка `data-agent-steer`, модели не уходит), агент берёт его на ближайшей границе шага: ответ закрывается, ход продолжается новым
  ответом на поправки (поток — `subscribe`). Поправки подряд уходят модели одним сообщением человека. Хода нет — обычный ход (`started`);
  ход на другой копии — `ChatBusyError`. Проверки — как у `sendMessage`. Ждущие поправки — `pendingMessages` в истории; `isCorrection`,
  `STEER_PART_TYPE` — для своей ленты.
- `@ykurilov/agent-chat-core/storage-contract` — общие тесты `describeChatStorageContract`
  для своей реализации хранилища (нужен `vitest`). Их проходят память, SQLite и PostgreSQL.
- Список чатов: `chat.listChats(userId)`, `chat.renameChat(userId, chatId, title)`, `chat.deleteChat(userId, chatId)`. Хранилище для этого реализует `listChats`, `renameChat`, `deleteChat`. Название чата берётся из первого сообщения (`deriveChatTitle`, до 60 знаков), вручную — до 100 (`normalizeChatTitle`, `InvalidChatTitleError`). Удаление настоящее: идущий ответ и сжатие останавливаются, затем уходят файлы вложений, сообщения, записи сжатия и чат.

## Агент внутри продукта

Всё по желанию; без этих настроек запрос к модели не меняется. Подробно и с примером урока — [docs/in-product-agent.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/in-product-agent.md).

- `beforeTurn({ userId, chat, action, text?, messageId? })` — приложение отказывает в ходе: `{ code, message }` → `TurnRefusedError`, ничего не записано. У `regenerate`, `edit` и `retry` ещё `abandonedAnswerIds` (ответы агента, которые уйдут с ветки) и `previousAnswerId` (заменяемый ответ): откатить побочные дела брошенных ответов; ход не начался — `turnNotStarted` получает те же поля. Вручную — `service.assertTurnAllowed(userId, chatId, action, text?)`.
- `turnNotStarted({ userId, chat, action, messageId?, text?, reason })` — ход не начался, хотя `beforeTurn` пропустил (`busy`, `too_many_turns`, `spending_limit`, `duplicate_message`, `invalid`, `chat_closed`, `no_turn`, `error`): снять резерв приложения. Каждый пропуск закрывается ровно одним — `afterTurn` или этим хуком.
- `afterTurn(turn)` — итог хода (`TurnResult`) после каждого хода, с повторами (`afterTurnAttempts`, 3) и сроком (`afterTurnTimeoutMs`, 30 000); переживает перезапуск. Пишите идемпотентно по `messageId` + `status`. Вернуть `{ events }` — события в конце ответа. `stopReason` (`user` / `timeout` / `shutdown`) — кто остановил ход; `lengthCut: true` — ответ упёрся в `agent.maxOutputTokens`; `stepLimit: true` — ход упёрся в `agent.maxSteps` (статус `complete`, в журнале строка `[предел шагов]`).
- `agent.turnTimeoutMs` — общий срок хода (как «Стоп» по сроку), `agent.maxOutputTokens` — предел токенов ответа в каждом запросе; оба — число или `{ default, byModel }`.
- `service.flush({ waitForAnswersMs })` — штатная остановка: ждёт идущие ответы до срока, остальные закрывает как «Стоп», ждёт `afterTurn`.
- События приложения `{ type, data? }`: из инструмента `model.emitAppEvent(event)`, вне хода `service.publishAppEvent({ ownerId, chatId, event })`. Модели не уходят.
- Состояние чата на ветке: инструмент пишет `model.state.set(path, value)` / `unset(path)`, читает `get(path?)` (путь через точку; ключи без точек, массивы целиком; значения — простой JSON). Запись ложится частью ответа `data-app-state`, модели не уходит. Состояние — свёртка записей текущей ветки из хранилища: правка, «Переделать» и выбор ветки меняют его сами, сжатие и «Повторить» не теряют. `service.getChatState(userId, chatId)` → `{ values, atMessageId }` (читает только связи и записи состояния; своему хранилищу — необязательный `listMessagePartsOfTypes`). `onStateChanged({ ownerId, chatId, reason, state, previousState, atMessageId })` — состояние сменилось после хода или смены ветки (`reason`: `turn`, `editMessage`, `regenerate`, `retry`, `selectBranch`, `editAnswer`, `widgetAnswer` — записи `checkAnswer` виджета), с повторами (`onStateChangedAttempts`, 3) и сроком (`onStateChangedTimeoutMs`, 30 000), по очереди внутри чата, события `state-changed` и `state-changed-failed`. Доставка — только пока сервер жив: сверка копии — по `getChatState`. Ответ пишется в базу сразу после итога каждого инструмента (промежуточные результаты — окном 500 мс). Запись до 16 КБ, состояние до 256 КБ (`AppStateTooLargeError`); после конца хода запись не принимается; верхние ключи на `$` — служебные ключи SDK. `privateStateKeys` — закрытые верхние ключи приложения: не уходят в историю, поток и `state-changed` наблюдения; `getChatState`, `onStateChanged`, события и модель их видят. Закрытое значение не возвращайте в выходе инструмента и тексте ответа. Для своих частей: `foldAppState`, `loadBranchAppState`, `createAppStateWriter`, `appStatePart`.
- Снимок перед каждым шагом: `agent.stepContext: ({ state, stepNumber, chat, subject, … }) => string | null` — текст ложится сообщением человека в самый конец запроса шага, после результатов инструментов, в историю не пишется. Снимок на шаге один, всё до него от шага к шагу те же байты (кэш модели). `null` — шаг без снимка, бросок — без снимка и строка в журнал. Функция видит те же `channel`, `audience`, `staff`, что инструменты (в группе личного не показывайте), данные чата — копиями. Срок `agent.stepContextTimeoutMs` (по умолчанию 5 с): не ответила — шаг без снимка, `abortSignal` отменён. Типы `StepContext`, `StepContextInput`.
- Застывающий контекст: память, сегодняшняя дата, место на экране и блоки приложения вписываются в вопрос человека один раз за ход и дальше не меняются ни на байт. Следующий ход побайтно начинается с последнего шага прошлого (с рассуждениями и инструментами), поэтому всё прошлое читается из кэша модели. В новый вопрос идут только изменившиеся блоки и строка `[Больше не действует: «ключ»]` про пропавшие. Источник может вернуть `{ key, hidden: true }` — блок есть, но не показан ради места: вместо «больше не действует» модель, видевшая его, получит `[Не показано ради места, но по-прежнему действует: «ключ»]`. Набор хода хранится служебной частью ответа `data-frozen-context` (`FROZEN_CONTEXT_PART_TYPE`): в поток, историю, `afterTurn` и поиск по истории она не уходит. Продолжение после подтверждения, автопродолжение, запасной провайдер и «Повторить» берут блоки из ответа и источники заново не опрашивают. Память строже остальных блоков: читается один раз на чат — в первом ходе, после сжатия истории, при смене начала истории (правка первого сообщения, «Переделать» первого ответа), в первом личном ходе после группового и после сбоя чтения — и в идущем чате не перечитывается и не досылается (ни изменения, ни новые записи, ни «Больше не действует»); `snapshot()` и `blocks()` в остальных ходах не зовутся. Своя долгая память может отдавать блоки по записям: `LongTermMemory.blocks?({ userId, chatId })`; без него — один блок из `snapshot()`.
- Блоки приложения в вопросе хода: `agent.contextBlocks: ({ chatId, ownerId, chat, state, subject, channel, audience, … }) => [{ key, text, private? }] | null` — список скиллов, роль, правила. Зовётся один раз в начале хода; текст вписывается в вопрос после памяти и даты и дальше не меняется ни на байт (кэш модели), ядро его не оборачивает. На следующих ходах в вопрос идут только изменённые блоки целиком и строка `[Больше не действует: «ключ»]` про убранные. Ключи `memory`, `memory:*`, `today`, `screen_place` заняты ядром: такой блок отбрасывается со строкой в журнал. `private: true` — в групповом ходе блок не показывается. Срок `agent.contextBlocksTimeoutMs` (по умолчанию 5 с; 0 или `Infinity` — без срока, иначе от 1000): не ответила или бросила — блоки приложения берутся из прошлого ответа, в журнал строка `[блоки контекста] …`, `abortSignal` отменён; «Стоп» — без строки. Блоки хранятся служебной частью ответа: в потоке, истории, `afterTurn` и поиске по истории её нет. Типы `ContextBlock`, `ContextBlocksInput`, `ContextBlocksSource`, `HiddenContextBlock`, `ContextBlockEntry`.
- Конец хода сразу после инструмента: `execute` возвращает `endTurn(output, { text? })` — модель следующего шага не делает, готовый `text` идёт в ответ обычной текстовой частью без запроса к провайдеру и без расхода; `output` модель и запись видят как обычно. Тип `EndTurnOptions`.
- Данные чата без записи: `service.getChatData(userId, chatId)` — копия, проверки владения как у `updateChatData`.
- Проверка ответа виджета на сервере: `checkAnswer(answer, ctx)` у своего виджета и общая `agent.widgets.checkAnswer(call, answer, ctx)` (для всех виджетов без своей). Зовётся после схемы под замком чата. Исход: `undefined` — принять, `{ answer }` — принять с заменой, `{ refuse: "текст" }` — отказать (`WidgetAnswerRefusedError`, сервер — 409 `widget_answer_refused`, виджет остаётся открытым). `ctx` — `ownerId`, `chatId`, `messageId`, `toolName`, `toolCallId`, `input`, `subject?`, `chatData?`, `state` (записи ложатся в ответ вместе с результатом виджета, хук `onStateChanged` — с причиной `widgetAnswer`), `emitAppEvent` (событие приложения вместе с ответом виджета), `signal` (отмена по сроку или «Стопу»: приложение слушает его само). Срок — `agent.widgets.checkAnswerTimeoutMs` (5 000 мс, заметно меньше `requestTimeoutMs` страницы). Исключение — 500, ничего не записано, в журнале только имя ошибки; срок вышел — `WidgetAnswerCheckTimeoutError`, сервер — 504 `widget_check_timeout`. Чат закрыли во время проверки — `ChatClosedError`, ответ не пишется.
- Набор виджетов по чату: `agent.widgets.enabledFor({ chat: { id, ownerId, data?, subject? } })` → имена включённых. Выключенных модель не видит (нет в инструментах запроса), их прошлые вызовы идут модели текстом. Синхронная, те же данные — тот же набор; смена набора сбрасывает кэш модели. Неизвестное имя — строка в журнал, исключение — ошибка хода. Подробно — [docs/widgets.md](../../docs/widgets.md).
- Права человека в чате: `chatCapabilities({ userId, chat })` возвращает запреты (`edit`, `regenerate`, `retry`, `branches`, `modelChoice`, `answerEditing`, `chatList`, `compact`, `attachments`, `voice`, `reasoning`, `toolDetails`, `steer`, `modelDetails`; по умолчанию всё `true`; `modelDetails: false` выключает и `modelChoice`). Неизвестное право или не булево значение — `TypeError`. Запрещённое действие — `ActionForbiddenError(action)` до любой записи и до `beforeTurn`. За один вызов службы права спрашиваются не больше раза. История несёт `capabilities`. Вручную — `service.assertCapability(userId, chatId, capability)`.
- Скрытие частей ответа: `reasoning: false` — мысли модели, `toolDetails: false` — служебные инструменты не уходят в историю, поток и повтор кусков после переподключения; хранилище, модель и `afterTurn` получают всё. Виджеты, браузерные инструменты, вызовы с запросом подтверждения и инструменты с `metadata: { showOnScreen: true }` в описании видны всегда. `modelDetails: false` убирает у чата истории `ownerId`, `modelId`, `providerId`, `reasoning`, у сообщений — `metadata.modelId`, `providerId`, `usage`, у частей и кусков — `providerMetadata`/`callProviderMetadata`/`resultProviderMetadata`, у `data-step-reset` — провайдера; отметки сжатия идут без текста сводки (`summary: ""`, `summaryTokens: 0`) в истории и `getCompactions`. Меню моделей — опция `modelMenu({ userId })`: `false` — `getModelMenu(userId)` бросает `ActionForbiddenError("modelDetails")`. История несёт `modelAcceptsImages` (видит ли модель чата картинки). Права — на того, кто открыл поток.
- Закрытый чат: `service.closeChat({ ownerId, chatId, code, message })` и `reopenChat({ ownerId, chatId })` (события `chat-closed`, `chat-reopened`), из инструмента — `model.closeChat({ code, message })`. Закрытие — запись `$closed` на ветке: из инструмента — в ответе сразу при вызове, из кода — служебной записью в конце ветки (идёт ход — после него). Правка, «Переделать», выбор ветки и правка ответа до точки закрытия открывают чат; закрыть навсегда — правами (`chatCapabilities` видит `chat.closed`). Закрытие побеждает паузу: ждущие подтверждения и виджеты закрываются отказом, как при «Стопе». В закрытом чате отправка, «Повторить», подтверждения и виджеты — `ChatClosedError`; служебные сообщения пишутся без хода. `listChats` отдаёт `closed` — копию закрытия текущей ветки (`setChatClosed`); права и история берут закрытие с ветки, не записавшуюся копию дописывает следующее открытие истории. Закрытие чатов 0.27 переносится в запись лениво, при первой правке или смене ветки.
- `beforeCreateChat({ userId, origin? })` — можно ли человеку завести новый чат (`createChat`): `{ code, message }` → `ChatCreationRefusedError`. Чаты объектов и импорт хук не спрашивают. У чата `closed?: { code, message }`, хранилище — необязательный `setChatClosed(chatId, closed | null)`.
- Чат объекта: `service.openSubjectChat({ ownerId, key, data?, title?, greeting? })` → `{ chat, created }`, один чат на ключ у человека. Инструменты получают `model.subject`, итог хода — `turn.subject`. `listChats(userId, { subjects })` — по умолчанию без чатов объектов.
- Приветствие: `createChat(userId, { greeting: { text } })` — первое сообщение от агента без вызова модели.
- Импорт: `service.importChat({ ownerId, chat, messages })` → `{ chatId }`; без хода, памяти, расхода и лимитов. `chat.state` и `chat.closed` переносят состояние чата и закрытие: `getChatState` видит их сразу.
- `staffOfChat` и `model.staff` — для песочницы: при `model.staff` инструменты не пишут в данные `ownerId`.
- Своё хранилище: `findChatBySubject`, `importChat`, `setAfterTurnState`, `listPendingAfterTurn` — только для включённых возможностей; общие тесты с флагами `subjectChats`, `importChat`, `afterTurnState`.

## Надёжность хода

Всё это работает само; настройки — в `agent` у `createChatService` (`createChatHandler`). Полное описание — в
[docs/getting-started.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/getting-started.md), раздел «Надёжность хода».

- Временные ошибки провайдера повторяются тихо; перегрузка или лимит до начала ответа — один переход к запасному провайдеру той же модели (`providerFallback`). `providerFallback.onSilence: "restart-step-on-next"` — модель замолчала посреди ответа: шаг стирается (`data-step-reset`, `withoutResetSteps`) и начинается заново у следующего провайдера.
- «Повторить» после сбоя продолжает оборванный ход с выполненных инструментов, а не начинает заново; обрыв посреди ответа дописывается сам (до двух раз); переполнение окна модели — сжатие и продолжение, ошибка `context_overflow` только если не помогло.
- Пределы: `toolTimeoutMs` (120 с на серверный инструмент), `modelSilenceTimeout` (90 с до первого куска, 120 с между кусками; свой срок провайдера — поле `modelSilenceTimeout` у фабрик `create…Provider`, в том числе для запасного), `toolResultMaxLength` (50 000 знаков). `sequentialTools` пускает инструменты с последствиями по одному, очередь одна на чат.
- Расход не теряется: оборванные ответы пишутся оценкой (`estimated`), у OpenRouter оценка потом сверяется с настоящей ценой. Дата в запросе — по поясу человека (`timeZone`), без него — `agent.timeZone` или пояс лимитов (`limits.timeZone`), без них — сервера.
- Журнал промахов кэша (`cacheMissLog: false` выключает), заголовок `x-session-id` у OpenRouter, чистка секретов из ошибок инструментов (`scrubSecrets`).
- Защита: запись с чужой страницы — 403 (`allowedOrigins`, в том числе шаблон `https://*.example.com`), не больше трёх одновременных ответов на человека (`maxConcurrentTurnsPerUser`).

Своё хранилище для нескольких копий сервера: поле записи `alive`, `markAnswerAlive(messageId)` и `listSilentAnswerIds({ silentForMs, chatId? })`; `sumUsage` учитывает фильтры `messageId` и `source`. Общие тесты `describeChatStorageContract` всё это проверяют. Вид ошибки `context_overflow` добавьте в свой `switch` и словарь надписей.

Ключи провайдеров читаются из окружения сервера. Версия `ai` закреплена: `7.0.122`.

Подключение целиком: [docs/getting-started.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/getting-started.md).

Журнал изменений и что делать при обновлении: [CHANGELOG.md](./CHANGELOG.md). Все пакеты SDK выходят вместе и с одной версией; обновление — `pnpm update "@ykurilov/agent-chat-*" --latest`.

Расход и лимиты: ядро пишет токены и стоимость в долларах (`costUsd`, по ценам модели на момент хода) каждого ответа и фонового сжатия в журнал расхода
(`insertUsageRecord`, `sumUsage`), цены лежат в профиле модели (`pricing`), а `createChatService({ limits })` проверяет лимит до хода.
Лимиты и суммы считает `@ykurilov/agent-chat-limits`. Ручное `compactNow` лимит не проверяет.
