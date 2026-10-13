CREATE SCHEMA IF NOT EXISTS "agent_chat";
--> statement-breakpoint
CREATE TABLE "agent_chat"."sandbox_answer_edits" (
	"message_id" text PRIMARY KEY NOT NULL,
	"source_message_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"text_edited" boolean NOT NULL,
	"edited_tool_call_ids" jsonb NOT NULL,
	"edited_by" text NOT NULL,
	"edited_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."sandbox_blob_refs" (
	"call_id" text NOT NULL,
	"hash" text NOT NULL,
	"chat_id" text NOT NULL,
	"owner_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."sandbox_blobs" (
	"hash" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"truncated" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."sandbox_model_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"message_id" text,
	"purpose" text NOT NULL,
	"attempt" integer NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"usage" jsonb,
	"cost_usd" double precision,
	"started_at" timestamp (3) with time zone NOT NULL,
	"first_chunk_ms" integer,
	"duration_ms" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"instructions_hash" text NOT NULL,
	"message_hashes" jsonb NOT NULL,
	"tools_hash" text NOT NULL,
	"settings_hash" text NOT NULL,
	"response_hash" text NOT NULL,
	"tool_call_ids" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."sandbox_settings" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"instructions" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."sandbox_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"message_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"error" text,
	"started_at" timestamp (3) with time zone NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sandbox_answer_edits_chat_idx" ON "agent_chat"."sandbox_answer_edits" USING btree ("chat_id","edited_at");--> statement-breakpoint
CREATE INDEX "sandbox_blob_refs_call_idx" ON "agent_chat"."sandbox_blob_refs" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "sandbox_blob_refs_hash_idx" ON "agent_chat"."sandbox_blob_refs" USING btree ("hash","owner_id");--> statement-breakpoint
CREATE INDEX "sandbox_blob_refs_chat_idx" ON "agent_chat"."sandbox_blob_refs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "sandbox_model_calls_chat_idx" ON "agent_chat"."sandbox_model_calls" USING btree ("chat_id","started_at");--> statement-breakpoint
CREATE INDEX "sandbox_model_calls_started_idx" ON "agent_chat"."sandbox_model_calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sandbox_tool_calls_chat_idx" ON "agent_chat"."sandbox_tool_calls" USING btree ("chat_id","started_at");--> statement-breakpoint
CREATE INDEX "sandbox_tool_calls_started_idx" ON "agent_chat"."sandbox_tool_calls" USING btree ("started_at");