import type { AgentFlow } from "../format/flow-format";
import type { FlowEndReason, FlowTransitionMode } from "../engine/flow-run";
import type { FlowChatPlacement, FlowPendingDelivery, PendingFlowChange } from "./flow-store";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Времена — миллисекунды с 1970 года, JSON — текстом.

/** Чаты, которые идут по сценарию. */
export const flowChats = sqliteTable(
  "flow_chats",
  {
    chatId: text("chat_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    flowId: text("flow_id").notNull(),
    versionId: text("version_id").notNull(),
    stateId: text("state_id").notNull(),
    transitionMode: text("transition_mode").$type<FlowTransitionMode>().notNull().default("rails"),
    pending: text("pending", { mode: "json" }).$type<PendingFlowChange[]>().notNull().default([]),
    dueAt: integer("due_at"),
    dueExitId: text("due_exit_id"),
    dueBranchHead: text("due_branch_head"),
    timeZone: text("time_zone").notNull(),
    leaseUntil: integer("lease_until"),
    leaseOwner: text("lease_owner"),
    updatedAt: integer("updated_at").notNull(),
    endedAt: integer("ended_at"),
    endReason: text("end_reason").$type<FlowEndReason>(),
    reopenedAt: integer("reopened_at"),
    pausedUntil: integer("paused_until"),
    windowClosed: integer("window_closed", { mode: "boolean" }).notNull().default(false),
    dayClosedOn: text("day_closed_on"),
    delivery: text("delivery", { mode: "json" }).$type<FlowPendingDelivery>(),
    placement: text("placement", { mode: "json" }).$type<FlowChatPlacement>(),
  },
  (table) => [
    index("flow_chats_due_idx").on(table.dueAt),
    index("flow_chats_flow_state_idx").on(table.flowId, table.versionId, table.stateId),
    index("flow_chats_owner_idx").on(table.ownerId),
  ],
);

/** Сохранённые версии сценариев: чат идёт по своей версии, пока его не перевели. */
export const flowVersions = sqliteTable(
  "flow_versions",
  {
    flowId: text("flow_id").notNull(),
    versionId: text("version_id").notNull(),
    hash: text("hash").notNull(),
    flow: text("flow", { mode: "json" }).$type<AgentFlow>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.flowId, table.versionId] })],
);

/** Карточка клиента: поле за полем, переживает чаты. */
export const flowClientCards = sqliteTable(
  "flow_client_cards",
  {
    ownerId: text("owner_id").notNull(),
    fieldId: text("field_id").notNull(),
    value: text("value", { mode: "json" }).notNull(),
    updatedAt: integer("updated_at").notNull(),
    chatId: text("chat_id").notNull(),
    flowId: text("flow_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.fieldId] })],
);

/** Сколько сообщений агент написал первым за сутки человека. */
export const flowFirstMessages = sqliteTable(
  "flow_first_messages",
  {
    ownerId: text("owner_id").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.day] })],
);

/** Пояс человека: общий для всех его чатов. */
export const flowPeople = sqliteTable("flow_people", {
  ownerId: text("owner_id").primaryKey(),
  timeZone: text("time_zone").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Попытки попутных задач. `chat_id` пустой — попытки на человека, иначе — на разговор. */
export const flowSideTasks = sqliteTable(
  "flow_side_tasks",
  {
    ownerId: text("owner_id").notNull(),
    taskId: text("task_id").notNull(),
    chatId: text("chat_id").notNull().default(""),
    asks: integer("asks").notNull().default(0),
    doneAt: integer("done_at"),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.taskId, table.chatId] })],
);
