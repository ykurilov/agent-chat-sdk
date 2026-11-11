/**
 * Миграция drizzle, вшитая в код пакета (`scripts/embed-migrations.mjs`): те же поля, что `readMigrationFiles` drizzle
 * читает из папки миграций, с теми же хешами. Файлы на диске пакету не нужны: бандлер Next.js принимал путь к папке за импорт,
 * а сборка `output: "standalone"` папку не копирует.
 */
export interface EmbeddedMigration {
  readonly sql: readonly string[];
  readonly bps: boolean;
  readonly folderMillis: number;
  readonly hash: string;
}

/** Где drizzle ведёт журнал миграций: как у `migrate` из `drizzle-orm/<драйвер>/migrator`. */
export interface EmbeddedMigrationConfig {
  migrationsTable?: string;
  migrationsSchema?: string;
}

interface DrizzleDatabase {
  dialect: { migrate(migrations: EmbeddedMigration[], session: unknown, config: EmbeddedMigrationConfig): Promise<void> | void };
  session: unknown;
}

/**
 * Применяет вшитые миграции к базе drizzle — ровно то, что делает `migrate` из `drizzle-orm/<драйвер>/migrator` после чтения
 * папки. Для PostgreSQL возвращает обещание, для SQLite (better-sqlite3) работает синхронно.
 */
export function applyEmbeddedMigrations(database: object, migrations: readonly EmbeddedMigration[], config: EmbeddedMigrationConfig = {}): Promise<void> | void {
  const drizzle = database as DrizzleDatabase;
  return drizzle.dialect.migrate([...migrations], drizzle.session, config);
}
