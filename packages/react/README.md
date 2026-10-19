# @ykurilov/agent-chat-react

Поведение чата с агентом для React 19, без внешнего вида. Всё видимое рисует скин —
объект из десяти компонентов. Готовый скин Тандема — пакет `@ykurilov/agent-chat-skin-tandem`.

```tsx
import { AgentChat, ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";

<ChatLabelsProvider labels={{ ...russianLabels, retry: "Ещё раз" }}>
  <AgentChat api="/api/chat" chatId={chatId} skin={{ ...tandemSkin, ToolCallRow: MyToolCallRow }} />
</ChatLabelsProvider>;
```

- `AgentChat` — лента, поле ввода, остановка, «повторить», переподключение к идущему ответу, переключатель вариантов «‹ 2/3 ›»,
  «Переделать ответ» и правка отправленного сообщения (вид рисует скин: `BranchSwitcher`, `MessageEditor`).
- `skin` — компоненты по договору `ChatSkin`; любой можно заменить своим.
- `liveness` — сроки живой связи (см. ниже); обычно не нужен.
- Надписи — в словаре: `russianLabels`, `ChatLabelsProvider`, `useChatLabels()`.
- Пока модель думает, надпись живая: фраза из `labels.thinkingPhrases` сменяется каждые 3–4 с, рядом время (`labels.thinkingElapsed`).
  Свой скин берёт их из `useThinkingStatus()`; диктору — постоянная `reasoningRunning`, меняющиеся фразы ему скрывать.
- Выбор модели: `AgentChat` сам грузит список (`GET …/models`) и передаёт скину `Composer` свойство `modelChoice`
  (меню провайдеров и моделей, уровни рассуждений). Сохраняет выбор `PUT …/:id/model`. Отдельно — хук `useModelChoice`.
- `voice` — голосовой ввод из `@ykurilov/agent-chat-voice`; без него кнопки микрофона нет. Скину `Composer` уходит `voice`
  (`VoiceInputView`), слова диктовки дописываются в поле, ручная правка остаётся.
- `spendingLimits` — на сервере включены лимиты расходов (`@ykurilov/agent-chat-limits`): чат читает `GET …/spending`, показывает
  скину `SpendingNotice` («Использовано 80% лимита на месяц», «Лимит на месяц исчерпан, обновится 1 ноября») и при исчерпании
  останавливает отправку (`Composer.sendingBlocked`). Отказ 429 переподключений не запускает: текст возвращается в поле (при правке редактор остаётся открытым, надпись — `editErrors.spendingLimit`).
  Хук `useAgentChat({ spendingLimits: true })` отдаёт `spending`.
- Подтверждение действий: карточка запроса приходит в ленту сама; скину `ToolCallRow` уходят `title` и `approval` (`ToolApprovalView`), кнопки —
  `approval.onDecide("allow" | "deny" | "always")`; «Всегда» рисовать только при `approval.canAlways`, причину отказа брать из `approval.failureText`. Новое сообщение вместо ответа считается отказом (договор скина версии 9).
- Ответ, который не дошёл до человека (сервер пометил `markUndelivered`), приходит скину с `undelivered: true`: серая
  отметка `labels.answerUndelivered` («Не доставлено»). Договор скина версии 24, скин версии 23 работает без правок —
  [docs/skin-v24.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/skin-v24.md).
- Реплика живого сотрудника (сервер: `appendStaffMessage` или `flow.noteStaffReply`) приходит скину в `StaffMessage`
  (`text`, `staffName`) — не пузырём человека. Договор скина версии 25; скин версии 24 работает без правок: реплика
  показывается ответом агента с подписью `labels.notices.staffSaid` («Сотрудник Ольга») —
  [docs/skin-v25.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/skin-v25.md).
- Картинка библиотеки (`show_image`, пакет `@ykurilov/agent-chat-image-library`) приходит в `GeneratedImages` с
  необязательными `wide` (по ширине ответа со своей пропорцией) и `caption` (подпись под картинкой). Договор скина
  версии 26; скин версии 25 работает без правок: плитка ближайшей обычной пропорции без подписи —
  [docs/skin-v26.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/skin-v26.md).
- Служебные пометки приложения (`kind: "app"`) — серой строкой перед ответом агента: «Агент написал первым — человек
  молчал 1 ч 7 мин». Нужны право чата `appNotices` на сервере (по умолчанию выключено), `noticeLines` у `AgentChat`
  (имя пометки → строка; для сценариев — `flowNoticeLines()`) и `ServiceLine` у скина. Договор скина версии 27; скин
  версии 26 работает без правок: пометок не видно —
  [docs/skin-v27.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/skin-v27.md).
- `ChatWorkspace` — список чатов и открытый чат вместе: создать, переименовать, удалить (нужен `chatList: true` на сервере). Хук — `useChatList`. Скину дополнительно нужны `ChatWorkspace` и `ChatList` (`ChatListSkin`, договор версии 7).
- `AgentMemory` — экран долгой памяти агента: записи по разделам, добавить, изменить, удалить, «Стереть всю память» (нужна опция `memory` на сервере, пакет `@ykurilov/agent-chat-memory`). `api` — `createMemoryApi({ api: "/api/chat" })`, создавать один раз; `skin` — `MemorySkin` (`tandemMemorySkin`). Хук — `useMemoryNotes`. Без памяти на сервере экран пишет, что память не включена. Договор скина версии 11 — отдельный `MemorySkin`, `ChatSkin` не менялся ([contracts/memory.md](../../docs/contracts/long-term-memory/memory.md)).
- Панель агента: вход `@ykurilov/agent-chat-react/panel`; основной вход его не подтягивает. `AgentPanelProvider` ставится в корневой макет выше страниц (`api`, `userKey`, `browserTools`, `mode` — `overlay` или `push`, `width`, `onDataChanged`, `fetch` — свой `fetch` только для списка чатов), `AgentPanel` рисует кнопку, рамку и чат через скин. Хуки: `useAgentPanel` (`open`, `openChat`, `openNewChat({ draft })`, `pageInset` — отступ страницы в режиме `push`, на экране ≤ 640 px он 0, `busy`), `useAgentPlace({ description, data? })` (где человек; модель видит только описание, `data` — только инструменты), `useAgentDataChanges(tag, handler)` (страница узнаёт, что инструмент изменил данные). Браузерные инструменты — функции в `browserTools` с теми же именами, что описания на сервере (`BrowserToolImplementations`); нет функции — модель получает «Инструмент недоступен на этой странице» (надпись `agentPanelToolUnavailable`). Подробно — [docs/getting-started.md](../../docs/getting-started.md#панель-агента-в-приложении-по-желанию). Общие части: `AgentAppBridge` (связь чата с приложением; `appBridge` в `AgentChat`, `useAgentChat`, `ChatWorkspace`), `initialDraft` (текст в поле ввода при открытии чата), `rememberKey` в `useChatList` (свой ключ запомненного чата). Договор скина версии 12 — отдельный `AgentPanelSkin` (`AgentPanelLauncher`, `AgentPanel`), надписи `agentPanel…` в словаре; `ChatSkin`, `ChatListSkin` и `MemorySkin` не менялись ([contracts/skin.md](../../docs/contracts/agent-panel/skin.md)).
- `messageActions` — свои кнопки под ответами агента (`AgentChat`, `ChatWorkspace`, `AgentPanel`): `{ id, label, icon?, visible?, onRun }`.
  Иконка — готовый элемент приложения (`<Heart />`), скин кладёт её в кнопку как есть. `visible({ message, status, last })` — показывать
  ли у этого ответа (нет — у каждого законченного). `onRun({ chatId, messageId, message, text })`: пока обещание не выполнено, кнопка
  «занята» и второй раз не жмётся; ошибка — в консоль, не в чат. Пока ответ пишется, кнопок у него нет. Массив держите постоянным
  (вне компонента или в `useMemo`), иначе лента перерисовывает все ответы. Скину `AgentMessage` уходит `actions` (`MessageActionView[]`,
  договор версии 17; скин версии 16 их просто не рисует).

  ```tsx
  const actions: MessageAction[] = [
    { id: "like", label: "Нравится", icon: <Heart />, visible: ({ status }) => status === "complete", onRun: ({ messageId }) => api.like(messageId) },
  ];
  <AgentChat api="/api/chat" chatId={chatId} skin={tandemSkin} messageActions={actions} />;
  ```
- Поправка на лету (включена у скина с `steering: true`, у Тандема — да): пока агент отвечает, поле свободно, поправка встаёт в ленту с пометкой
  «Агент учтёт на следующем шаге» (`steeringPending` в словаре) и уходит на `POST …/steer`. `steering={false}` — выключить. У `useAgentChat` — опция
  `steering: true` (по умолчанию выключено), `canSteer` и `corrections` (ждущие поправки, рисовать после `messages`); `submit()` во время ответа шлёт
  поправку. Скину — `ChatSkin.steering`, `Composer.canSteer` и `UserMessage.pending` (договор v21, [docs/skin-v21.md](../../docs/skin-v21.md)).
- `liveDemos` — живые демонстрации: блок ` ```html-demo ` в ответе запускается в изолированной рамке во всю ширину ответа (на сервере —
  `agent.liveDemos: true`). Скину — `AgentText.renderDemo` и `ChatSkin.demoColors` (договор v22, [docs/live-demos.md](../../docs/live-demos.md)).
- Английский интерфейс: `<ChatLabelsProvider labels={englishLabels}>` — полный словарь (см. docs/getting-started.md, «Надписи»).
- `onTurnFinished({ chatId, messageId, status })` — ход закончен на экране: один раз на ход, когда ответ получил итог, включая остановку
  и ошибку. Ответ, закрытый ради поправки на лету, получает своё событие перед ответом на поправку. Открытие чата с готовой историей события не даёт. На сервере то же — `onTurnFinished` у `createChatHandler`.
- Агент внутри продукта ([docs/in-product-agent.md](../../docs/in-product-agent.md)):
  - `subject="lesson:42"` — чат объекта: id чата берётся у сервера (`POST …/subject`). Вместе с `chatId` не задавать.
  - `onTurnRefused({ kind, code, message })` — отказ приложения (`turn_refused`), в доступе (`access_refused`), закрытый чат (`chat_closed`), запрещённое действие (`action_forbidden`, `code` — право) или отказ в новом чате (`chat_creation_refused`); текст возвращается в поле.
  - Права и закрытый чат: кнопки по `capabilities` из истории чат прячет сам, закрытый чат блокирует поле и показывает текст закрытия (скину — `ChatClosedNotice`, договор v20, [docs/skin-v20.md](../../docs/skin-v20.md)). `onChatAccessChange({ capabilities, closed })` сообщает о каждой смене; у `useAgentChat` — `capabilities` и `closed`. `ChatWorkspace` при `chatList: false` показывает только чат: список появляется после первой истории и при запрете больше не запрашивается. После 403 `action_forbidden` права перечитываются. Закрытый чат в списке помечен (`ChatListEntry.closed`, надпись `chatListClosed`). В закрытом чате правка, «Переделать» и стрелки веток доступны по правам: они уводят с точки закрытия.
  - Состояние чата (`model.state`): `onStateChange(state)` у `AgentChat` — после загрузки и при каждой смене (запись в потоке ответа, ветка, правка, событие `state-changed` из другой вкладки); внутри ленты — `useChatState()`, у `useAgentChat` — `chatState`. Служебные ключи (`$…`) не показываются.
  - Отказ в новом чате (`beforeCreateChat` на сервере): `useChatList` — `creationRefusal` и `onCreateRefused`, `ChatWorkspace` отдаёт его в `onTurnRefused` с видом `chat_creation_refused`, текст отказа виден в списке.
  - `reloadKey` (`AgentChat`, `useAgentChat`, `ChatWorkspace`): новое значение — история перечитывается с сервера. Нужно, когда чат изменили не через этот экран, например открыли снова из кода. `onChatUnavailable` у `AgentChat` — служебный, для `ChatWorkspace`.
  - `appEvents={{ type: View }}` рисует события приложения внутри ответа, `onAppEvent(event, { live, messageId? })` сообщает о каждом.
  - `composerActions` — свои кнопки у поля: узел или `(composer) => …` с `value`, `setValue`, `send(text?)`, `addFiles`, `busy`, `blocked`, `canSend`. Скину — `Composer.actions` (договор v19, [docs/skin-v19.md](../../docs/skin-v19.md)); скин v18 работает без кнопок.
- `useAgentChat` — то же поведение без готовой сборки ленты, если нужна своя. Для веток: `forks`, `selectBranch(messageId)`,
  `canRegenerate`, `regenerate()`, `canEdit`, `edit(messageId, text)` (отвечает `Promise<EditOutcome>`: правка началась, не началась или сервер отказал).

Пакет не зависит от дизайн-системы и не импортирует стилей. Договор скина (версия 12: панель агента, отдельный `AgentPanelSkin`, см. выше; версия 11: экран памяти, отдельный `MemorySkin`, см. выше; версия 9: подтверждение действий — [contracts/approvals.md](../../docs/contracts/tool-approval/approvals.md); версия 8: необязательные `SpendingNotice` (с `id`, состояние `none`) и `Composer.sendingBlocked` с `sendingBlockedReasonId`; версия 6: ветки и правка — [contracts/branches-and-edit.md](../../docs/contracts/branches-and-edit/branches-and-edit.md)) —
[contracts/skin.md](../../docs/contracts/models-and-picker/skin.md) (дополняет [версию 2](../../docs/contracts/fast-feed-and-liveness/skin.md)), словарь —
[contracts/labels.md](../../docs/contracts/basic-agent-dialog/labels.md) и
[дополнение к нему](../../docs/contracts/fast-feed-and-liveness/labels.md).

## Лента рисует только видимое

Длинный чат открывается сразу внизу: на странице стоят только сообщения у экрана (не больше
40 даже в чате из 2000 сообщений). Для этого пакет берёт библиотеку
[`virtua`](https://github.com/inokawa/virtua), версия закреплена точно (`0.52.8`) и импортируется
только в `src/message-feed.tsx`. Ставить её отдельно не нужно.

Из-за этого прокруткой управляет чат, а не скин. Что нужно от своего скина:

- `Layout` вешает `scrollRef` на прокручиваемый элемент и кладёт `feed` внутрь; лента внутри
  `role="log"` с `aria-live="off"`; `announcement` — в скрытый элемент с `aria-live="polite"`;
- промежутки между сообщениями — `padding` корня, не `gap` и не `margin`;
- `Reasoning` и `ToolCallRow` не хранят раскрытие сами, а показывают `open` и зовут `onOpenChange`:
  раскрытое остаётся раскрытым, даже если сообщение уходило за край экрана;
- стили не зависят от «последний ли элемент» (`:last-child`, `:has()`).

## Живая связь

Сервер шлёт пинги, вкладка замечает тишину и сама переподключается без повторов и пропусков.
Состояние — `connection: "online" | "reconnecting" | "offline"` у `useAgentChat`, для скина —
компонент `ConnectionNotice`. Сроки — проп `liveness`:

```tsx
<AgentChat
  api="/api/chat"
  chatId={chatId}
  skin={tandemSkin}
  liveness={{
    silenceTimeoutMs: 30_000, // сколько тишины терпеть в потоке ответа
    reconnectDelaysMs: [0, 2000, 5000], // паузы перед попытками; после трёх неудач — «Нет связи с сервером»
    requestTimeoutMs: 10_000, // срок одной попытки и любого запроса без потока
  }}
/>
```

Срок тишины никогда не меньше трёх пингов сервера (`heartbeatIntervalMs`, по умолчанию 10 с).

Отказ сервера — не обрыв связи. Вход истёк (401) — надпись «Вход истёк. Войдите снова» с «Повторить», без попыток
переподключения. У человека уже идут ответы в других чатах (429 `too_many_turns`) — своя надпись, текст возвращается в поле.
Сервер не признал страницу своей (403 `forbidden_origin`: фронт и API на разных адресах, а адреса фронта нет в `allowedOrigins`
сервера) — надпись «Сервер чата не принимает сообщения с этой страницы», текст возвращается в поле; в режиме разработки
(`process.env.NODE_ENV !== "production"`) в консоли подсказка, какой адрес вписать.
Состояние — `refusal: "signed_out" | "too_many_turns" | "forbidden_origin" | null` у `useAgentChat`; скин получает их в `ErrorNotice` как `kind`
(текст — `labels.errors[kind]`).
Сбой ответа подписывается `labels.errors[kind]`. Своя подпись — функция `labels.errorText(error, plain)`: `error` — вид и,
если сервер их отдал (право `errorDetails`), подробности `details` (`providerId`, `modelId`, `statusCode`, `reason`,
`resetsAt`); `plain` — `errors[kind]`. Текст уходит скину в `ErrorNotice` как `text` и диктору. Функция бросила
исключение — подпись `plain` и одна запись в консоль. Например, админу:

```tsx
const labels = {
  ...russianLabels,
  errorText: (error, plain) =>
    error.details?.resetsAt ? `${plain}. Предел снимут ${new Date(error.details.resetsAt).toLocaleDateString("ru")}` : plain,
};
```
Ответ брошен упавшей копией сервера — экран сам перечитывает историю раз в 3 с и через 30 с показывает «прерван» с «Повторить»; обновлять страницу не нужно.
Подробности — [contracts/liveness.md](../../docs/contracts/fast-feed-and-liveness/liveness.md).

Подключение целиком: [docs/getting-started.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/getting-started.md).

Журнал изменений и что делать при обновлении: [CHANGELOG.md](./CHANGELOG.md). Все пакеты SDK выходят вместе и с одной версией; обновление — `pnpm update "@ykurilov/agent-chat-*" --latest`.
