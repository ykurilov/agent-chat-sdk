CREATE TABLE "agent_chat"."memory_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"categories" jsonb NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "memory_notes_owner_updated_idx" ON "agent_chat"."memory_notes" USING btree ("owner_id","updated_at");