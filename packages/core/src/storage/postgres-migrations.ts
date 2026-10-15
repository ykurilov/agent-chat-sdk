/** Соединение PostgreSQL, которое нужно помощнику миграций. Подходит `PoolClient` из `pg`: core от `pg` не зависит. */
export interface PostgresMigrationConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

export interface PostgresMigrationOptions<Connection extends PostgresMigrationConnection> {
  /** Новое соединение из пула, например `() => pool.connect()`; на каждую попытку — своё. */
  connect(): Promise<Connection>;
  /** Своя блокировка пакета: одновременно мигрирует только одна копия этого пакета. */
  lockKey: number;
  /** Миграции пакета на этом соединении, например `migrate(drizzle(connection), …)`. */
  migrate(connection: Connection): Promise<void>;
  /** Паузы перед повторами, если всё же столкнулись с соседом. */
  retryDelaysMs?: readonly number[];
}

/** Схема всех пакетов SDK. */
export const AGENT_CHAT_SCHEMA = "agent_chat";

/** Общая блокировка на создание схемы: одна на все пакеты, держится только на `create schema`. */
export const AGENT_CHAT_SCHEMA_LOCK_KEY = 7_311_900_441;

const DEFAULT_RETRY_DELAYS_MS = [25, 50, 100, 200];

/** Коды PostgreSQL «такое уже есть»: сосед создал то же самое одновременно с нами. */
const DUPLICATE_CODES = new Set(["23505", "42P06", "42P07", "42710"]);

/**
 * Создаёт схему `agent_chat` и применяет миграции пакета так, чтобы пакеты могли стартовать одновременно на пустой базе.
 * Схема создаётся под общей блокировкой, затем она отпускается и берётся своя блокировка пакета: блокировки не
 * вложены, поэтому взаимной блокировки нет, а разные пакеты ждут друг друга только на создании схемы.
 * Столкнулись всё же («уже есть») — повтор с начала на новом соединении.
 */
export async function migratePostgresSchema<Connection extends PostgresMigrationConnection>(options: PostgresMigrationOptions<Connection>): Promise<void> {
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await migrateOnce(options);
    } catch (error) {
      if (attempt >= delays.length || !isDuplicateError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

async function migrateOnce<Connection extends PostgresMigrationConnection>(options: PostgresMigrationOptions<Connection>): Promise<void> {
  const connection = await options.connect();
  try {
    if (!(await schemaExists(connection))) {
      await underLock(connection, AGENT_CHAT_SCHEMA_LOCK_KEY, () => connection.query(`create schema if not exists "${AGENT_CHAT_SCHEMA}"`));
    }
    await underLock(connection, options.lockKey, () => options.migrate(connection));
  } finally {
    connection.release();
  }
}

async function schemaExists(connection: PostgresMigrationConnection): Promise<boolean> {
  const result = await connection.query("select 1 from pg_namespace where nspname = $1", [AGENT_CHAT_SCHEMA]);
  return result.rows.length > 0;
}

async function underLock(connection: PostgresMigrationConnection, key: number, work: () => Promise<unknown>): Promise<void> {
  await connection.query("select pg_advisory_lock($1)", [key]);
  try {
    await work();
  } finally {
    await connection.query("select pg_advisory_unlock($1)", [key]);
  }
}

/** Ошибка «уже есть» — у самой ошибки или в цепочке причин (drizzle заворачивает ошибку `pg` в свою). */
function isDuplicateError(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; current = (current as { cause?: unknown }).cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && DUPLICATE_CODES.has(code)) return true;
  }
  return false;
}
