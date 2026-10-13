import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ImageJobStatus } from "./image-job-store";

export const imageJobs = sqliteTable(
  "image_jobs",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    group: text("group_name"),
    status: text("status").$type<ImageJobStatus>().notNull(),
    /** 1 — у задачи есть работа: её подбирает старт сервера. */
    active: integer("active", { mode: "boolean" }).notNull(),
    /** Задача открыта (генерация или позднее окно): открытая на место — одна, это держит индекс ниже. */
    open: integer("open", { mode: "boolean" }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    version: integer("version").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
    /** Остальное: описание, назначение, данные приложения, шаги с деньгами. */
    body: text("body", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index("image_jobs_owner_key_idx").on(table.ownerId, table.key),
    uniqueIndex("image_jobs_open_key_idx").on(table.ownerId, table.key).where(sql`open = 1`),
    index("image_jobs_group_idx").on(table.group),
    index("image_jobs_active_lease_idx").on(table.active, table.leaseUntil),
  ],
);
