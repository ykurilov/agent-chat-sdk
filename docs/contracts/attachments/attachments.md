# Contracts: Вложения

## HTTP (под `createChatHandler`, префикс `/:chatId/attachments`)

| Метод и адрес | Ответ |
|---|---|
| `GET /attachments/settings` | `200 { maxFiles, maxFileBytes, accept: string }` |
| `POST /:chatId/attachments` (multipart, поле `file`) | `201 { id, name, mediaType, size, kind, textTruncated? }` |
| `GET /:chatId/attachments/:id` | байты; заголовки `nosniff`, `CSP: sandbox`, `Content-Disposition` (`inline` для картинок) |
| `DELETE /:chatId/attachments/:id` | `204`; `409`, если уже в сообщении |

Ошибки: `{ error: { kind } }`, `kind` ∈ `unsupported_type` (415), `too_large` (413), `empty` (400), `no_text` (422), `too_many` (400), `too_much_text` (422), `not_found` (404). Чужой чат и чужой файл — всегда `404`.

## Ядро: `MessageAttachments`

```ts
interface MessageAttachments {
  acceptUserParts(input: { userId; chatId; parts }): Promise<StoredPart[]>;   // бросает AttachmentRejectedError
  prepareHistory(input: { chatId; history; model: { profile; providerId } }): Promise<UIMessage[]>;
}
```

`ChatServiceOptions.attachments?`; `ChatService.assertOwnChat(userId, chatId)`; `ModelMenu…models[].acceptsImages`.

## Договор скина v5 (все свойства необязательные)

- `Composer.attachments?: { items: {id,name,kind,previewUrl?,status}[]; onAddFiles(files); onRemove(id); accept; notice?: string }`
- `UserMessage.attachments?: { label: string; items: {id,name,kind,url,mediaType,caption}[] }`

## Пакет

`createAttachments({ storage, limits? })` → `MessageAttachments & { handle(...) }`; `createMemoryAttachmentStorage()`, `createDiskAttachmentStorage({ directory })`, `describeAttachmentStorageContract`, `attachmentsInstructions`; `./react`: `attachmentsClient`.
