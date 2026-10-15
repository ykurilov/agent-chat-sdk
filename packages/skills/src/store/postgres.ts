import { and, count, desc, eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migratePostgresSchema } from "@ykurilov/agent-chat-core";
import type { Pool } from "pg";
import { SkillExistsError, SkillNotFoundError, SkillVersionConflictError } from "../types";
import type { Skill, SkillBrief, SkillLoad, SkillStore, SkillVersion } from "../types";
import { SKILLS_MIGRATION_LOCK_KEY, SKILLS_MIGRATIONS_TABLE } from "./migration-settings";
import { skillLoads, skills, skillVersions } from "./postgres-schema";
import { byName, sameText, storedText } from "./skill-store";

function toSkill(row: typeof skills.$inferSelect): Skill {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

const { body: _body, ...briefColumns } = getTableColumns(skills);

function toBrief(row: Omit<typeof skills.$inferSelect, "body">): SkillBrief {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function toVersion(row: typeof skillVersions.$inferSelect): SkillVersion {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function toLoad({ id: _id, ...row }: typeof skillLoads.$inferSelect): SkillLoad {
  return { ...row, loadedAt: row.loadedAt.toISOString() };
}

/**
 * Приводит таблицы навыков к последней миграции. Схема `agent_chat` создаётся под общей блокировкой всех пакетов, миграции — под своей:
 * копии пакета ждут друг друга, а разные пакеты стартуют разом на пустой базе без гонки за схему.
 */
export async function migrateSkillsToLatest(pool: Pool, migrationsFolder: string): Promise<void> {
  await migratePostgresSchema({
    connect: () => pool.connect(),
    lockKey: SKILLS_MIGRATION_LOCK_KEY,
    migrate: (client) => migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat", migrationsTable: SKILLS_MIGRATIONS_TABLE }),
  });
}

/**
 * Навыки в PostgreSQL (схема `agent_chat`) на пуле приложения. Миграция идёт при первом обращении, каждая операция
 * её дожидается. Правка и её версия — в одной транзакции с условием на номер версии. Пул закрывает приложение.
 */
export function createPostgresSkillStore(pool: Pool, migrationsFolder: string): SkillStore {
  const db = drizzle(pool);
  const ready = migrateSkillsToLatest(pool, migrationsFolder);
  // Ошибка миграции придёт в каждую операцию; без этого она всплыла бы ещё и как необработанная.
  ready.catch(() => {});

  async function get(name: string): Promise<Skill | null> {
    await ready;
    const [row] = await db.select().from(skills).where(eq(skills.name, name));
    return row ? toSkill(row) : null;
  }

  return {
    async list() {
      await ready;
      return (await db.select().from(skills)).map(toSkill).sort(byName);
    },
    async listBrief() {
      await ready;
      return (await db.select(briefColumns).from(skills)).map(toBrief).sort(byName);
    },
    get,
    async create(input, at) {
      await ready;
      const text = storedText(input);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(skills)
          .values({ name: input.name, ...text, status: input.status, version: 1, createdBy: input.author, createdAt: new Date(at), updatedBy: input.author, updatedAt: new Date(at) })
          .onConflictDoNothing()
          .returning();
        if (!row) throw new SkillExistsError(input.name);
        await tx.insert(skillVersions).values({ name: input.name, version: 1, ...text, author: input.author, createdAt: new Date(at) });
        return toSkill(row);
      });
    },
    async updateText(name, edit, at) {
      await ready;
      const text = storedText(edit);
      return db.transaction(async (tx) => {
        const [current] = await tx.select().from(skills).where(eq(skills.name, name));
        if (!current) throw new SkillNotFoundError(name);
        if (current.version !== edit.expectedVersion) throw new SkillVersionConflictError(name, current.version);
        if (sameText(toSkill(current), text)) return toSkill(current);
        const version = current.version + 1;
        // Условие на версию — в том же `update … where`: соперник, успевший первым, оставит здесь ноль строк.
        const [row] = await tx
          .update(skills)
          .set({ ...text, version, updatedBy: edit.author, updatedAt: new Date(at) })
          .where(and(eq(skills.name, name), eq(skills.version, edit.expectedVersion)))
          .returning();
        if (!row) {
          const [latest] = await db.select({ version: skills.version }).from(skills).where(eq(skills.name, name));
          if (!latest) throw new SkillNotFoundError(name);
          throw new SkillVersionConflictError(name, latest.version);
        }
        await tx.insert(skillVersions).values({ name, version, ...text, author: edit.author, createdAt: new Date(at) });
        return toSkill(row);
      });
    },
    async setStatus(name, status, author, at) {
      await ready;
      const [row] = await db.update(skills).set({ status, updatedBy: author, updatedAt: new Date(at) }).where(eq(skills.name, name)).returning();
      if (!row) throw new SkillNotFoundError(name);
      return toSkill(row);
    },
    async delete(name) {
      await ready;
      return db.transaction(async (tx) => {
        await tx.delete(skillLoads).where(eq(skillLoads.name, name));
        await tx.delete(skillVersions).where(eq(skillVersions.name, name));
        const removed = await tx.delete(skills).where(eq(skills.name, name)).returning({ name: skills.name });
        return removed.length > 0;
      });
    },
    async listVersions(name) {
      await ready;
      return (await db.select().from(skillVersions).where(eq(skillVersions.name, name)).orderBy(desc(skillVersions.version))).map(toVersion);
    },
    async getVersion(name, version) {
      await ready;
      const [row] = await db.select().from(skillVersions).where(and(eq(skillVersions.name, name), eq(skillVersions.version, version)));
      return row ? toVersion(row) : null;
    },
    async recordLoad(load) {
      await ready;
      await db.insert(skillLoads).values({ ...load, loadedAt: new Date(load.loadedAt) });
    },
    async loadStats(name, limit) {
      await ready;
      const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(skillLoads).where(eq(skillLoads.name, name));
      const recent = await db.select().from(skillLoads).where(eq(skillLoads.name, name)).orderBy(desc(skillLoads.loadedAt), desc(skillLoads.id)).limit(limit);
      return { total, recent: recent.map(toLoad) };
    },
    async loadCounts() {
      await ready;
      const rows = await db.select({ name: skillLoads.name, total: count() }).from(skillLoads).groupBy(skillLoads.name);
      return Object.fromEntries(rows.map((row) => [row.name, row.total]));
    },
  };
}
