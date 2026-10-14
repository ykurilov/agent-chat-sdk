CREATE TABLE "agent_chat"."flow_chats" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"version_id" text NOT NULL,
	"state_id" text NOT NULL,
	"pending" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_at" timestamp (3) with time zone,
	"due_exit_id" text,
	"due_branch_head" text,
	"time_zone" text NOT NULL,
	"lease_until" timestamp (3) with time zone,
	"lease_owner" text,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."flow_client_cards" (
	"owner_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"chat_id" text NOT NULL,
	"flow_id" text NOT NULL,
	CONSTRAINT "flow_client_cards_owner_id_field_id_pk" PRIMARY KEY("owner_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."flow_first_messages" (
	"owner_id" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "flow_first_messages_owner_id_day_pk" PRIMARY KEY("owner_id","day")
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."flow_versions" (
	"flow_id" text NOT NULL,
	"version_id" text NOT NULL,
	"hash" text NOT NULL,
	"flow" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "flow_versions_flow_id_version_id_pk" PRIMARY KEY("flow_id","version_id")
);
--> statement-breakpoint
CREATE INDEX "flow_chats_due_idx" ON "agent_chat"."flow_chats" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "flow_chats_flow_state_idx" ON "agent_chat"."flow_chats" USING btree ("flow_id","version_id","state_id");--> statement-breakpoint
CREATE INDEX "flow_chats_owner_idx" ON "agent_chat"."flow_chats" USING btree ("owner_id");