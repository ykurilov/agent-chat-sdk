CREATE TABLE "agent_chat"."messenger_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"messenger" text NOT NULL,
	"bot_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"holder" text NOT NULL,
	"lease_until" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messenger_deliveries_bot_idx" ON "agent_chat"."messenger_deliveries" USING btree ("messenger","bot_id","lease_until");--> statement-breakpoint
CREATE INDEX "messenger_deliveries_holder_idx" ON "agent_chat"."messenger_deliveries" USING btree ("holder");