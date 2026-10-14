import type { AgentFlow } from "../format/flow-format";
import type { FlowEndReason } from "../engine/flow-run";
import type { FlowChatPlacement, FlowPendingDelivery, PendingFlowChange } from "./flow-store";
import { boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Та же схема базы, что у хранилища чатов: у приложения одна база и одна схема `agent_chat`. */
const agentChatSchema = pgSchema("agent_chat");

const moment = (name: string) => timestamp(name, { mode: "date", precision: 3, withTimezone: true });

/** Чаты, которые идут по сценарию. */
export const flowChats = agentChatSchema.table(
  "flow_chats",
  {
    chatId: text("chat_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    flowId: text("flow_id").notNull(),
    versionId: text("version_id").notNull(),
    stateId: text("state_id").notNull(),
    pending: jsonb("pending").$type<PendingFlowChange[]>().notNull().default([]),
    dueAt: moment("due_at"),
    dueExitId: text("due_exit_id"),
    dueBranchHead: text("due_branch_head"),
    timeZone: text("time_zone").notNull(),
    leaseUntil: moment("lease_until"),
    leaseOwner: text("lease_owner"),
    updatedAt: moment("updated_at").notNull(),
    endedAt: moment("ended_at"),
    endReason: text("end_reason").$type<FlowEndReason>(),
    pausedUntil: moment("paused_until"),
    windowClosed: boolean("window_closed").notNull().default(false),
    dayClosedOn: text("day_closed_on"),
    delivery: jsonb("delivery").$type<FlowPendingDelivery>(),
    placement: jsonb("placement").$type<FlowChatPlacement>(),
  },
  (table) => [
    index("flow_chats_due_idx").on(table.dueAt),
    index("flow_chats_flow_state_idx").on(table.flowId, table.versionId, table.stateId),
    index("flow_chats_owner_idx").on(table.ownerId),
  ],
);

/** Сохранённые версии сценариев: чат идёт по своей версии, пока его не перевели. */
export const flowVersions = agentChatSchema.table(
  "flow_versions",
  {
    flowId: text("flow_id").notNull(),
    versionId: text("version_id").notNull(),
    hash: text("hash").notNull(),
    flow: jsonb("flow").$type<AgentFlow>().notNull(),
    createdAt: moment("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.flowId, table.versionId] })],
);

/** Карточка клиента: поле за полем, переживает чаты. */
export const flowClientCards = agentChatSchema.table(
  "flow_client_cards",
  {
    ownerId: text("owner_id").notNull(),
    fieldId: text("field_id").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: moment("updated_at").notNull(),
    chatId: text("chat_id").notNull(),
    flowId: text("flow_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.fieldId] })],
);

/** Сколько сообщений агент написал первым за сутки человека. */
export const flowFirstMessages = agentChatSchema.table(
  "flow_first_messages",
  {
    ownerId: text("owner_id").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.day] })],
);

/** Пояс человека: общий для всех его чатов. */
export const flowPeople = agentChatSchema.table("flow_people", {
  ownerId: text("owner_id").primaryKey(),
  timeZone: text("time_zone").notNull(),
  updatedAt: moment("updated_at").notNull(),
});

/** Попытки попутных задач. `chat_id` пустой — попытки на человека, иначе — на разговор. */
export const flowSideTasks = agentChatSchema.table(
  "flow_side_tasks",
  {
    ownerId: text("owner_id").notNull(),
    taskId: text("task_id").notNull(),
    chatId: text("chat_id").notNull().default(""),
    asks: integer("asks").notNull().default(0),
    doneAt: moment("done_at"),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.taskId, table.chatId] })],
);
