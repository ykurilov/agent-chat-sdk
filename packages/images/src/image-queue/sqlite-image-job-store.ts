import Database from "better-sqlite3";
import { and, asc, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { applyImageJobPatch, findErrorCause, ImageJobKeyTakenError, imageJobBody, isOpenImageJob } from "./image-job-store";
import type { ImageJobFilter, ImageJobRecord, ImageJobStore } from "./image-job-store";
import { IMAGE_JOBS_MIGRATIONS_TABLE } from "./migration-settings";
import { imageJobs } from "./sqlite-schema";

type Row = typeof imageJobs.$inferSelect;

const toMs = (iso: string | undefined) => (iso === undefined ? null : Date.parse(iso));
const toIso = (ms: number | null) => (ms === null ? undefined : new Date(ms).toISOString());

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
  return {
    id: job.id,
    key: job.key,
    ownerId: job.ownerId,
    chatId: job.chatId,
    group: job.group ?? null,
    status: job.status,
    active: job.active,
    open: isOpenImageJob(job),
    leaseOwner: job.leaseOwner ?? null,
    leaseUntil: toMs(job.leaseUntil),
    version: job.version,
    createdAt: toMs(job.createdAt)!,
    updatedAt: toMs(job.updatedAt)!,
    finishedAt: toMs(job.finishedAt),
    body: imageJobBody(job),
  };
}

/** Вторая открытая задача на место: её не пускает уникальный индекс `image_jobs_open_key_idx`. */
function placeTaken(error: unknown, job: ImageJobRecord): never {
  // Первичный ключ даёт SQLITE_CONSTRAINT_PRIMARYKEY, так что UNIQUE в этой таблице — только индекс открытых задач.
  if (findErrorCause(error, (cause) => cause.code === "SQLITE_CONSTRAINT_UNIQUE")) throw new ImageJobKeyTakenError(job.ownerId, job.key);
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

/**
 * Задачи картинок в файле SQLite; файл может быть общим с хранилищем чатов. Схема приводится к последней миграции при
 * открытии. Правка — чтение и условная запись по версии в одной транзакции с блокировкой записи (`immediate`).
 */
export function createSqliteImageJobStore(filePath: string, migrationsFolder: string): ImageJobStore {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder, migrationsTable: IMAGE_JOBS_MIGRATIONS_TABLE });

  const read = (id: string) => {
    const row = db.select().from(imageJobs).where(eq(imageJobs.id, id)).get();
    return row ? toRecord(row) : null;
  };

  const update = sqlite.transaction((id: string, patch: Parameters<ImageJobStore["update"]>[1], expectedVersion: number) => {
    const job = read(id);
    if (!job || job.version !== expectedVersion) return null;
    const next = { ...applyImageJobPatch(job, patch), version: expectedVersion + 1 };
    const { id: _id, ...columns } = toRow(next);
    let changed: { changes: number };
    try {
      changed = db
        .update(imageJobs)
        .set(columns)
        .where(and(eq(imageJobs.id, id), eq(imageJobs.version, expectedVersion)))
        .run();
    } catch (error) {
      placeTaken(error, next);
    }
    return changed.changes > 0 ? next : null;
  });

  return {
    async insert(job) {
      try {
        db.insert(imageJobs).values(toRow(job)).run();
      } catch (error) {
        placeTaken(error, job);
      }
    },
    async get(id) {
      return read(id);
    },
    async list(filter) {
      return db.select().from(imageJobs).where(filterOf(filter)).orderBy(asc(imageJobs.createdAt), asc(imageJobs.id)).all().map(toRecord);
    },
    async update(id, patch, expectedVersion) {
      // Сразу с блокировкой записи: отложенная транзакция при гонке копий падает «база занята», не дожидаясь очереди.
      return update.immediate(id, patch, expectedVersion);
    },
    async listResumable(now) {
      return db
        .select()
        .from(imageJobs)
        .where(and(eq(imageJobs.active, true), or(isNull(imageJobs.leaseUntil), lt(imageJobs.leaseUntil, toMs(now)!))))
        .orderBy(asc(imageJobs.createdAt))
        .all()
        .map(toRecord);
    },
    async deleteFinishedBefore(before) {
      const deleted = db
        .delete(imageJobs)
        .where(and(eq(imageJobs.active, false), ne(imageJobs.status, "generating"), isNotNull(imageJobs.finishedAt), lt(imageJobs.finishedAt, toMs(before)!)))
        .run();
      return deleted.changes;
    },
    async close() {
      sqlite.close();
    },
  };
}
