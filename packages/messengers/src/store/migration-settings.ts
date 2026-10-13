/** Своя таблица учёта: хранилище чатов, песочница и фон живут в той же базе и ведут свои. */
export const MESSENGERS_MIGRATIONS_TABLE = "__messengers_migrations";

/** Постоянное число для блокировки базы миграциями мессенджеров; не совпадает с ключами песочницы (…443) и фона (…444). */
export const MESSENGERS_MIGRATION_LOCK_KEY = 7_311_900_445;
