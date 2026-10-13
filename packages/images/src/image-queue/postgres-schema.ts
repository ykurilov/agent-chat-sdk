import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ImageJobStatus } from "./image-job-store";

/** Та же схема базы, что у хранилища чатов: у приложения одна база и одна схема `agent_chat`. */
const agentChatSchema = pgSchema("agent_chat");

const moment = (name: string) => timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const imageJobs = agentChatSchema.table(
  "image_jobs",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    group: text("group_name"),
    status: text("status").$type<ImageJobStatus>().notNull(),
    /** У задачи есть работа: её подбирает старт сервера. */
    active: boolean("active").notNull(),
    /** Задача открыта (генерация или позднее окно): открытая на место — одна, это держит индекс ниже. */
    open: boolean("open").notNull(),
    leaseOwner: text("lease_owner"),
    leaseUntil: moment("lease_until"),
    version: integer("version").notNull(),
    createdAt: moment("created_at").notNull(),
    updatedAt: moment("updated_at").notNull(),
    finishedAt: moment("finished_at"),
    /** Остальное: описание, назначение, данные приложения, шаги с деньгами. */
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index("image_jobs_owner_key_idx").on(table.ownerId, table.key),
    uniqueIndex("image_jobs_open_key_idx").on(table.ownerId, table.key).where(sql`open`),
    index("image_jobs_group_idx").on(table.group),
    index("image_jobs_active_lease_idx").on(table.active, table.leaseUntil),
  ],
);
