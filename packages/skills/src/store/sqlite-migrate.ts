import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";
import type Database from "better-sqlite3";

/**
 * Миграции drizzle, но журнал читается под замком записи, в одной транзакции с миграциями. drizzle читает журнал до своей
 * транзакции: вторая копия сервера на том же файле применила бы новую миграцию повторно и упала при запуске.
 * Порядок тот же, что у drizzle: применяются миграции новее последней записи журнала.
 */
export function migrateUnderWriteLock(sqlite: Database.Database, migrations: readonly EmbeddedMigration[], migrationsTable: string): void {
  sqlite
    .transaction(() => {
      sqlite.exec(`create table if not exists "${migrationsTable}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
      const last = sqlite.prepare(`select created_at from "${migrationsTable}" order by created_at desc limit 1`).get() as { created_at: number } | undefined;
      const record = sqlite.prepare(`insert into "${migrationsTable}" (hash, created_at) values (?, ?)`);
      for (const migration of migrations) {
        if (last !== undefined && Number(last.created_at) >= migration.folderMillis) continue;
        for (const statement of migration.sql) if (statement.trim()) sqlite.exec(statement);
        record.run(migration.hash, migration.folderMillis);
      }
    })
    .immediate();
}
