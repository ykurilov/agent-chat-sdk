# Контракты: подтверждение действий

## HTTP

`POST /:chatId/approvals/:approvalId`, тело `{ "decision": "allow" | "deny" | "always" }`.

Ответ 200: `{ "resumed": boolean }` — `true`, если ход продолжился (другие ответы ещё ждут — `false`).

Ошибки:

- 400 `invalid` — тело;
- 404 — чат чужой или его нет;
- 409 `approval_not_pending` — такого ожидающего запроса нет или он уже решён (отвечать нечем);
- 409 `busy` — в чате уже идёт ход;
- 429 `spending_limit_reached` — лимит расходов исчерпан; запрос остаётся ждать, карточка на месте.

Продолжение читается обычным `GET /:chatId/stream`.

## Статус и части

Статус ответа `awaiting_approval`: в сообщении есть часть `tool-<имя>` в состоянии `approval-requested` (`approval.id`). Решение: `approval-responded` (`approved`, `reason`; «всегда» — `reason: "always-in-chat"`), после хода — `output-available` или `output-denied`.

Метка «Всегда доступна»: `approval.requestReason === "always-offered"` в части `approval-requested`. Ставится только для инструмента с `needsApproval: true`; для функции метки нет, а «always» в теле запроса тогда считается «allow».

Причины закрытия без ответа человека: `INTERRUPTED_REASON` (вызов не выполнялся: сбой или «Стоп» до выполнения) и `RESULT_UNKNOWN_REASON` (разрешённый инструмент мог сработать, итог неизвестен).

## Хранилище

- `updateAwaitingMessage(messageId, { parts, status?: "streaming" | "complete" })` — только из `awaiting_approval`, иначе `MessageNotAwaitingError`.
- `getMessage(messageId)` — сообщение по номеру или `null`; нужно восстановлению после сбоя и продолжению (модель ждущего сообщения).

## Договор скина v9

(v8 занят лимитами расходов.) `ToolCallRow` получает необязательные `title?: string` и `approval?: ToolApprovalView`:
`{ state: "requested", onDecide(decision), pending: boolean, failed: boolean, failureText?: string, canAlways: boolean } | { state: "allowed" | "always" | "denied" }`.

Хук `useAgentChat`: `respondToApproval`, `approvalPendingId`, `approvalFailure` (`{ id, kind }`, kind — нет связи, чат занят, лимит, запрос не ждёт).
