# Contracts: ветки и правка

## ChatStorage (ядро)

```ts
insertBranchSelection(record: StoredBranchSelection): Promise<void>
listBranchSelections(chatId: string): Promise<StoredBranchSelection[]>   // по порядку добавления
```

## Чистые функции (ядро, `conversation/branches.ts`)

```ts
selectCurrentBranch(messages, selections?): T[]
branchForks(messages, branch): BranchFork[]
nextSiblingTime(messages, selections, parentId, now?): string    // createdAt для нового соседа
loadCurrentBranch(storage, chatId): Promise<StoredMessage[]>
```

## ChatService (ядро)

```ts
getHistory(userId, chatId) → { chat, messages, running, compactions, compacting, forks }
getBranchForks(userId, chatId) → { forks }
selectBranch(userId, chatId, messageId) → ChatHistory     // ChatBusyError | InvalidMessageError
regenerate(userId, chatId, messageId) → ReadableStream    // ответ агента на текущей ветке
editMessage(userId, chatId, editedMessageId, message: IncomingUserMessage) → ReadableStream
```

## HTTP (server)

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /:chatId` | — | история + `forks` |
| `GET /:chatId/branches` | — | `{ forks }` |
| `POST /:chatId/branch` | `{ messageId }` | история (как `GET /:chatId`) |
| `POST /:chatId/regenerate` | `{ messageId }` | поток ответа |
| `POST /:chatId/edit` | `{ editedMessageId, message }` | поток ответа |

Ошибки: 400 `invalid` (нет сообщения, не та роль, не на ветке, пустой текст), 404 `not_found`, 409 `busy`.

## Скин (договор v6)

```ts
BranchSwitcher: ComponentType<{ position: number; count: number; onPrevious?: () => void; onNext?: () => void }>
   // position с 1; onPrevious/onNext нет на краях
MessageEditor: ComponentType<{ value: string; onValueChange(v: string): void; onSave(): void; onCancel(): void; canSave: boolean; error?: string; attachments?: MessageAttachmentsView }>
   // attachments — файлы правимого сообщения (только показать; при правке они остаются как были)
   // error — почему правку не удалось отправить (role="alert" под полем); текст в поле остаётся
UserMessage: { text; attachments?; branchSwitcher?: ReactNode; onEdit?: () => void }
AgentMessage: { …; branchSwitcher?: ReactNode; onRegenerate?: () => void }
```

Слой поведения кладёт `<skin.BranchSwitcher/>` в `branchSwitcher` сообщения, у которого есть соседи; `MessageEditor`
показывает вместо `UserMessage` на время правки.

## Хук (react)

```ts
useAgentChat(...) → { …, forks: BranchFork[], selectBranch(messageId), canRegenerate, regenerate(), canEdit, edit(messageId, text) → Promise<EditOutcome> }

// EditOutcome: { status: "started" } | { status: "not_started", reason: "busy" | "offline" | "empty" | "unknown_message" }
//            | { status: "refused", reason: "busy" | "invalid" | "not_found" }   (сервер ответил 409 / 400 / 404)
```

`edit` отвечает, как только сервер принял правку или отказал, не дожидаясь конца ответа. При отказе лента возвращается к прежнему
виду, и слой поведения оставляет поле правки открытым с текстом собеседника и ошибкой (`labels.editErrors`: `busy`, `offline`,
`rejected`). Сбой сети или 5xx без ответа сервера отказом не считается: правка остаётся в ленте, «Повторить» отправит её снова.
