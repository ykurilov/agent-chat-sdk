CREATE TABLE "agent_chat"."pending_bursts" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"message_id" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"holder" text NOT NULL,
	"held_until" timestamp with time zone NOT NULL,
	"page" jsonb
);
