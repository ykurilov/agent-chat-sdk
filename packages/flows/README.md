# @ykurilov/agent-chat-flows

Сценарии поведения агента. Разговор идёт по карте шагов — состояний. У каждого состояния своя короткая инструкция и
условия выхода: словами (решает судья), по данным, по событию или по таймеру. Агент помнит карточку клиента между
чатами и пишет первым, когда сработал таймер. Сценарий может идти по дням («программа на 3 дня»): ночь, касания, рамки
дня, срок. Автор рисует сценарий в редакторе, проверяет и прогоняет его.

Полное описание простыми словами, с примерами и замерами: [docs/flows.md](../../docs/flows.md).

## Подключить

```bash
pnpm add @ykurilov/agent-chat-flows
```

```ts
import { createAgentFlow } from "@ykurilov/agent-chat-flows";
import { sqliteFlowStore } from "@ykurilov/agent-chat-flows/sqlite";

const flow = createAgentFlow({
  loadFlow: async ({ ownerId, chat }) => ({ flowId: "sales-review", versionId: "3", flow: publishedJson }),
  store: sqliteFlowStore("./data/chat.db"),
  judge: { fallback: { modelId: "deepseek-4.1-flash", providerId: "deepseek" } },
});

const { handler, service } = createChatServer(flow.withChat({ ...chatOptions, agent: { instructions, tools } }));
flow.attach(service);
flow.start();
```

Судья — `microsoft/microsoft-decision-1` через OpenRouter: нужен `OPENROUTER_API_KEY` на сервере. Запасная модель
(`judge.fallback`) — из каталога приложения.

## Настройки `createAgentFlow`

| Настройка | Что это | По умолчанию |
|---|---|---|
| `loadFlow` | сценарий нового чата: `{ flowId, versionId, flow }` или `null` — без сценария. Перенос чата: `stateId`, `startedAt`, `enteredAt` | обязательна |
| `store` | `memoryFlowStore()`, `sqliteFlowStore(path)`, `postgresFlowStore(pool)` | обязательна |
| `judge.fallback` | запасная модель судьи из каталога | обязательна |
| `judge.model`, `judge.threshold`, `judge.timeoutMs` | основной судья, порог «выполнено», срок | decision-1, 0,7, 5000 мс |
| `judge.openrouter` | `{ apiKey, baseUrl, headers }`: свой прокси и его заголовки | из окружения |
| `firstMessages` | тихие часы, потолок в сутки, `canWriteNow`; `false` — без часов и потолка. `canWriteNow` → `false` — «не сейчас», касание через час, `{ retryAt }` — в свой момент; конец разговора от него не зависит. «Дни и время» сценария главнее | 21:00–09:00, 3 в сутки |
| `onTransition` | каждый переход: `from`, `to`, `exitId`, `decidedBy`, `tags`, `reason`, `day` | — |
| `onFinish` | конец разговора: `reason` (`final`, `deadline`, `abandoned`, `blocked`), `day`, `state`, `tags`, `run` | — |
| `clientCard` | карточка клиента в базе приложения: `read`, `write`, `forget` | таблица модуля |
| `clientFacts` | свободные факты о человеке в карточке («ведёт блог»): `flow_note { fact }`, список в блоке `flow:client`, «забудь» стирает. Свои таблицы фактов — `clientCard.facts`; правило делит факты (карточка) и правила общения (память SDK) | выключено |
| `people` | пояс человека в базе приложения: `readTimeZone`, `writeTimeZone` | таблица модуля |
| `defaultTimeZone` | пояс, пока пояс человека неизвестен: человек → страница → он → `agent.timeZone` → сервер | — |
| `pause.staffSilenceHours` | через сколько часов молчания сотрудника пауза снимается сама | 2 |
| `timers` | `tickMs` — как часто смотреть таймеры, `leaseMs` — аренда копией сервера | 15 000 и 60 000 мс |
| `logError` | строки журнала | `console.error` |
| `now` | часы: тесты подменяют время целиком | сейчас |

Что есть у `flow`: `withChat`, `attach`, `start`, `stop`, `settled`, `signal`, `adopt`, `end`, `admit`, `pause`, `resume`,
`noteStaffReply` (реплика сотрудника — путём `service.appendStaffMessage`), `reportDelivery`, `readRun`, `chatsByState`,
`migrateChats`, `readClientCard`, `forgetClientCard`, `advanceTestClock`, `tick` (один обход таймеров: тесты, свой
планировщик). Из пакета — ещё `factId(text)`: id факта карточки.

- `attach(service)` — одна служба на всё приложение. `attach({ portFor, deliver })` — служба на чат и своя доставка
  того, что агент пишет первым. `deliver` получает текст (`text`) и все части ответа для человека (`parts`: карточка
  ролика, картинка, файл, виджет — с 0.53) и возвращает исход: `delivered`, `retry`, `window_closed`, `blocked`, `failed`.
- Каналы SDK сообщают исход сами: `createMessengers({ onAnswerDelivery: (report) => flow.reportDelivery(report) })`.
- Недоставленное касание (`failed`, `window_closed`) не засчитывается: тот же шаг повторится через свой срок от момента
  отказа. Пока ждёт повтор доставки, новых ходов нет.
- Свой канал перед ходом зовёт `flow.admit`: ответить, ответить готовой фразой, промолчать до утра (после жёсткой рамки
  дня), разговор закончен или отвечает сотрудник. Ночью агент человеку отвечает.
- `flow.adopt` переносит идущий чат из вашей системы сразу, без хода: место, последние реплики, шаг касаний, счёт дня.
- `flow.end({ reason: "switched" })` заканчивает разговор со своей причиной: `onFinish`, как у остальных концов.

- Место чата (ключ `flow` в состоянии) посетителю не уходит: SDK прячет его сам (`privateStateKeys`). Читайте его
  через `flow.readRun`.
- В групповых чатах сценарий выключен. Сотрудник в песочнице карточку клиента только читает.
- Лимит расходов проверяется до каждого обращения к судье: исчерпан — запроса нет, условие «не проверено».
- `attach` ждёт службу чата с `assertWithinLimit` — её даёт `createChatServer` этой версии.

## Тестовый чат

`FlowTestChat` ждёт от приложения `start`, `advance`, `readRun` и `renderChat` (`FlowTestChatConnection`). На сервере это
`service.createChat(userId, { data: flowTestChatData() })`, `flow.advanceTestClock` и `flow.readRun`. Кнопка «К началу
следующего дня» — необязательный `advanceToNextDay`: на сервере `flow.advanceTestClock({ ownerId, chatId, to:
"next_day_start" })`.

`FlowEditor`: `readOnly` — доска только для просмотра, пока сценарий правит внешний агент; `onSave` может вернуть
`{ ok: false, issues }` — отказ без исключения, находки встают у нод; `className` и `style` идут на корень, высота по
умолчанию — родителя, не меньше разумной. Подробно — [docs/flows.md](../../docs/flows.md).

Свои проверки приложения: `checks` у `FlowEditor` и `FlowTestChat`, на сервере те же — `checkFlow(flow, catalog, {
checks })`. Поля приложения для карточки и попутных задач — `catalog.fields`.

Эндпоинты тестового чата (advanceTestClock, readRun) приложение закрывает правами само: только редактору и только для
тестовых чатов.

## Входы

| Вход | Что внутри |
|---|---|
| `.` | сервер: `createAgentFlow`, `memoryFlowStore`, `flowTestChatData`, всё из `./format` |
| `./format` | формат (`parseFlow`, `compactFlow`), проверка (`checkFlow`, `FlowAppChecks`), движок — без серверных зависимостей, для браузера |
| `./react` | `FlowEditor`, `FlowTestChat`, `ClientCardPanel`, договоры скинов, надписи ru/en |
| `./sqlite`, `./postgres` | хранилище сценариев в базе приложения |
| `./agent-flow.schema.json` | JSON Schema формата для внешних редакторов и агентов |

Скины Тандема: `@ykurilov/agent-chat-skin-tandem/flows` (`tandemFlowEditorSkin`) и
`@ykurilov/agent-chat-skin-tandem/client-card` (`tandemClientCardSkin`).

## Хранилище

Своё хранилище реализует договор `FlowStore`. С 0.49 в нём ещё `renewLease()` — продлить аренду чата перед ходом и во
время него — и `setDue(chatId, due, { unlessDelivery })` — не затирать срок повтора доставки. Обход таймеров идёт до 5
ходов одновременно.

Таблицы `flow_chats`, `flow_versions`, `flow_client_cards`, `flow_first_messages`, `flow_people`, `flow_side_tasks` и свой журнал миграций
`__flows_migrations`. Создаются сами при первом обращении. SQLite — файл может быть общим с чатами. PostgreSQL —
схема `agent_chat` на пуле приложения, пул закрывает приложение.

## Формат версии 2

С 0.49 сценарий пишется версией 2: «Дни и время» (`schedule`), касания (`nudges` у сценария и у состояния), таймер
`state_days`, поле «да/нет» (`boolean`), попутные задачи (`sideTasks`), режим после конца (`afterEnd`). Версия 1
читается и переводится сама. Версия 0.48 JSON версии 2 не откроет. Образец со всеми частями —
[demo/three-day-program.json](demo/three-day-program.json).
