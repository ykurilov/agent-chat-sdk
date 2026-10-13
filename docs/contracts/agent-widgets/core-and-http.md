# Договор: ядро и сервер (US1–US3)

## Настройка агента

```ts
createChatHandler({
  …,
  agent: {
    widgets?: {
      basic?: true | Array<"ask_choice" | "ask_multi_choice" | "ask_rating" | "ask_form" | "suggest_replies">, // true — все пять
      custom?: WidgetDescription[],   // из defineWidget, общий модуль сервера и страницы
    },
    diagrams?: boolean,               // строка diagramsInstructions в инструкции (contracts/diagrams.md)
  },
});
```

- Без `widgets` и `diagrams` запрос модели и поведение — как в 0.15 (SC-005): ни инструментов, ни строк в инструкции.
- Имена виджетов не пересекаются с `agent.tools` и `browserTools`: пересечение — исключение при создании службы.
- Свой виджет: имя `^[a-z][a-z0-9_]{0,63}$`, без префиксов `ask_` / `suggest_`, иначе исключение.
- Инструменты виджетов добавляются после инструментов приложения, по имени; описания постоянные (кэш, research 3).

## `defineWidget`

```ts
import { defineWidget } from "@ykurilov/agent-chat-core";
export const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Предложить человеку выбрать время встречи",
  inputSchema: z.object({ slots: z.array(z.string()).min(2).max(6) }),
  answerSchema: z.object({ slot: z.string() }),
  question: (input) => `Выберите время: ${input.slots.join(", ")}`,
});
```

Модуль не тянет серверных зависимостей: его импортирует и страница.

## Ход

- Вызов ждущего виджета — инструмент без `execute`; шаг кончается, ход сохраняет ответ со статусом `awaiting_approval`, если в частях есть запрос подтверждения **или** ждущий виджет без результата (`pendingHumanInput(parts)` вместо `pendingApprovals(parts)` в расчёте статуса, `run-agent-turn.ts`).
- Негодный вход виджета (схема) — `output-error` с причиной; модель видит её на следующем шаге, ход идёт дальше.
- Второй и следующие ждущие вызовы того же шага — `output-error` «Задавай один вопрос за раз».
- `suggest_replies` — `execute` возвращает `"показано"`.
- «Стоп», сбой и восстановление прерванного ответа закрывают ждущий виджет как сейчас закрываются вызовы без результата (`closeHangingToolCalls`): постоянный текст, модель видит «ответа не было».
- Перед запросом модели (`build-model-request.ts`) ждущий вызов без результата закрывается тем же путём — так уже устроено.

## Сообщение вместо ответа

`send` / правка сообщения, когда последний ответ ветки ждёт (FR-006):
1. Каждый ждущий виджет получает `output-available {"ответ":"сообщением"}`; запросы подтверждения закрываются как сейчас (`closeUnansweredApprovals`).
2. Ответ получает статус `complete` той же условной записью `updateAwaitingMessage`.
3. Сообщение человека уходит обычным ходом.

## Маршрут ответа

`POST {api}/:chatId/widgets/:toolCallId`, тело `{ "answer": <JSON> }`, не больше 16 КБ.

| Ответ | Когда |
|---|---|
| `200 { resumed: boolean }` (как у ответа на подтверждение): `true` — ход продолжился, его поток читается обычным `GET {api}/:chatId/stream`; `false` — ответ записан, но в ответе модели ждёт ещё что-то | ответ принят |
| `400 { error: { kind: "invalid_answer" } }` | не прошёл схему или больше 16 КБ, в теле нет `answer`, тело не JSON или длиннее 64 КБ; ничего не записано |
| `404 { error: { kind: "not_found" } }` | чат не этого человека или нет такого чата |
| `409 { error: { kind: "widget_not_pending" } }` | вызова нет, он уже отвечен, закрыт сообщением, не в последнем ответе текущей ветки, ответ не ждёт или виджета больше нет в настройках (ответить можно только сообщением) |
| `409 { error: { kind: "busy" } }` | в чате идёт ход |
| `429` `spending_limit_reached` / `too_many_turns` | лимит расходов или места хода — как у `answerApproval` |

Служба: `chatService.answerWidget({ chatId, ownerId, toolCallId, answer })` — в `whileStarting` чата; запись `updateAwaitingMessage`; если ждущих не осталось — `status: "streaming", alive: "now"` и `launchTurn({ resume })`; иначе только части. `MessageNotAwaitingError` → 409 `widget_not_pending`. Виды `widget_not_pending` и `invalid_answer` добавляются в список видов ошибок сервера рядом с `approval_not_pending`.

Каждый отказ — `logError("[виджет] отказ <вид> чат=<chatId> вызов=<toolCallId>")` без содержимого (FR-010a).

## Расход

`UsageSource` получает значение `"images"` (contracts/images.md). Других изменений расхода нет.
