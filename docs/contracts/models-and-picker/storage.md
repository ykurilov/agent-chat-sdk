# Contract: хранилище — дополнения 003

Дополняет [001](../basic-agent-dialog/storage.md).

```ts
interface Chat { …; reasoning?: string }                 // id уровня; нет — по умолчанию модели

interface ChatStorage {
  createChat(input: { id; ownerId; modelId; providerId; reasoning?: string }): Promise<Chat>
  updateChatModel(chatId: string, model: { modelId: string; providerId: string; reasoning?: string }): Promise<void>
  // остальное без изменений
}
```

- `updateChatModel` пишет выбор целиком: отсутствие `reasoning` стирает сохранённый уровень.
- Поле необязательное в типах, чтобы хранилища, написанные до 003, продолжали собираться; общие проверки
  `storage-contract` (`runStorageContract`) требуют, чтобы уровень сохранялся при `createChat` и
  `updateChatModel` и стирался при отсутствии. Хранилище, не сохраняющее поле, не проходит проверки.
- SQLite этого репозитория: столбец `chats.reasoning TEXT NULL`, миграция drizzle; старые строки — `NULL`.
- Хранилище в памяти ядра: то же поведение.
