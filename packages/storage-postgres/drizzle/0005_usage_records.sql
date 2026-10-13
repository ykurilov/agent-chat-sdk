CREATE TABLE "agent_chat"."usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text,
	"source" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"input_tokens" bigint NOT NULL,
	"cached_input_tokens" bigint NOT NULL,
	"cache_write_tokens" bigint NOT NULL,
	"output_tokens" bigint NOT NULL,
	"reasoning_tokens" bigint NOT NULL,
	"cost_usd" double precision NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "usage_records_owner_created_idx" ON "agent_chat"."usage_records" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_records_chat_created_idx" ON "agent_chat"."usage_records" USING btree ("chat_id","created_at");