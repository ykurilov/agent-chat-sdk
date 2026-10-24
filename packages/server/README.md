# @ykurilov/agent-chat-server

HTTP-адреса чата с агентом на стандартных `Request`/`Response` и подключения к Hono и Next.js.

```ts
import { createChatHandler } from "@ykurilov/agent-chat-server";
import { mountChat } from "@ykurilov/agent-chat-server/hono";

const chat = createChatHandler({ basePath: "/api/chat", storage, resolveUser, defaultChoice, catalog, agent });
mountChat(app, chat);                  // Hono: все адреса /api/chat и /api/chat/*
await chat.recoverInterruptedAnswers(); // при старте, до приёма запросов; дальше сам проверяет брошенные ответы раз в 5 с
await chat.flush({ waitForAnswersMs: 20_000 }); // при штатной остановке, до закрытия хранилища
```

- `resolveUser(request)` — текущий пользователь из вашей сессии; `null` → `401`.
  Модуль вход не реализует.
- `defaultChoice` — `{ modelId, providerId, reasoning? }` для нового чата; не задан или не подходит —
  первая доступная модель каталога (в журнал пишется причина). Раньше был `resolveModel`.
  Человек, уже выбиравший модель, получает новые чаты на своём последнем выборе, если он ещё доступен.
- `POST /:chatId/approvals/:approvalId` с телом `{ "decision": "allow" | "deny" | "always" }` — решение по действию, которое ждёт подтверждения. Ошибки: 409 `busy` (идёт другой ход), 409 `approval_not_pending` (отвечать уже нечем), 429 `spending_limit_reached`.
  `200 { resumed }`, `409 { error: { kind: "invalid" } }`, если запрос уже решён или закрыт.
- `chatList: true` включает список чатов: `GET {basePath}` → `{ chats: [{ id, title, createdAt, updatedAt }] }`, `PATCH {basePath}/:id` с `{ title }` → `200 { id, title }` (`400` — название пустое или длиннее 100 знаков; переименовать можно и во время ответа), `DELETE {basePath}/:id` → `204` (идущий ответ и сжатие останавливаются; повтор — `404`; `409` — только если чат уже удаляется или в этот миг запускается ход). Пока чат удаляется, сообщение, сжатие и вложения в него тоже получают `409`. Без `chatList` эти адреса отвечают `404`.
- Чужой или несуществующий чат — `404 { error: { kind: "not_found" } }` на каждом адресе.
- Запрос, который меняет данные (не GET), с чужой страницы — `403 { error: { kind: "forbidden_origin" } }` до входа и любых записей;
  адрес страницы — один раз в журнал. Свой сайт и запросы не из браузера проходят. Чат на чужом сайте, который шлёт запросы прямо
  оттуда (GetCourse), — `allowedOrigins: ["https://school.getcourse.ru"]` (CORS и куки `SameSite=None` — в вашем приложении).
  Фронт на своих поддоменах — шаблон `allowedOrigins: ["https://*.example.com"]` (не пускает `example.com` и `evil-example.com`;
  общие суффиксы вроде `*.co.uk` проверка не распознаёт — вписывайте свой домен).
  За прокси передайте имя сайта: `proxy_set_header Host $host; proxy_set_header X-Forwarded-Host $host;` — иначе старые браузеры
  получают 403, а журнал пишет «Origin не совпал с Host».
- `maxConcurrentTurnsPerUser` (по умолчанию 3, `Infinity` — без предела) — сколько ответов одного человека идут одновременно во всех
  его чатах. Лишний ход — `429 { error: { kind: "too_many_turns", limit } }` до любых записей.
- `replyChecks` и `now` передаются службе чата как есть: проверки готового ответа перед записью и часы службы
  (README ядра, [docs/reply-check.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/reply-check.md)).
- Тело запроса больше 1 МиБ — `413 { error: { kind: "too_large" } }`, оно не дочитывается.
- Ход не висит вечно и переживает сбои сам: настройки `agent.toolTimeoutMs`, `agent.modelSilenceTimeout`, `agent.toolResultMaxLength`,
  `agent.providerFallback`, `agent.sequentialTools`, `agent.timeZone` — описание в README ядра и в разделе «Надёжность хода» getting-started.
- Несколько копий сервера на одной базе можно: идущий ответ отмечает «жив», брошенный ответ копии, которая упала, прерывает другая копия.
  Запросы одного чата держите на одной копии. Первое обновление до этой версии — остановите старые копии, потом запускайте новые.
- `heartbeatIntervalMs` (по умолчанию `10_000`, меньше `1000` — ошибка) — как часто сервер шлёт тихий
  признак жизни в потоках ответа. Вкладка по нему замечает зависшую связь.
- `limits` — лимиты расходов из `@ykurilov/agent-chat-limits`. Исчерпан лимит — `429 { error: { kind: "spending_limit_reached", scope, period, resetsAt, timeZone?, reason?, windowId?, hours? } }` (`reason`: `limit`, `blocked` — человек заблокирован, `reserve` — остаток меньше запаса на старт хода)
  на отправку, повтор, переделку и правку (до любых записей); появляется `GET …/:id/spending` → `{ state, scope?, period?, share?, resetsAt?, timeZone?, reason?, windowId?, hours?, blocked?, windows? }` (`timeZone` — пояс лимитов, если задан; `windows` — все окна с долей и временем сброса)
  без сумм. Не задан — адреса нет, проверок нет.
- `onTurnFinished({ userId, chatId, messageId, status, modelId, providerId })` — ход закончен: один раз на ход при любом итоге
  (`complete`, `stopped`, `error`, `interrupted`, `awaiting_approval`), итог уже записан. `messageId` — id ответа, тот же, что в истории
  и на экране. Ход обработчик не ждёт; бросок или отклонённое обещание — в `logError`, ответ не ломается. Тип — `TurnFinished` из ядра.

  ```ts
  createChatHandler({ ...options, onTurnFinished: async (turn) => { if (turn.status === "complete") await analytics.answered(turn); } });
  ```

- Агент внутри продукта ([docs/in-product-agent.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/in-product-agent.md)):
  - `resolveUser` может вернуть `{ refused: { code, message, status? } }` → `401`/`403 { error: { kind: "access_refused", code, message } }` на всех адресах чата, голоса и мессенджеров.
  - `beforeTurn` — отказ приложения до хода: `403 { error: { kind: "turn_refused", code, message } }`. Получает `messageId` у отправки и правки.
  - `turnNotStarted` — ход не начался после пропуска `beforeTurn` (занято, лимит, повтор id…): снять резерв приложения. Ответ клиенту прежний.
  - `chatCapabilities({ userId, chat })` — права человека в чате, как в ядре. Запрещённое действие — `403 { error: { kind: "action_forbidden", action, code, message } }`; загрузка вложений проверяет право `attachments`, `POST …/steer` — право `steer`. `reasoning: false` и `toolDetails: false` прячут мысли и служебные инструменты из `GET` истории и потоков (свой инструмент экрана — `metadata: { showOnScreen: true }` в описании). `modelDetails: false` прячет модель, провайдера, расход, `ownerId` и текст сводок сжатия (и в `GET …/compactions`) из истории и потоков и выключает `PUT …/model`. `errorDetails: true` (по умолчанию `false`) отдаёт в историю и потоки подробности сбоя провайдера (`metadata.error.details`). Песочница права приложения не применяет.
  - `modelMenu({ userId })` — видит ли человек `GET …/models`: `false` — 403 `action_forbidden` (`action: "modelDetails"`). Нет — меню видно всем.
  - `privateStateKeys` — закрытые верхние ключи состояния чата: не уходят ни в историю, ни в поток, ни в `state-changed` адреса `watch`. Сервер видит их как обычно. Закрытое значение не возвращайте в выходе инструмента и тексте ответа.
  - Проверка ответа виджета приложением (`checkAnswer`) отказала — `409 { error: { kind: "widget_answer_refused", code: "widget_answer_refused", message } }`: ничего не записано, виджет ждёт дальше.
  - Закрытый чат (`service.closeChat`, `model.closeChat`) — `409 { error: { kind: "chat_closed", code, message } }` на отправку, «Повторить», подтверждения и виджеты. Правка, «Переделать», ветки и правка ответа уводят с точки закрытия и идут по правам. Мессенджеры отвечают человеку текстом закрытия или отказа.
  - `beforeCreateChat({ userId, origin? })` — можно ли завести новый чат: отказ на `POST {base}` — `403 { error: { kind: "chat_creation_refused", code, message } }`, в мессенджере (`/new`, первый чат) — текстом. Песочница хук не зовёт; закрытый чат песочницы админ открывает снова (`POST {sandboxBase}/chats/:chatId/reopen`).
  - `afterTurn`, `afterTurnTimeoutMs`, `afterTurnAttempts` — итог хода, как в ядре.
  - `onStateChanged`, `onStateChangedTimeoutMs`, `onStateChangedAttempts` — состояние чата сменилось, как в ядре: по очереди внутри чата, только пока сервер жив (сверка — `getChatState`); вкладка получает `state-changed` через `watch`. Служебные ключи состояния (`$…`) в историю и поток не уходят.
  - `subjectChats({ user, key, request })` открывает `POST {basePath}/subject { key }` → `{ id, created }`: один чат на объект; ответ `{ data?, title?, greeting? }` или отказ `{ code, message }`.
  - `chatList: { subjectChats: true }` — чаты объектов видны в списке (с `subjectKey`); по умолчанию скрыты.
- `chat.flush({ waitForAnswersMs? })` — штатная остановка: новые ходы не начинаются, идущие ответы ждутся до срока
  (по умолчанию 0), не успевшие закрываются как «Стоп» с записью (`afterTurn` видит `stopReason: "shutdown"`).
  Возвращается, когда всё записано и `afterTurn` закончен. Без вызова при остановке сервера теряется до 0,5 с текста.
- `chat.fetch(request)` подключается к любому серверу со стандартными `Request`/`Response`.
- Next.js (App Router): `createNextRouteHandlers(chat)` из `@ykurilov/agent-chat-server/next` отдаёт методы для файла
  маршрута; пакет `next` не нужен:

  ```ts
  // app/api/chat/[[...path]]/route.ts
  import { createNextRouteHandlers } from "@ykurilov/agent-chat-server/next";
  import { chatHandler } from "@/lib/chat";

  export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } = createNextRouteHandlers(chatHandler);
  export const dynamic = "force-dynamic";
  export const runtime = "nodejs";
  ```

  Нужен долгоживущий сервер, не serverless; `basePath` обработчика совпадает с путём маршрута. Момента «до приёма
  запросов» в Next.js нет: `chatHandler.recoverInterruptedAnswers()` зовите один раз сразу после `createChatHandler`
  (там же, где обработчик кладётся в `globalThis`). Без вызова ответы, оборванные падением сервера, остаются «идущими»
  навсегда, а задачи фона не поднимаются.

- Express и голый `node:http`: `toNodeListener(chat)` из `@ykurilov/agent-chat-server/node`. Ответ идёт потоком,
  разрыв соединения отменяет запрос, тело уже прочитанное разборщиком (`express.json()`, `req.body`) уходит как есть.
  Адрес вне `basePath` — `next()`, без `next` — 404:

  ```ts
  import { toNodeListener } from "@ykurilov/agent-chat-server/node";

  app.use(toNodeListener(chatHandler)); // Express
  http.createServer(toNodeListener(chatHandler)).listen(3000); // node:http
  ```

Адреса: `POST /api/chat`, `GET /api/chat/:id`, `POST …/:id/messages`, `POST …/:id/retry`,
`GET …/:id/stream`, `POST …/:id/stop`, `POST …/:id/steer` (поправка, пока агент отвечает: `202 { status: "queued" | "started", messageId }`), `GET …/:id/branches` и `POST …/:id/branch` (варианты ответов и переключение), `POST …/:id/regenerate` (переделать ответ), `POST …/:id/edit` (исправить сообщение), `GET …/:id/compactions` (записи сжатия истории), `GET …/models` (список для меню), `PUT …/:id/model` (выбор модели
и уровня рассуждений в чате). Адреса, которые запускают или продолжают ход (`messages`, `steer`, `edit`, `retry`, `regenerate`, `approvals/:id`), принимают в теле необязательные `place` (`null` или `{ description, data? }`) и `tabId` (строка до 100 знаков); неверная форма — `400 invalid`. Браузерные инструменты (`agent.browserTools`): вкладка отвечает на `POST …/:id/browser-tools/:toolCallId` с `{ tabId, output }` или `{ tabId, error }` — `204`, `400` (тело больше 64 КБ или неверной формы), `401`, `404`, `409` (`not_pending`: вызов не ждёт ответа этой вкладки). Только на одном сервере. Подробно — в
[contracts/http-api.md](../../docs/contracts/basic-agent-dialog/http-api.md) и в
[дополнении к нему](../../docs/contracts/fast-feed-and-liveness/http-api.md) (пинги в потоках); ветки и правка — [contracts/branches-and-edit.md](../../docs/contracts/branches-and-edit/branches-and-edit.md).

Подключение целиком: [docs/getting-started.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/getting-started.md).

Журнал изменений и что делать при обновлении: [CHANGELOG.md](./CHANGELOG.md). Все пакеты SDK выходят вместе и с одной версией; обновление — `pnpm update "@ykurilov/agent-chat-*" --latest`.

Контракты интеграции приложения: [HTTP-приветствие, текущий вопрос, номера фото, метаданные и тесты](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/app-chat-contracts.md).
