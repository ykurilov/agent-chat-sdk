import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { JournalOptions } from "./journal/journal";
import { createSandboxJournal } from "./journal/journal";
import { createSqliteJournalStore } from "./journal/sqlite-journal";
import type { SandboxJournal } from "./types";

export type { LogError, SandboxJournal } from "./types";

export type SqliteSandboxJournalOptions = JournalOptions & {
  /** Файл SQLite; может быть тем же, что у `createSqliteChatStorage`. */
  filePath: string;
};

const migrationsFolder = fileURLToPath(new URL("../drizzle/sqlite", import.meta.url));

/** Журнал песочницы в файле SQLite. Схема приводится к последней миграции при открытии. */
export async function createSqliteSandboxJournal(options: SqliteSandboxJournalOptions): Promise<SandboxJournal> {
  const sqlite = new Database(options.filePath);
  try {
    sqlite.pragma("journal_mode = WAL");
    // Хранилище чатов и журнал открывают один файл: при блокировке второй ждёт, а не падает.
    sqlite.pragma("busy_timeout = 5000");
    return createSandboxJournal(createSqliteJournalStore(sqlite, migrationsFolder), options);
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
