CREATE TABLE "agent_chat"."stop_requests" (
	"chat_id" text NOT NULL,
	"turn_request_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stop_requests_chat_id_turn_request_id_pk" PRIMARY KEY("chat_id","turn_request_id")
);
--> statement-breakpoint
CREATE INDEX "stop_requests_expires_idx" ON "agent_chat"."stop_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "stop_requests_owner_idx" ON "agent_chat"."stop_requests" USING btree ("owner_id","expires_at");