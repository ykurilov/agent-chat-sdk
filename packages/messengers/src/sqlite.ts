import Database from "better-sqlite3";
import { createSqliteMessengerStore as openSqliteMessengerStore } from "./store/sqlite-store";
import type { ClosableMessengerStore } from "./types";
import { migrations } from "./drizzle-migrations-sqlite.generated";

export { MESSENGERS_MIGRATIONS_TABLE } from "./store/migration-settings";
export * from "./store/sqlite-schema";
export type { ClosableMessengerStore, MessengerStore } from "./types";


/**
 * Хранилище мессенджеров в файле SQLite; файл может быть тем же, что у `createSqliteChatStorage`. Схема приводится к последней миграции.
 * `close()` закрывает файл (при остановке сервера после `messengers.stop()`); не удалось подготовить — файл закрывается до ошибки.
 */
export async function createSqliteMessengerStore(options: { filePath: string }): Promise<ClosableMessengerStore> {
  const sqlite = new Database(options.filePath);
  try {
    sqlite.pragma("journal_mode = WAL");
    // Хранилище чатов и мессенджеры открывают один файл: при блокировке второй ждёт, а не падает.
    sqlite.pragma("busy_timeout = 5000");
    return openSqliteMessengerStore(sqlite, migrations);
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
