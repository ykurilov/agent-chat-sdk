import type { SkillStore } from "./types";
import { createSqliteSkillStore } from "./store/sqlite";
import { migrations } from "./drizzle-migrations-sqlite.generated";

export { SKILLS_MIGRATIONS_TABLE } from "./store/migration-settings";
export { skillLoads, skills, skillVersions } from "./store/sqlite-schema";


/**
 * Навыки в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблицы приводятся к последней миграции при открытии.
 */
export function sqliteSkillStore(filePath: string): SkillStore {
  return createSqliteSkillStore(filePath, migrations);
}
