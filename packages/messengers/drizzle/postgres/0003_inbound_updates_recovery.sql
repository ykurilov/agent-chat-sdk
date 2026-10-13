ALTER TABLE "agent_chat"."messenger_updates" ADD COLUMN "messenger" text;--> statement-breakpoint
ALTER TABLE "agent_chat"."messenger_updates" ADD COLUMN "bot_id" text;--> statement-breakpoint
ALTER TABLE "agent_chat"."messenger_updates" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "agent_chat"."messenger_updates" ADD COLUMN "holder" text;--> statement-breakpoint
ALTER TABLE "agent_chat"."messenger_updates" ADD COLUMN "lease_until" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "agent_chat"."messenger_updates" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "messenger_updates_work_idx" ON "agent_chat"."messenger_updates" USING btree ("messenger","bot_id","lease_until");