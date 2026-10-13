CREATE TABLE "agent_chat"."voice_choices" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"voice_id" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat"."messages" ADD COLUMN "voice_cut" json;