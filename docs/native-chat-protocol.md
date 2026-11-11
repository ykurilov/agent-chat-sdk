# HTTP-протокол чата для нативного клиента

Документ для того, кто пишет клиент без React: Swift на iPhone, Kotlin, консольная программа. Сервер — обычный
`createChatHandler` / `createChatServer` из `@ykurilov/agent-chat-server` на `core`, смонтированный в Hono
(`mountChat(app, handler)`), с любым хранилищем (`storage-sqlite`, `storage-postgres`).

Отдельный протокол внешнего исполнителя с журналом и курсором (`createExternalChatHandler`, Swift-пакет
`AgentChatClient`) — другой, он описан в [external-native.md](external-native.md). Здесь — тот же HTTP, на котором
работает `AgentChat` в браузере.

Источник правды — [chat-handler.ts](../packages/server/src/chat-handler.ts). Примеры потоков ниже сняты с настоящего
`createChatServer` с моделью-заглушкой (`MockLanguageModelV4`), версия 0.101.0. Длинные id сокращены.

## 1. Адреса и вход

Все адреса — от `basePath`, например `https://alarm.example.com/api/chat`. Ниже `{base}`.

**Вход решает приложение.** Сервер на каждый запрос зовёт `resolveUser(request)`. Какой заголовок там читать
(`Authorization: Bearer <ключ устройства>`, свой `X-Device-Key`, cookie) — выбор приложения, SDK заголовки не
смотрит. Ответ `resolveUser`:

| Вернул | Ответ клиенту |
|---|---|
| `{ id }` | запрос идёт дальше от имени `id` |
| `null` | `401 {"error":{"kind":"invalid"}}` на любом адресе |
| `{ refused: { code, message, status? } }` | `status` (401 или 403, по умолчанию 403) `{"error":{"kind":"access_refused","code","message"}}` |

Чат принадлежит тому `id`, который его создал. Чужой или несуществующий чат — `404 not_found`.

**Проверка страницы (Origin).** Меняющие запросы (не GET) с чужой веб-страницы отклоняются `403 forbidden_origin`.
Запрос без заголовков `Origin` и `Sec-Fetch-Site` (так ходит `URLSession`) проходит: его судит только `resolveUser`.

**Пределы тела.** JSON-тело больше 1 МиБ — `413 too_large`. Тело ответа на виджет — до 64 КБ, ответ браузерного
инструмента — до 64 КБ.

## 2. Сводка адресов

| Метод и адрес | Тело | Ответ |
|---|---|---|
| `POST {base}` | нет | `201 {"id"}` — новый чат |
| `GET {base}` | — | `{"chats":[{id,title,createdAt,updatedAt}]}`; только при `chatList: true`, иначе 404 |
| `PATCH {base}/:chatId` | `{"title"}` | `{id,title}`; при `chatList` |
| `DELETE {base}/:chatId` | — | `204`; при `chatList` |
| `GET {base}/:chatId` | — | история (раздел 3) |
| `POST {base}/:chatId/messages` | сообщение (раздел 4) | поток ответа SSE |
| `GET {base}/:chatId/stream` | — | поток идущего хода с начала или `204`, если хода нет |
| `POST {base}/:chatId/stop` | `{turnRequestId?}` или нет | `202` — остановлено или запомнено, `204` — нечего останавливать |
| `POST {base}/:chatId/steer` | как у `messages` | `202 {"status":"queued"\|"started"\|"held","messageId"}` |
| `POST {base}/:chatId/retry` | `{timeZone?, place?, tabId?, turnRequestId?}` | поток ответа; повтор после сбоя |
| `POST {base}/:chatId/widgets/:toolCallId` | `{"answer":…}` | `200 {"resumed":bool}` |
| `POST {base}/:chatId/browser-tools/:toolCallId` | `{"tabId","output"}` или `{"tabId","error"}` | `204` |
| `POST {base}/:chatId/approvals/:approvalId` | `{"decision":"allow"\|"deny"\|"always"}` | `{"resumed":bool}` |
| `GET {base}/:chatId/watch` | — | поток событий чата SSE (раздел 7) |
| `GET {base}/:chatId/history-part` | query | одна часть сжатой истории |
| `GET {base}/models`, `PUT {base}/:chatId/model` | `{modelId,providerId,reasoning?}` | меню моделей и выбор |

Ещё есть ветки (`branches`, `branch`), правка (`edit`), «Переделать» (`regenerate`), вложения, лимиты, память, фон —
они нужны не каждому клиенту, смотрите `chat-handler.ts`.

## 3. Чат и история

**Создать.** `POST {base}` без тела → `201 {"id":"f0ed9b71-…"}`. Данные чата и приветствие решает сервер
(`newChatData`, `newChatGreeting`); клиент их не присылает. Повтор POST создаёт второй чат: идемпотентности нет.
Если нужен один постоянный чат на устройство, храните `id` у себя или заводите его на сервере по ключу
(`subjectChats`, `POST {base}/subject {"key"}` → `{id, created}`).

**История.** `GET {base}/:chatId` → JSON:

| Поле | Что это |
|---|---|
| `chat` | `id`, `title`, `createdAt`, `updatedAt`, выбор модели |
| `messages` | сообщения текущей ветки, формат `UIMessage` AI SDK: `id`, `role`, `parts`, `metadata` |
| `running` | на этой копии сервера идёт ход: подключайтесь `GET /stream` |
| `detachedAnswer` | ход идёт, но его поток не здесь (упавшая или другая копия): перечитывайте историю |
| `pendingMessages` | ждущие поправки (`steer`), если есть |
| `capabilities` | права человека: `steer`, `retry`, `voice` и другие |
| `forks`, `compactions`, `compacting` | ветки и сжатие |
| `backgroundTasks` | подключён ли фон |

Части сообщения ассистента: `text`, `reasoning`, `step-start`, `tool-<имя>` (`toolCallId`, `state`, `input`,
`output`), `data-…` (события приложения, состояние). Статус ответа — `metadata.status`: `streaming`, `complete`,
`stopped`, `error`, `interrupted`, `awaiting_approval`. У `error` есть `metadata.error.kind`: `overloaded`,
`rate_limited`, `insufficient_funds`, `invalid_key`, `context_overflow`, `other`.

**Версия истории.** Каждый ответ истории несёт заголовок `x-agent-chat-history-version` — SHA-256 полной истории
(64 hex-знака). Он нужен для `watch` (раздел 7). Заголовок `cache-control: private, no-store`.

**Сжатая история.** `GET {base}/:chatId?history=compact&limit=30` — последние `limit` сообщений (1–100, по умолчанию 30).
Большие входы и выходы законченных серверных инструментов и текст раздумий заменены ссылками; виджеты (базовые и
свои) приходят целиком. Добавляется поле:

```json
"historyView": {
  "mode": "compact",
  "branch": "eb2d0951…",
  "headMessageId": "933c2417…",
  "olderCursor": "m-3",
  "totals": { "messages": 6, "assistantAnswers": 3 },
  "stateBefore": {}
}
```

Старше — `?history=compact&before=<olderCursor>&branch=<branch>`. Ветка сменилась или сообщения `before` нет —
`409 history_changed`: перечитайте с начала. Неверный `limit` — `400 invalid`. Полная часть по ссылке —
`GET /history-part?branch=…&messageId=…&partIndex=…&revision=…` (ревизии — в `metadata.historyDetails`).

## 4. Отправка сообщения

`POST {base}/:chatId/messages`, `content-type: application/json`:

```json
{
  "message": { "id": "m-1", "role": "user", "parts": [{ "type": "text", "text": "Разбуди в 7:30" }] },
  "timeZone": "Europe/Moscow",
  "place": { "description": "Экран будильников", "data": { "screen": "alarms" } },
  "tabId": "iphone-1"
}
```

| Поле | Правило |
|---|---|
| `message.id` | строка 1–200 знаков. **Создаёт клиент** (UUID) и хранит до подтверждения: по нему сервер не даёт дубликатов |
| `message.role` | только `"user"` |
| `message.parts` | части `text` склеиваются; текст не пустой, до 100 000 знаков. Части `file` — только с вложениями на сервере |
| `timeZone` | пояс IANA устройства. Не строка — не берётся; неизвестный пояс — дата по запасному поясу сервера, не ошибка |
| `place` | где человек в приложении, или `null` — «места нет». `description` — строка, видит модель; обрезается до `agent.placeMaxLength` (по умолчанию 1000 знаков) с «…». `data` — объект, видят только инструменты, до 4 КБ в JSON, больше — отбрасывается. Неверная форма — `400 invalid` |
| `tabId` | строка 1–100 знаков: кто исполняет клиентские инструменты (раздел 6). Без него клиентские инструменты отвечают модели «страница не подключена» |
| `turnRequestId` | строка 1–100 знаков из букв, цифр и `_.:-`, новая на каждый запрос, начинающий ход (UUID). По ней «Стоп» останавливает ход именно этого запроса (раздел 9). Неверная — `400 invalid` |
| `voiceMode`, `voiceSounds` | для голосового режима; не булево / не список — `400 invalid` |

Ответ — сразу поток хода (раздел 5). Ход не привязан к соединению: обрыв запроса только отписывает клиента, ответ
дописывается и сохраняется.

## 5. Поток ответа

Формат — UI message stream AI SDK поверх SSE. Заголовки:

```
content-type: text/event-stream
x-vercel-ai-ui-message-stream: v1
x-agent-chat-heartbeat-ms: 10000
cache-control: no-cache
x-accel-buffering: no
```

Каждое событие — блок `data: <JSON>` и пустая строка. Строка `: ping` — признак жизни: приходит сразу и раз в
`heartbeatIntervalMs` (по умолчанию 10 с). Конец — `data: [DONE]`. Клиент `AgentChat` считает поток мёртвым после
`max(30 с, 3 × heartbeat)` без единого байта.

**Простой ответ** (снято с сервера):

```
: ping
data: {"type":"start","messageId":"7021bffe…","messageMetadata":{"modelId":"mock-model","providerId":"mock"}}
data: {"type":"start-step"}
data: {"type":"text-start","id":"t"}
data: {"type":"text-delta","id":"t","delta":"Добро"}
data: {"type":"text-delta","id":"t","delta":"е утро!"}
data: {"type":"text-end","id":"t"}
data: {"type":"finish-step"}
data: {"type":"message-metadata","messageMetadata":{"status":"complete","reasoningDurationsMs":{},"usage":{"inputTokens":10,"cachedInputTokens":0,"outputTokens":5,"reasoningTokens":0,"contextTokens":15}}}
data: {"type":"finish","finishReason":"stop"}
data: [DONE]
```

`start.messageId` — id ответа ассистента, его выдаёт сервер. Итог хода — `metadata.status` в последнем
`message-metadata`.

**Серверный инструмент** — инструмент с `execute` на сервере; клиент только показывает:

```
data: {"type":"start","messageId":"d6269df4…",…}
data: {"type":"start-step"}
data: {"type":"tool-input-available","toolCallId":"call_time","toolName":"get_time","input":{}}
data: {"type":"tool-output-available","toolCallId":"call_time","output":{"now":"07:00"}}
data: {"type":"finish-step"}
data: {"type":"start-step"}
data: {"type":"text-start","id":"t"}
… текст …
data: {"type":"message-metadata","messageMetadata":{"status":"complete",…}}
data: {"type":"finish","finishReason":"stop"}
data: [DONE]
```

Настоящая модель перед `tool-input-available` обычно шлёт `tool-input-start` и `tool-input-delta` (вход по кускам);
заглушка их не шлёт.

**Остановка «Стоп»:**

```
data: {"type":"start","messageId":"a4e7aa45…",…}
data: {"type":"message-metadata","messageMetadata":{"status":"stopped",…}}
data: {"type":"abort"}
data: [DONE]
```

**Сбой провайдера** (по коду, не снято): кусок `{"type":"error","errorText":"<вид>"}`, вид — из списка
`metadata.error.kind` выше; итог ответа — `status: "error"`.

**Другие куски**, которые может прислать сервер: `reasoning-start` / `reasoning-delta` / `reasoning-end`,
`data-app-event` (события приложения из `afterTurn` и инструментов), `data-app-state` (состояние чата),
`data-app-change` (инструмент поменял данные), `data-step-reset` (стереть всё от последнего `start-step`: шаг
начат заново у другого провайдера), `data-browser-call` (раздел 6). Незнакомые типы клиент пропускает.

**Подключиться к идущему ходу** — `GET {base}/:chatId/stream`. Сервер отдаёт поток **с начала хода**: все прошлые
куски, потом новые. Клиент начинает сообщение ассистента заново, а не дописывает. Хода нет — `204`.

## 6. Инструменты, которые выполняет телефон

Есть два механизма. Выбирайте по тому, кто решает.

| | Свой виджет | Клиентский инструмент |
|---|---|---|
| Настройка сервера | `agent.widgets.custom: [defineWidget(…)]` | `agent.browserTools: { имя: tool({description, inputSchema}) }` без `execute` |
| Для чего | нужно решение человека: «Поставить будильник на 7:30?» | телефон делает сам, без вопроса: открыть экран, прочитать будильники |
| Пауза | ход **закрывается** со статусом `awaiting_approval` и ждёт сколько угодно | ход **идёт**, сервер ждёт ответ в памяти процесса |
| Срок | нет | `agent.browserToolTimeoutMs`, по умолчанию 30 с (1 с … 2³¹−1 мс) |
| Переживает обрыв, перезапуск сервера, другое устройство | да, ожидание лежит в базе | нет |
| Ответ | `POST /:chatId/widgets/:toolCallId` | `POST /:chatId/browser-tools/:toolCallId` |

### Свой виджет

Вызов в потоке хода (снято с сервера, виджет `set_alarm`):

```
data: {"type":"start","messageId":"933c2417…",…}
data: {"type":"start-step"}
data: {"type":"tool-input-available","toolCallId":"call_alarm","toolName":"set_alarm","input":{"time":"07:30"}}
data: {"type":"finish-step"}
data: {"type":"message-metadata","messageMetadata":{"status":"awaiting_approval",…}}
data: {"type":"finish","finishReason":"tool-calls"}
data: [DONE]
```

Признак паузы — `status: "awaiting_approval"` и вызов без `tool-output-available`. В истории тот же вызов — часть
`{"type":"tool-set_alarm","toolCallId":"call_alarm","state":"input-available","input":{"time":"07:30"}}` в последнем
ответе. Пока ход на паузе, `GET /stream` отвечает `204`.

**Ответ:** `POST {base}/:chatId/widgets/call_alarm` с телом `{"answer":{"ok":true,"alarmId":"a-17"}}`. Можно добавить
`timeZone`, `place`, `tabId`, как у сообщения.

| Ответ | Когда |
|---|---|
| `200 {"resumed":true}` | принят, ход продолжился: читайте `GET /stream` |
| `200 {"resumed":false}` | записан, но в ответе ждёт ещё один виджет: перечитайте историю |
| `400 invalid_answer` | не прошёл `answerSchema`, ответ больше 16 КБ, тело не JSON, больше 64 КБ или без `answer` |
| `409 widget_not_pending` | уже отвечен, закрыт сообщением или «Стопом», не в последнем ответе ветки, виджет убран из настроек |
| `409 widget_answer_refused` | отказ проверки приложения (`checkAnswer`), `message` — показать человеку; виджет ждёт |
| `409 widget_answer_cancelled` | «Стоп» во время проверки; виджет ждёт |
| `504 widget_check_timeout` | проверка не уложилась в `checkAnswerTimeoutMs` (5 с); можно повторить |
| `409 busy`, `403 turn_refused`, `429 …` | как у сообщения |

Продолжение после ответа (снято): `GET /stream` отдаёт тот же `messageId` ответа, модель дописывает его.

```
data: {"type":"start","messageId":"933c2417…",…}
data: {"type":"start-step"}
data: {"type":"text-start","id":"t"}
data: {"type":"text-delta","id":"t","delta":"Будил"}
data: {"type":"text-delta","id":"t","delta":"ьник стоит на 07:30."}
…
data: {"type":"message-metadata","messageMetadata":{"status":"complete",…}}
```

**Без ответа.** Таймаута нет: виджет ждёт в базе. Повторной доставки события тоже нет — после переподключения
клиент читает историю и снова видит ждущий вызов (`state: "input-available"` в последнем ответе со статусом
`awaiting_approval`). Новое сообщение человека закрывает виджет: модель получит `{"ответ":"сообщением"}`. Ответ на
закрытый виджет — `409 widget_not_pending`, ничего не записано. Повторить тот же ответ после обрыва безопасно:
второй раз придёт `409 widget_not_pending`.

### Клиентский инструмент

Нужен `tabId` в теле сообщения: сервер шлёт вызов тому, кто начал ход. Поток (снято, инструмент `open_alarms`):

```
data: {"type":"tool-input-available","toolCallId":"call_open","toolName":"open_alarms","input":{"filter":"today"}}
data: {"type":"data-browser-call","id":"call_open","data":{"toolCallId":"call_open","toolName":"open_alarms","input":{"filter":"today"},"tabId":"iphone-1"},"transient":true}
```

Клиент выполняет и отвечает `POST {base}/:chatId/browser-tools/call_open` с `{"tabId":"iphone-1","output":{"shown":3}}`
или `{"tabId":"iphone-1","error":"текст"}` → `204`. Дальше в том же потоке:
`{"type":"tool-output-available","toolCallId":"call_open","output":{"shown":3}}` и продолжение модели.

Модель получает результат до 16 КБ, ошибку до 1000 знаков, пустой результат — «готово». Нет ответа за срок —
модель получает «Страница не ответила за N с». Поздний, повторный или чужой ответ — `409 not_pending`. Неверное
тело — `400 invalid`. Ожидание живёт в памяти одного процесса: после перезапуска сервера вызов не повторится.
Попадёт ли незакрытый вызов к клиенту при `GET /stream` после обрыва, отдельно не проверялось: часть
`data-browser-call` не сохраняется в истории.

**Подтверждение опасного действия** (`needsApproval` у серверного инструмента) работает как виджет: пауза
`awaiting_approval`, ответ `POST /:chatId/approvals/:approvalId {"decision":"allow"|"deny"|"always"}` →
`{"resumed":bool}`; уже решённый — `409 approval_not_pending`.

## 7. Наблюдение за чатом: `GET /watch`

`GET {base}/:chatId/watch` держит поток SSE, пока чат открыт на экране. Формат тот же: `: ping`, `data: <JSON>`.
События (`chatId` есть в каждом):

| `type` | Поля | Что делать |
|---|---|---|
| `turn-started` | `messageId`, `trigger` (`human`/`notice`), `channel` | чужой ход (другое устройство, сервер): перечитать историю, при `running` — `GET /stream` |
| `turn-finished` | `messageId`, `status`, `trigger`, `channel` | ход кончился; `status: "awaiting_approval"` — пауза виджета |
| `notice-added`, `message-added`, `greeting-replaced`, `answer-edited`, `turn-held` | `messageId` | перечитать историю |
| `state-changed` | `reason`, `state`, `atMessageId` | обновить то, что рисуется по состоянию |
| `app-event` | `event`, `messageId?` | событие приложения вне потока |
| `chat-closed` / `chat-reopened` | `closed: {code, message}` | закрыть или открыть поле ввода |
| `tasks-changed` | — | перечитать задачи фона |

Снято с сервера (ход с виджетом):

```
data: {"type":"turn-started","chatId":"f0ed…","messageId":"933c2417…","trigger":"human","channel":"web"}
data: {"type":"turn-finished","chatId":"f0ed…","messageId":"933c2417…","trigger":"human","channel":"web","status":"awaiting_approval"}
data: {"type":"turn-started","chatId":"f0ed…","messageId":"933c2417…","trigger":"human","channel":"web"}
data: {"type":"turn-finished","chatId":"f0ed…","messageId":"933c2417…","trigger":"human","channel":"web","status":"complete"}
```

**Догнать после обрыва.** У `watch` нет курсора и пропущенные события не повторяются. Вместо этого клиент передаёт
версию последней загруженной истории: `GET /watch?historyVersion=<x-agent-chat-history-version>`. Сервер отвечает
заголовком `x-agent-chat-history-match`: `1` — история не менялась, перечитывать не нужно; `0` — перечитайте
`GET /:chatId`. Версия не 64 hex-знака — проверки нет, заголовок `0`.

Как делает `AgentChat`: переподключается с паузами `0, 2, 5 с` (последняя повторяется); 401/403 — повтор через
минуту; другой 4xx, кроме 408 и 429, — больше не пытается; тишина дольше срока — разрыв и переподключение.

## 8. Обрыв и повтор без дубликатов

Сервер не даёт записать два сообщения с одним `message.id`. Порядок действий клиента, когда ответ на
`POST /messages` оборвался или не пришёл:

1. `GET {base}/:chatId`.
2. Сообщение с вашим `id` есть и `running: true` — `GET /stream`, ответ придёт с начала хода.
3. Сообщение есть, `running: false` — ответ уже в истории (или `awaiting_approval`).
4. Сообщения нет и `running: false` — отправьте снова **с тем же `id`**.
5. `detachedAnswer: true` — ход ведёт другая копия сервера: перечитывайте историю, пока он не кончится.

Ответы на повтор того же `id` (сняты с сервера):

| Состояние | Ответ |
|---|---|
| сообщение уже записано, хода нет | `409 {"error":{"kind":"invalid"}}` — копии нет, перечитайте историю |
| в чате идёт ход (этот же или другой) | `409 {"error":{"kind":"busy"}}` |

`409 busy` на новое сообщение значит: в чате уже идёт ход. Подождите его конца (`GET /stream`) или пошлите поправку
(`/steer`).

Ход, оборванный перезапуском сервера, после `recoverInterruptedAnswers()` получает статус `interrupted`.
Повторить его — `POST /:chatId/retry`.

## 9. «Стоп» и поправка

**`POST /:chatId/stop`** → `202`, если что-то остановлено (ход, ход на старте, проверка ответа виджета, ждущая
пачка), иначе `204`. Поток хода закрывается кусками `status: "stopped"` и `{"type":"abort"}`.

Тело `{"turnRequestId":"…"}` — «Стоп» хода, начатого запросом с этим `turnRequestId` (отправка, правка, переделка,
повтор, решение по подтверждению, ответ на виджет, поправка, начавшая ход). Такой «Стоп» действует, как бы ни легли
запросы: пришёл раньше, чем сервер начал ход, — сервер запоминает его (`202`) и останавливает ход сразу после старта;
пришёл на другую копию сервера — ход на своей копии останавливается в пределах 2 с. Ход другого запроса такой «Стоп»
не трогает: запоздавший «Стоп» не остановит следующий вопрос. С id ответ всегда `202` (остановлено или запомнено),
даже если хода с этим id так и не будет. Клиент шлёт id хода, который начал сам; к ходу, к которому только
подключился, — «Стоп» без тела: останавливается идущий ход чата. Ответ на поправки — новый ход с id последней
поправки: «Стоп» прежнего ответа его не трогает, «Стоп» с id поправки останавливает.

**`POST /:chatId/steer`** — поправка к идущему ходу, тело как у `messages`. Ответ
`202 {"status":"queued","messageId":"m-8"}`: агент возьмёт поправку на ближайшей границе шага и продолжит новым
ответом. `started` — хода не было, поправка начала ход. `held` — приложение велело записать без хода. Ответ на
поправку читается `GET /stream` или по `watch`. Повтор с тем же `id` даёт тот же итог без копии. «Стоп» при ждущей
поправке останавливает текущий ответ, и агент сразу отвечает на поправку: в снятом примере за `stopped` в `watch`
пришёл новый `turn-started`.

## 10. Ошибки

Тело ошибки всегда `{"error":{"kind":…}}`, у части видов есть поля.

| Код | `kind` | Когда, поля |
|---|---|---|
| 400 | `invalid` | неверное тело или сообщение, неверный `place`/`tabId`, пустой текст, длиннее 100 000 знаков |
| 400 | `invalid_answer` | ответ виджета не прошёл проверку |
| 400 | вид вложения | вложение отклонено |
| 401 | `invalid` | `resolveUser` вернул `null` |
| 401/403 | `access_refused` | отказ приложения в `resolveUser`: `code`, `message` |
| 403 | `turn_refused` | `beforeTurn` отказал в ходе: `code`, `message` — показать человеку; ничего не записано |
| 403 | `action_forbidden` | право выключено (`chatCapabilities`): `action`, `code`, `message` |
| 403 | `chat_creation_refused` | `beforeCreateChat` отказал: `code`, `message` |
| 403 | `forbidden_origin` | меняющий запрос с чужой веб-страницы |
| 404 | `not_found` | нет адреса, чата или чат чужой |
| 409 | `busy` | в чате идёт ход |
| 409 | `invalid` | повтор `message.id`; «Повторить» без повода |
| 409 | `chat_closed` | чат закрыт: `code`, `message` |
| 409 | `history_changed` | сжатая история: ветка сменилась |
| 409 | `widget_not_pending`, `widget_answer_refused`, `widget_answer_cancelled` | раздел 6 |
| 409 | `not_pending` | клиентский инструмент уже не ждёт |
| 409 | `approval_not_pending`, `approval_stale` | подтверждение уже решено |
| 413 | `too_large` | тело больше 1 МиБ |
| 429 | `spending_limit_reached` | лимит расходов: `scope`, `period`, `resetsAt`, иногда `timeZone`, `reason`, `windowId`, `hours`, `unit` |
| 429 | `too_many_turns` | у человека уже идёт `limit` ответов (`maxConcurrentTurnsPerUser`, по умолчанию 3) |
| 500 | `other` | сбой сервера, строка в журнале |
| 504 | `widget_check_timeout` | проверка ответа виджета не уложилась в срок |

Все отказы до хода (`400`, `403`, `409`, `413`, `429`) ничего не записывают: сообщение можно отправить снова тем же `id`.

## 11. Голос: диктовка через WebSocket

Пакет `@ykurilov/agent-chat-voice`, режим «через сервер» (`createVoiceRelay` + `mountVoiceRelay`). Это диктовка:
звук превращается в текст, который клиент потом отправляет обычным сообщением. Подробно —
[packages/voice/README.md](../packages/voice/README.md), код — `packages/voice/src/server/voice-relay.ts`.

**Подключение.** `wss://<сервер><путь, например /api/voice/stream>?chat=<chatId>`. `chat` нужен только для учёта
расходов. Вход — тот же `resolveUser` на запросе подъёма: заголовки ставятся в `URLRequest` для
`URLSessionWebSocketTask`. Отказы приходят не HTTP-статусом, а кодом закрытия сразу после подъёма (таблица ниже).
Исключение — чужая веб-страница (Origin): HTTP 403.

**Порядок:**

1. Клиент → текст `{"audio_format":"pcm_s16le","sample_rate":16000,"num_channels":1,"language_hints":["ru"]}`.
   `sample_rate` — целое 8000–48000, `num_channels` — 1 или 2. Или `{"audio_format":"auto"}` для контейнеров
   (webm, ogg, mp4). `language_hints` — по желанию, сервер берёт до трёх кодов из 2–3 букв. Срок приветствия — 10 с.
2. Сервер → `{"ready":true,"max_session_seconds":300,"polish":true}` (`polish` — только если включена чистка).
   Звук до `ready` и второе приветствие — закрытие 4400.
3. Клиент → бинарные куски звука, каждый до 1 МиБ. Для `pcm_s16le` — сырые 16-битные отсчёты little-endian.
4. Сервер → сообщения Soniox как есть (JSON с токенами, формат — документация Soniox real-time API).
5. «Стоп»: клиент → текст `{"type":"finalize"}`. Soniox закрепляет сказанное и присылает токен `<fin>`.
6. Если чистка включена, сервер → `{"polished":{"text":"…"}}`, `null` — оставить текст Soniox.
7. Пустое текстовое сообщение `""` — конец звука: Soniox доделывает и сессия закрывается кодом 1000.

Ретранслятор не шлёт Soniox `keepalive`: по коду сессии Soniox закрывает соединение примерно после 20 с без звука.
Шлите звук непрерывно, тишину тоже.

**Коды закрытия:**

| Код | Причина |
|---|---|
| 1000 | нормальный конец |
| 1009 | кусок больше `maxFrameBytes` (1 МиБ) |
| 4400 | нарушен порядок, неверное приветствие или нет его 10 с |
| 4401 | не вошёл |
| 4402 | лимит расходов |
| 4403 | приложение отказало в доступе |
| 4408 | вышел предел записи `max_session_seconds` (300 с) |
| 4413 | приложение отказало по длине |
| 4429 | больше 10 диктовок в минуту или больше 2 соединений одновременно |
| 4502 | Soniox недоступен или нет ключа |

## 12. Минимальный клиент по шагам

1. Поставить сервер: `createChatServer({ basePath: "/api/chat", resolveUser, storage, catalog, agent })`,
   `mountChat(app, handler)`, при старте `handler.recoverInterruptedAnswers()`. В `resolveUser` проверить ключ
   устройства и вернуть `{ id }`.
2. Клиент: на каждый запрос ставить свой заголовок входа.
3. Чат: `POST {base}` → `id`, сохранить на устройстве.
4. Открыть экран: `GET {base}/:id?history=compact`, запомнить `x-agent-chat-history-version`, нарисовать
   `messages`. Если `running` — `GET /stream`. Если последний ответ `awaiting_approval` с вызовом своего
   виджета без результата — показать виджет.
5. Открыть `GET /watch?historyVersion=…`; при `x-agent-chat-history-match: 0` и на события из раздела 7 —
   перечитать историю.
6. Отправка: создать UUID, сохранить черновик с ним, `POST /messages` с `timeZone`, `place`, `tabId`. Читать SSE
   построчно: пропускать `: ping`, разбирать `data:`, собирать сообщение ассистента по `start` / `text-delta` /
   `tool-*`, итог брать из `message-metadata.status`.
7. Обрыв или тишина дольше `3 × x-agent-chat-heartbeat-ms`: сделать шаги раздела 8.
8. Виджет: показать по `tool-input-available` с именем своего виджета и статусу `awaiting_approval`, ответить
   `POST /widgets/:toolCallId`, при `resumed: true` читать `GET /stream`.
9. Клиентский инструмент: на `data-browser-call` со своим `tabId` выполнить и ответить `POST /browser-tools/:toolCallId`
   быстрее срока.
10. «Стоп» — `POST /stop`. Ошибки — по таблице раздела 10: `message` из отказов приложения показывать человеку.
