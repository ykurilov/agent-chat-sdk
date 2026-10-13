CREATE TABLE "agent_chat"."background_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"helper_messages" jsonb,
	"progress" jsonb,
	"result" jsonb,
	"error" text,
	"lease_owner" text,
	"lease_until" timestamp (3) with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	"delivered_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE INDEX "background_tasks_status_lease_idx" ON "agent_chat"."background_tasks" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "background_tasks_owner_status_idx" ON "agent_chat"."background_tasks" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "background_tasks_chat_delivered_idx" ON "agent_chat"."background_tasks" USING btree ("chat_id","delivered_at");