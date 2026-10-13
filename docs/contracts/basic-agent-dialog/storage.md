# Contract: интерфейс хранилища

Объявлен в `@ykurilov/agent-chat-core`. Реализации: хранилище в памяти (ядро, для тестов), SQLite
(`@ykurilov/agent-chat-storage-sqlite`) и PostgreSQL (`@ykurilov/agent-chat-storage-postgres`, фича 004). Все проходят
один набор проверок договора `describeChatStorageContract(createStorage)` из ядра. Порядок `listMessages` — по
`createdAt`, а при равном времени — в порядке записи (проверено набором с фичи 004).

```ts
interface ChatStorage {
  createChat(input: { id: string; ownerId: string; modelId: string; providerId: string }): Promise<Chat>
  getChat(chatId: string): Promise<Chat | null>
  /** Модель и провайдер последнего хода. */
  updateChatModel(chatId: string, model: { modelId: string; providerId: string }): Promise<void>

  /** Все сообщения чата по времени создания; ветку выбирает ядро. */
  listMessages(chatId: string): Promise<StoredMessage[]>

  /** Новое сообщение. Повтор id → ошибка DuplicateMessageError. */
  insertMessage(message: StoredMessage): Promise<void>

  /** Дописать идущий ответ. Только пока status = 'streaming', иначе ошибка. */
  updateStreamingMessage(
    messageId: string,
    patch: Pick<StoredMessage, "parts"> & Partial<Pick<StoredMessage, "usage" | "reasoningDurationsMs">>,
  ): Promise<void>

  /** Перевести ответ в конечное состояние. Только из 'streaming'. */
  finishMessage(
    messageId: string,
    final: { status: "complete" | "stopped" | "error" | "interrupted" } &
      Partial<Pick<StoredMessage, "parts" | "usage" | "reasoningDurationsMs" | "error">>,
  ): Promise<void>

  /** Все ответы в состоянии 'streaming' — для пометки 'interrupted' при старте. */
  listStreamingMessageIds(): Promise<string[]>
}
```

Типы `Chat` и `StoredMessage` — в [data-model.md](./data-model.md).

## Обязательства реализации

- Сообщения в конечном состоянии не меняются (FR-021): `updateStreamingMessage` и
  `finishMessage` на них — ошибка `MessageAlreadyFinishedError`.
- `insertMessage` в той же операции обновляет `updatedAt` чата.
- `parts` возвращаются в том же виде, в каком записаны (сравнение глубокое), включая
  `providerMetadata` у рассуждений (FR-005).
- Сообщение с `formatVersion` больше известной ядру при чтении — ошибка
  `UnsupportedFormatVersionError`; база не переписывается (принцип IV).
- Хранилище не проверяет владельца — это делает ядро до вызова хранилища.
