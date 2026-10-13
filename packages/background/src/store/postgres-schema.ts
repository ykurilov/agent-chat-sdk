import type { HelperProgress, TaskStatus } from "@ykurilov/agent-chat-core";
import type { ModelMessage } from "ai";
import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Та же схема базы, что у хранилища чатов: у приложения одна база и одна схема `agent_chat`. */
const agentChatSchema = pgSchema("agent_chat");

const moment = (name: string) => timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const backgroundTasks = agentChatSchema.table(
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
    input: jsonb("input"),
    title: text("title").notNull(),
    status: text("status").$type<TaskStatus>().notNull(),
    /** Шаги помощника: с них задача продолжается после перезапуска. */
    helperMessages: jsonb("helper_messages").$type<ModelMessage[]>(),
    progress: jsonb("progress").$type<HelperProgress>(),
    result: jsonb("result"),
    error: text("error"),
    leaseOwner: text("lease_owner"),
    leaseUntil: moment("lease_until"),
    attempt: integer("attempt").notNull().default(0),
    createdAt: moment("created_at").notNull(),
    startedAt: moment("started_at"),
    finishedAt: moment("finished_at"),
    deliveredAt: moment("delivered_at"),
    /** Ключ служебного сообщения, с которым задачу начали доставлять. */
    deliveryKey: text("delivery_key"),
  },
  (table) => [
    index("background_tasks_status_lease_idx").on(table.status, table.leaseUntil),
    index("background_tasks_owner_status_idx").on(table.ownerId, table.status),
    index("background_tasks_chat_delivered_idx").on(table.chatId, table.deliveredAt),
  ],
);
