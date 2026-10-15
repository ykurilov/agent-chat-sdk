import Database from "better-sqlite3";
import { and, count, desc, eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { SkillExistsError, SkillNotFoundError, SkillVersionConflictError } from "../types";
import type { Skill, SkillBrief, SkillLoad, SkillStore, SkillVersion } from "../types";
import { SKILLS_MIGRATIONS_TABLE } from "./migration-settings";
import { skillLoads, skills, skillVersions } from "./sqlite-schema";
import { byName, sameText, storedText } from "./skill-store";

const toMs = (iso: string) => Date.parse(iso);
const toIso = (ms: number) => new Date(ms).toISOString();

function toSkill(row: typeof skills.$inferSelect): Skill {
  return { ...row, createdAt: toIso(row.createdAt), updatedAt: toIso(row.updatedAt) };
}

const { body: _body, ...briefColumns } = getTableColumns(skills);

function toBrief(row: Omit<typeof skills.$inferSelect, "body">): SkillBrief {
  return { ...row, createdAt: toIso(row.createdAt), updatedAt: toIso(row.updatedAt) };
}

function toVersion(row: typeof skillVersions.$inferSelect): SkillVersion {
  return { ...row, createdAt: toIso(row.createdAt) };
}

function toLoad({ id: _id, ...row }: typeof skillLoads.$inferSelect): SkillLoad {
  return { ...row, loadedAt: toIso(row.loadedAt) };
}

/**
 * Навыки в файле SQLite. Схема приводится к последней миграции при открытии; файл может быть общим с хранилищем
 * чатов. Правка и её версия — в одной транзакции.
 */
export function createSqliteSkillStore(filePath: string, migrationsFolder: string): SkillStore {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder, migrationsTable: SKILLS_MIGRATIONS_TABLE });

  const read = (name: string) => db.select().from(skills).where(eq(skills.name, name)).get();
  const existing = (name: string) => {
    const row = read(name);
    if (!row) throw new SkillNotFoundError(name);
    return row;
  };

  return {
    async list() {
      return db.select().from(skills).all().map(toSkill).sort(byName);
    },
    async listBrief() {
      return db.select(briefColumns).from(skills).all().map(toBrief).sort(byName);
    },
    async get(name) {
      const row = read(name);
      return row ? toSkill(row) : null;
    },
    async create(input, at) {
      const text = storedText(input);
      return db.transaction((tx) => {
        const row = tx
          .insert(skills)
          .values({ name: input.name, ...text, status: input.status, version: 1, createdBy: input.author, createdAt: toMs(at), updatedBy: input.author, updatedAt: toMs(at) })
          .onConflictDoNothing()
          .returning()
          .get();
        if (!row) throw new SkillExistsError(input.name);
        tx.insert(skillVersions).values({ name: input.name, version: 1, ...text, author: input.author, createdAt: toMs(at) }).run();
        return toSkill(row);
      }, { behavior: "immediate" });
    },
    async updateText(name, edit, at) {
      const text = storedText(edit);
      return db.transaction((tx) => {
        const current = existing(name);
        if (current.version !== edit.expectedVersion) throw new SkillVersionConflictError(name, current.version);
        if (sameText(toSkill(current), text)) return toSkill(current);
        const version = current.version + 1;
        const row = tx
          .update(skills)
          .set({ ...text, version, updatedBy: edit.author, updatedAt: toMs(at) })
          .where(and(eq(skills.name, name), eq(skills.version, edit.expectedVersion)))
          .returning()
          .get()!;
        tx.insert(skillVersions).values({ name, version, ...text, author: edit.author, createdAt: toMs(at) }).run();
        return toSkill(row);
      }, { behavior: "immediate" });
    },
    async setStatus(name, status, author, at) {
      const row = db.update(skills).set({ status, updatedBy: author, updatedAt: toMs(at) }).where(eq(skills.name, name)).returning().get();
      if (!row) throw new SkillNotFoundError(name);
      return toSkill(row);
    },
    async delete(name) {
      return db.transaction((tx) => {
        tx.delete(skillLoads).where(eq(skillLoads.name, name)).run();
        tx.delete(skillVersions).where(eq(skillVersions.name, name)).run();
        return tx.delete(skills).where(eq(skills.name, name)).run().changes > 0;
      });
    },
    async listVersions(name) {
      return db.select().from(skillVersions).where(eq(skillVersions.name, name)).orderBy(desc(skillVersions.version)).all().map(toVersion);
    },
    async getVersion(name, version) {
      const row = db.select().from(skillVersions).where(and(eq(skillVersions.name, name), eq(skillVersions.version, version))).get();
      return row ? toVersion(row) : null;
    },
    async recordLoad(load) {
      db.insert(skillLoads).values({ ...load, loadedAt: toMs(load.loadedAt) }).run();
    },
    async loadStats(name, limit) {
      const total = db.select({ total: count() }).from(skillLoads).where(eq(skillLoads.name, name)).get()?.total ?? 0;
      const recent = db.select().from(skillLoads).where(eq(skillLoads.name, name)).orderBy(desc(skillLoads.loadedAt), desc(skillLoads.id)).limit(limit).all();
      return { total, recent: recent.map(toLoad) };
    },
    async loadCounts() {
      const rows = db.select({ name: skillLoads.name, total: count() }).from(skillLoads).groupBy(skillLoads.name).all();
      return Object.fromEntries(rows.map((row) => [row.name, row.total]));
    },
  };
}
