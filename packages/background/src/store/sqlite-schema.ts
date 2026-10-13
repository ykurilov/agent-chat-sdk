import type { HelperProgress, TaskStatus } from "@ykurilov/agent-chat-core";
import type { ModelMessage } from "ai";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const backgroundTasks = sqliteTable(
  "background_tasks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    channel: text("channel", { enum: ["web", "telegram", "vk", "max"] }).notNull(),
    kind: text("kind", { enum: ["tool", "helper"] }).notNull(),
    name: text("name").notNull(),
    input: text("input", { mode: "json" }),
    title: text("title").notNull(),
    status: text("status").$type<TaskStatus>().notNull(),
    /** Шаги помощника: с них задача продолжается после перезапуска. */
    helperMessages: text("helper_messages", { mode: "json" }).$type<ModelMessage[]>(),
    progress: text("progress", { mode: "json" }).$type<HelperProgress>(),
    result: text("result", { mode: "json" }),
    error: text("error"),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    attempt: integer("attempt").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    deliveredAt: integer("delivered_at"),
    /** Ключ служебного сообщения, с которым задачу начали доставлять. */
    deliveryKey: text("delivery_key"),
  },
  (table) => [
    index("background_tasks_status_lease_idx").on(table.status, table.leaseUntil),
    index("background_tasks_owner_status_idx").on(table.ownerId, table.status),
    index("background_tasks_chat_delivered_idx").on(table.chatId, table.deliveredAt),
  ],
);
