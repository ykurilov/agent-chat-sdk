ALTER TABLE "agent_chat"."chats" ADD COLUMN "subject_key" text;--> statement-breakpoint
ALTER TABLE "agent_chat"."chats" ADD COLUMN "subject_data" json;--> statement-breakpoint
ALTER TABLE "agent_chat"."messages" ADD COLUMN "after_turn" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chats_owner_subject_idx" ON "agent_chat"."chats" USING btree ("owner_id","subject_key");--> statement-breakpoint
CREATE INDEX "messages_after_turn_pending_idx" ON "agent_chat"."messages" USING btree ("after_turn") WHERE "agent_chat"."messages"."after_turn" = 'pending';