CREATE TABLE "agent_chat"."branch_selections" (
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "agent_chat"."branch_selections_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"selected_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat"."branch_selections" ADD CONSTRAINT "branch_selections_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent_chat"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_selections_chat_seq_idx" ON "agent_chat"."branch_selections" USING btree ("chat_id","seq");