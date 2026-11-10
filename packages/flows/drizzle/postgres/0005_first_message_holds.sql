CREATE TABLE "agent_chat"."flow_first_message_holds" (
	"owner_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"day" text NOT NULL,
	"until" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "flow_first_message_holds_owner_id_chat_id_pk" PRIMARY KEY("owner_id","chat_id")
);
