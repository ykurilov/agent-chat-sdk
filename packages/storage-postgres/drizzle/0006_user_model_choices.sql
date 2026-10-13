CREATE TABLE "agent_chat"."user_model_choices" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"reasoning" text,
	"updated_at" text NOT NULL
);
