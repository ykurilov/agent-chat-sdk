/** Своя таблица учёта: хранилище чатов и песочница живут в той же базе и ведут свои. */
export const BACKGROUND_MIGRATIONS_TABLE = "__background_migrations";

/** Постоянное число для блокировки базы миграциями фона; не совпадает с ключами ядра (…443 — песочница) и мессенджеров (…445). */
export const BACKGROUND_MIGRATION_LOCK_KEY = 7_311_900_444;
