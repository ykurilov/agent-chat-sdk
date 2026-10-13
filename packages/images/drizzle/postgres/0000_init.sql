CREATE SCHEMA IF NOT EXISTS "agent_chat";
--> statement-breakpoint
CREATE TABLE "agent_chat"."image_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"owner_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"group_name" text,
	"status" text NOT NULL,
	"active" boolean NOT NULL,
	"open" boolean NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp (3) with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "image_jobs_owner_key_idx" ON "agent_chat"."image_jobs" USING btree ("owner_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "image_jobs_open_key_idx" ON "agent_chat"."image_jobs" USING btree ("owner_id","key") WHERE open;--> statement-breakpoint
CREATE INDEX "image_jobs_group_idx" ON "agent_chat"."image_jobs" USING btree ("group_name");--> statement-breakpoint
CREATE INDEX "image_jobs_active_lease_idx" ON "agent_chat"."image_jobs" USING btree ("active","lease_until");