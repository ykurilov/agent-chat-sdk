CREATE TABLE "agent_chat"."messenger_buttons" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"bot_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"action" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."messenger_conversations" (
	"messenger" text NOT NULL,
	"bot_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"type" text NOT NULL,
	"user_id" text NOT NULL,
	"connected_by" text,
	"current_chat_id" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "messenger_conversations_messenger_bot_id_external_chat_id_pk" PRIMARY KEY("messenger","bot_id","external_chat_id")
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."messenger_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"lease_until" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."messenger_link_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"messenger" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."messenger_links" (
	"messenger" text NOT NULL,
	"bot_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"linked_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "messenger_links_messenger_bot_id_external_user_id_pk" PRIMARY KEY("messenger","bot_id","external_user_id")
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."messenger_member_hits" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"bot_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."messenger_updates" (
	"key" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE INDEX "messenger_buttons_created_idx" ON "agent_chat"."messenger_buttons" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messenger_conversations_user_idx" ON "agent_chat"."messenger_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messenger_link_codes_expires_idx" ON "agent_chat"."messenger_link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "messenger_links_user_idx" ON "agent_chat"."messenger_links" USING btree ("user_id","messenger");--> statement-breakpoint
CREATE INDEX "messenger_member_hits_member_idx" ON "agent_chat"."messenger_member_hits" USING btree ("messenger","bot_id","external_chat_id","external_user_id","at");--> statement-breakpoint
CREATE INDEX "messenger_updates_received_idx" ON "agent_chat"."messenger_updates" USING btree ("received_at");