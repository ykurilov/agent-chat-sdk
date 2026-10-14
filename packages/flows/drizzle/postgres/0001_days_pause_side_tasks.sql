CREATE TABLE "agent_chat"."flow_people" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"time_zone" text NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."flow_side_tasks" (
	"owner_id" text NOT NULL,
	"task_id" text NOT NULL,
	"chat_id" text DEFAULT '' NOT NULL,
	"asks" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp (3) with time zone,
	CONSTRAINT "flow_side_tasks_owner_id_task_id_chat_id_pk" PRIMARY KEY("owner_id","task_id","chat_id")
);
--> statement-breakpoint
ALTER TABLE "agent_chat"."flow_chats" ADD COLUMN "ended_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "agent_chat"."flow_chats" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "agent_chat"."flow_chats" ADD COLUMN "paused_until" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "agent_chat"."flow_chats" ADD COLUMN "window_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_chat"."flow_chats" ADD COLUMN "day_closed_on" text;--> statement-breakpoint
ALTER TABLE "agent_chat"."flow_chats" ADD COLUMN "delivery" jsonb;