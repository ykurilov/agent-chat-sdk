import type { Pool } from "pg";
import type { SkillStore } from "./types";
import { createPostgresSkillStore } from "./store/postgres";
import { migrations } from "./drizzle-migrations-postgres.generated";

export { SKILLS_MIGRATION_LOCK_KEY, SKILLS_MIGRATIONS_TABLE } from "./store/migration-settings";
export { skillLoads, skills, skillVersions } from "./store/postgres-schema";


/**
 * Навыки в PostgreSQL на пуле приложения (схема `agent_chat`, та же база, что у хранилища чатов).
 * Таблицы приводятся к последней миграции при первом обращении. Пул закрывает приложение.
 */
export function postgresSkillStore(pool: Pool): SkillStore {
  return createPostgresSkillStore(pool, migrations);
}
