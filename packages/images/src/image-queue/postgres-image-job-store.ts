import { and, asc, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { applyImageJobPatch, findErrorCause, ImageJobKeyTakenError, imageJobBody, isOpenImageJob } from "./image-job-store";
import type { ImageJobFilter, ImageJobRecord, ImageJobStore } from "./image-job-store";
import { IMAGE_JOBS_MIGRATION_LOCK_KEY, IMAGE_JOBS_MIGRATIONS_TABLE } from "./migration-settings";
import { imageJobs } from "./postgres-schema";

type Row = typeof imageJobs.$inferSelect;

const toDate = (iso: string | undefined) => (iso === undefined ? null : new Date(iso));
const toIso = (date: Date | null) => (date === null ? undefined : date.toISOString());

/** PostgreSQL не хранит символ NUL ни в тексте, ни в jsonb: убираем его до записи. */
function withoutNul<T>(value: T): T {
  if (typeof value === "string") return value.replaceAll("\u0000", "") as T;
  if (Array.isArray(value)) return value.map(withoutNul) as T;
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [withoutNul(key), withoutNul(item)])) as T;
  return value;
}

function toRecord(row: Row): ImageJobRecord {
  const record: Record<string, unknown> = {
    ...row.body,
    id: row.id,
    key: row.key,
    ownerId: row.ownerId,
    chatId: row.chatId,
    group: row.group ?? undefined,
    status: row.status,
    active: row.active,
    leaseOwner: row.leaseOwner ?? undefined,
    leaseUntil: toIso(row.leaseUntil),
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    finishedAt: toIso(row.finishedAt),
  };
  for (const [field, value] of Object.entries(record)) if (value === undefined) delete record[field];
  return record as unknown as ImageJobRecord;
}

function toRow(job: ImageJobRecord): Row {
  const clean = withoutNul(job);
  return {
    id: clean.id,
    key: clean.key,
    ownerId: clean.ownerId,
    chatId: clean.chatId,
    group: clean.group ?? null,
    status: clean.status,
    active: clean.active,
    open: isOpenImageJob(clean),
    leaseOwner: clean.leaseOwner ?? null,
    leaseUntil: toDate(clean.leaseUntil),
    version: clean.version,
    createdAt: toDate(clean.createdAt)!,
    updatedAt: toDate(clean.updatedAt)!,
    finishedAt: toDate(clean.finishedAt),
    body: imageJobBody(clean),
  };
}

/** Вторая открытая задача на место: её не пускает уникальный индекс `image_jobs_open_key_idx`. */
function placeTaken(error: unknown, job: ImageJobRecord): never {
  if (findErrorCause(error, (cause) => cause.code === "23505" && cause.constraint === "image_jobs_open_key_idx")) throw new ImageJobKeyTakenError(job.ownerId, job.key);
  throw error;
}

function filterOf(filter: ImageJobFilter): SQL | undefined {
  return and(
    filter.ownerId !== undefined ? eq(imageJobs.ownerId, filter.ownerId) : undefined,
    filter.chatId !== undefined ? eq(imageJobs.chatId, filter.chatId) : undefined,
    filter.key !== undefined ? eq(imageJobs.key, filter.key) : undefined,
    filter.group !== undefined ? eq(imageJobs.group, filter.group) : undefined,
  );
}

/** Приводит таблицу задач к последней миграции под блокировкой базы: серверы, стартующие разом, не мешают друг другу. */
async function migrateImageJobsToLatest(pool: Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [IMAGE_JOBS_MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat", migrationsTable: IMAGE_JOBS_MIGRATIONS_TABLE });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [IMAGE_JOBS_MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * Задачи картинок в PostgreSQL (схема `agent_chat`) на пуле приложения. Миграция — при первом обращении, каждая операция
 * её дожидается. Правка — условное `update … where version = …`: из двух одновременных пройдёт одна. Пул закрывает
 * приложение.
 */
export function createPostgresImageJobStore(pool: Pool, migrationsFolder: string): ImageJobStore {
  const db = drizzle(pool);
  const ready = migrateImageJobsToLatest(pool, migrationsFolder);
  // Ошибка миграции придёт в каждую операцию; без этого она всплыла бы ещё и как необработанная.
  ready.catch(() => {});

  async function get(id: string): Promise<ImageJobRecord | null> {
    await ready;
    const [row] = await db.select().from(imageJobs).where(eq(imageJobs.id, id));
    return row ? toRecord(row) : null;
  }

  return {
    async insert(job) {
      await ready;
      await db
        .insert(imageJobs)
        .values(toRow(job))
        .catch((error: unknown) => placeTaken(error, job));
    },
    get,
    async list(filter) {
      await ready;
      const rows = await db.select().from(imageJobs).where(filterOf(filter)).orderBy(asc(imageJobs.createdAt), asc(imageJobs.id));
      return rows.map(toRecord);
    },
    async update(id, patch, expectedVersion) {
      const job = await get(id);
      if (!job || job.version !== expectedVersion) return null;
      const next = { ...applyImageJobPatch(job, patch), version: expectedVersion + 1 };
      const { id: _id, ...columns } = toRow(next);
      const [row] = await db
        .update(imageJobs)
        .set(columns)
        .where(and(eq(imageJobs.id, id), eq(imageJobs.version, expectedVersion)))
        .returning()
        .catch((error: unknown) => placeTaken(error, next));
      return row ? toRecord(row) : null;
    },
    async listResumable(now) {
      await ready;
      const rows = await db
        .select()
        .from(imageJobs)
        .where(and(eq(imageJobs.active, true), or(isNull(imageJobs.leaseUntil), lt(imageJobs.leaseUntil, new Date(now)))))
        .orderBy(asc(imageJobs.createdAt));
      return rows.map(toRecord);
    },
    async deleteFinishedBefore(before) {
      await ready;
      const deleted = await db
        .delete(imageJobs)
        .where(and(eq(imageJobs.active, false), ne(imageJobs.status, "generating"), isNotNull(imageJobs.finishedAt), lt(imageJobs.finishedAt, new Date(before))))
        .returning({ id: imageJobs.id });
      return deleted.length;
    },
    async close() {
      // Дожидаемся миграции: пул приложения можно закрывать сразу после.
      await ready.catch(() => {});
    },
  };
}
