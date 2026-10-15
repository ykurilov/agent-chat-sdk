import { fileURLToPath } from "node:url";
import type { SkillStore } from "./types";
import { createSqliteSkillStore } from "./store/sqlite";

export { SKILLS_MIGRATIONS_TABLE } from "./store/migration-settings";
export { skillLoads, skills, skillVersions } from "./store/sqlite-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/sqlite`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/sqlite", import.meta.url));

/**
 * Навыки в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблицы приводятся к последней миграции при открытии.
 */
export function sqliteSkillStore(filePath: string): SkillStore {
  return createSqliteSkillStore(filePath, MIGRATIONS_FOLDER);
}
