# Contract: `@ykurilov/agent-chat-storage-postgres`

```ts
import { createPostgresChatStorage } from "@ykurilov/agent-chat-storage-postgres";

const storage = await createPostgresChatStorage({
  connectionString: process.env.DATABASE_URL!, // postgres://user:pass@host:5432/db
  poolSize?: number,                           // по умолчанию 10
  logError?: (message: string) => void,        // обрывы соединения; по умолчанию console.error
});
// … await storage.close(); // при остановке сервера, после handler.flush()
```

- Возвращает `PostgresChatStorage = ChatStorage & { close(): Promise<void> }`.
- Порядок при создании: подключение (`select 1`) → блокировка → миграции → снятие блокировки.
- Ошибка подключения: `Error("Не удалось подключиться к PostgreSQL (хост:порт/база): …")`, без пароля.
- Поведение методов — [contracts/storage.md](../basic-agent-dialog/storage.md) и общий
  набор `describeChatStorageContract`; отличий от SQLite и памяти нет.
- Таблицы — только в схеме `agent_chat` (data-model.md).
