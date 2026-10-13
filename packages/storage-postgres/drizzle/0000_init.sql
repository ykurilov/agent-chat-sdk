CREATE SCHEMA IF NOT EXISTS "agent_chat";
--> statement-breakpoint
CREATE TABLE "agent_chat"."chats" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."messages" (
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "agent_chat"."messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"parent_id" text,
	"role" text NOT NULL,
	"parts" json NOT NULL,
	"format_version" integer NOT NULL,
	"status" text NOT NULL,
	"model_id" text,
	"provider_id" text,
	"usage" json,
	"reasoning_durations_ms" json NOT NULL,
	"error" json,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat"."messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent_chat"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_owner_updated_idx" ON "agent_chat"."chats" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_chat_created_idx" ON "agent_chat"."messages" USING btree ("chat_id","created_at","seq");--> statement-breakpoint
CREATE INDEX "messages_streaming_idx" ON "agent_chat"."messages" USING btree ("status") WHERE "agent_chat"."messages"."status" = 'streaming';