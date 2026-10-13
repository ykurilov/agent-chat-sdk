CREATE TABLE "agent_chat"."compactions" (
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "agent_chat"."compactions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"from_message_id" text NOT NULL,
	"through_message_id" text NOT NULL,
	"summary" text NOT NULL,
	"summary_tokens" integer NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"usage" json,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat"."compactions" ADD CONSTRAINT "compactions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent_chat"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compactions_chat_seq_idx" ON "agent_chat"."compactions" USING btree ("chat_id","seq");