CREATE TABLE "agent_chat"."chat_turn_leases" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"until" timestamp with time zone NOT NULL
);
