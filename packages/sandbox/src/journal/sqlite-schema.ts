import type { ModelCallEvent } from "@ykurilov/agent-chat-core";
import { blob, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Куски журнала: один раз на хеш, сжатый JSON. */
export const sandboxBlobs = sqliteTable("sandbox_blobs", {
  hash: text("hash").primaryKey(),
  data: blob("data", { mode: "buffer" }).notNull(),
  bytes: integer("bytes").notNull(),
  truncated: integer("truncated", { mode: "boolean" }).notNull(),
});

export const sandboxModelCalls = sqliteTable(
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
    usage: text("usage", { mode: "json" }).$type<ModelCallEvent["usage"]>(),
    costUsd: real("cost_usd"),
    startedAt: integer("started_at").notNull(),
    firstChunkMs: integer("first_chunk_ms"),
    durationMs: integer("duration_ms").notNull(),
    status: text("status").$type<ModelCallEvent["status"]>().notNull(),
    error: text("error"),
    instructionsHash: text("instructions_hash").notNull(),
    messageHashes: text("message_hashes", { mode: "json" }).$type<string[]>().notNull(),
    toolsHash: text("tools_hash").notNull(),
    settingsHash: text("settings_hash").notNull(),
    responseHash: text("response_hash").notNull(),
    toolCallIds: text("tool_call_ids", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [index("sandbox_model_calls_chat_idx").on(table.chatId, table.startedAt), index("sandbox_model_calls_started_idx").on(table.startedAt)],
);

export const sandboxToolCalls = sqliteTable(
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
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (table) => [index("sandbox_tool_calls_chat_idx").on(table.chatId, table.startedAt), index("sandbox_tool_calls_started_idx").on(table.startedAt)],
);

/** Кто на какой кусок ссылается: по этим строкам решается, чей кусок и какие куски уже никому не нужны. */
export const sandboxBlobRefs = sqliteTable(
  "sandbox_blob_refs",
  {
    callId: text("call_id").notNull(),
    hash: text("hash").notNull(),
    chatId: text("chat_id").notNull(),
    ownerId: text("owner_id").notNull(),
  },
  (table) => [index("sandbox_blob_refs_call_idx").on(table.callId), index("sandbox_blob_refs_hash_idx").on(table.hash, table.ownerId), index("sandbox_blob_refs_chat_idx").on(table.chatId)],
);

export const sandboxSettings = sqliteTable("sandbox_settings", {
  chatId: text("chat_id").primaryKey(),
  instructions: text("instructions"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sandboxAnswerEdits = sqliteTable(
  "sandbox_answer_edits",
  {
    messageId: text("message_id").primaryKey(),
    sourceMessageId: text("source_message_id").notNull(),
    chatId: text("chat_id").notNull(),
    textEdited: integer("text_edited", { mode: "boolean" }).notNull(),
    editedToolCallIds: text("edited_tool_call_ids", { mode: "json" }).$type<string[]>().notNull(),
    editedBy: text("edited_by").notNull(),
    editedAt: integer("edited_at").notNull(),
  },
  (table) => [index("sandbox_answer_edits_chat_idx").on(table.chatId, table.editedAt)],
);
