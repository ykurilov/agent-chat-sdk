// Создано scripts/embed-migrations.mjs из packages/sandbox/drizzle/postgres; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_journal_init
  { folderMillis: 1791041535977, hash: "944772a6c593f0ac2f3e5a656f527454d14cf9734e77e84dff54c8c2614c9162", bps: true, sql: [
    "CREATE SCHEMA IF NOT EXISTS \"agent_chat\";\n",
    "\nCREATE TABLE \"agent_chat\".\"sandbox_answer_edits\" (\n\t\"message_id\" text PRIMARY KEY NOT NULL,\n\t\"source_message_id\" text NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"text_edited\" boolean NOT NULL,\n\t\"edited_tool_call_ids\" jsonb NOT NULL,\n\t\"edited_by\" text NOT NULL,\n\t\"edited_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"sandbox_blob_refs\" (\n\t\"call_id\" text NOT NULL,\n\t\"hash\" text NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"owner_id\" text NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"sandbox_blobs\" (\n\t\"hash\" text PRIMARY KEY NOT NULL,\n\t\"data\" \"bytea\" NOT NULL,\n\t\"bytes\" integer NOT NULL,\n\t\"truncated\" boolean NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"sandbox_model_calls\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"message_id\" text,\n\t\"purpose\" text NOT NULL,\n\t\"attempt\" integer NOT NULL,\n\t\"model_id\" text NOT NULL,\n\t\"provider_id\" text NOT NULL,\n\t\"usage\" jsonb,\n\t\"cost_usd\" double precision,\n\t\"started_at\" timestamp (3) with time zone NOT NULL,\n\t\"first_chunk_ms\" integer,\n\t\"duration_ms\" integer NOT NULL,\n\t\"status\" text NOT NULL,\n\t\"error\" text,\n\t\"instructions_hash\" text NOT NULL,\n\t\"message_hashes\" jsonb NOT NULL,\n\t\"tools_hash\" text NOT NULL,\n\t\"settings_hash\" text NOT NULL,\n\t\"response_hash\" text NOT NULL,\n\t\"tool_call_ids\" jsonb NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"sandbox_settings\" (\n\t\"chat_id\" text PRIMARY KEY NOT NULL,\n\t\"instructions\" text,\n\t\"updated_by\" text NOT NULL,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"sandbox_tool_calls\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"message_id\" text NOT NULL,\n\t\"tool_call_id\" text NOT NULL,\n\t\"tool_name\" text NOT NULL,\n\t\"input_hash\" text NOT NULL,\n\t\"output_hash\" text,\n\t\"error\" text,\n\t\"started_at\" timestamp (3) with time zone NOT NULL,\n\t\"duration_ms\" integer NOT NULL\n);\n",
    "\nCREATE INDEX \"sandbox_answer_edits_chat_idx\" ON \"agent_chat\".\"sandbox_answer_edits\" USING btree (\"chat_id\",\"edited_at\");",
    "\nCREATE INDEX \"sandbox_blob_refs_call_idx\" ON \"agent_chat\".\"sandbox_blob_refs\" USING btree (\"call_id\");",
    "\nCREATE INDEX \"sandbox_blob_refs_hash_idx\" ON \"agent_chat\".\"sandbox_blob_refs\" USING btree (\"hash\",\"owner_id\");",
    "\nCREATE INDEX \"sandbox_blob_refs_chat_idx\" ON \"agent_chat\".\"sandbox_blob_refs\" USING btree (\"chat_id\");",
    "\nCREATE INDEX \"sandbox_model_calls_chat_idx\" ON \"agent_chat\".\"sandbox_model_calls\" USING btree (\"chat_id\",\"started_at\");",
    "\nCREATE INDEX \"sandbox_model_calls_started_idx\" ON \"agent_chat\".\"sandbox_model_calls\" USING btree (\"started_at\");",
    "\nCREATE INDEX \"sandbox_tool_calls_chat_idx\" ON \"agent_chat\".\"sandbox_tool_calls\" USING btree (\"chat_id\",\"started_at\");",
    "\nCREATE INDEX \"sandbox_tool_calls_started_idx\" ON \"agent_chat\".\"sandbox_tool_calls\" USING btree (\"started_at\");",
  ] },
];
