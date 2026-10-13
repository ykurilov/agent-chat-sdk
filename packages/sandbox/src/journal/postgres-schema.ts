import type { ModelCallEvent } from "@ykurilov/agent-chat-core";
import { boolean, customType, doublePrecision, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Та же схема базы, что у хранилища чатов: у приложения одна база и одна схема `agent_chat`. */
const agentChatSchema = pgSchema("agent_chat");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const startedAt = (name: string) => timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const sandboxBlobs = agentChatSchema.table("sandbox_blobs", {
  hash: text("hash").primaryKey(),
  data: bytea("data").notNull(),
  bytes: integer("bytes").notNull(),
  truncated: boolean("truncated").notNull(),
});

export const sandboxModelCalls = agentChatSchema.table(
  "sandbox_model_calls",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    ownerId: text("owner_id").notNull(),
    messageId: text("message_id"),
    purpose: text("purpose").$type<ModelCallEvent["purpose"]>().notNull(),
    attempt: integer("attempt").notNull(),
    modelId: text("model_id").notNull(),
    providerId: text("provider_id").notNull(),
    usage: jsonb("usage").$type<ModelCallEvent["usage"]>(),
    costUsd: doublePrecision("cost_usd"),
    startedAt: startedAt("started_at").notNull(),
    firstChunkMs: integer("first_chunk_ms"),
    durationMs: integer("duration_ms").notNull(),
    status: text("status").$type<ModelCallEvent["status"]>().notNull(),
    error: text("error"),
    instructionsHash: text("instructions_hash").notNull(),
    messageHashes: jsonb("message_hashes").$type<string[]>().notNull(),
    toolsHash: text("tools_hash").notNull(),
    settingsHash: text("settings_hash").notNull(),
    responseHash: text("response_hash").notNull(),
    toolCallIds: jsonb("tool_call_ids").$type<string[]>().notNull(),
  },
  (table) => [index("sandbox_model_calls_chat_idx").on(table.chatId, table.startedAt), index("sandbox_model_calls_started_idx").on(table.startedAt)],
);

export const sandboxToolCalls = agentChatSchema.table(
  "sandbox_tool_calls",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    ownerId: text("owner_id").notNull(),
    messageId: text("message_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    error: text("error"),
    startedAt: startedAt("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (table) => [index("sandbox_tool_calls_chat_idx").on(table.chatId, table.startedAt), index("sandbox_tool_calls_started_idx").on(table.startedAt)],
);

/** Кто на какой кусок ссылается: по этим строкам решается, чей кусок и какие куски уже никому не нужны. */
export const sandboxBlobRefs = agentChatSchema.table(
  "sandbox_blob_refs",
  {
    callId: text("call_id").notNull(),
    hash: text("hash").notNull(),
    chatId: text("chat_id").notNull(),
    ownerId: text("owner_id").notNull(),
  },
  (table) => [index("sandbox_blob_refs_call_idx").on(table.callId), index("sandbox_blob_refs_hash_idx").on(table.hash, table.ownerId), index("sandbox_blob_refs_chat_idx").on(table.chatId)],
);

export const sandboxSettings = agentChatSchema.table("sandbox_settings", {
  chatId: text("chat_id").primaryKey(),
  instructions: text("instructions"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: startedAt("updated_at").notNull(),
});

export const sandboxAnswerEdits = agentChatSchema.table(
  "sandbox_answer_edits",
  {
    messageId: text("message_id").primaryKey(),
    sourceMessageId: text("source_message_id").notNull(),
    chatId: text("chat_id").notNull(),
    textEdited: boolean("text_edited").notNull(),
    editedToolCallIds: jsonb("edited_tool_call_ids").$type<string[]>().notNull(),
    editedBy: text("edited_by").notNull(),
    editedAt: startedAt("edited_at").notNull(),
  },
  (table) => [index("sandbox_answer_edits_chat_idx").on(table.chatId, table.editedAt)],
);
