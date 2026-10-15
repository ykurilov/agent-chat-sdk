CREATE TABLE "agent_chat"."mcp_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"owner_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"status" text NOT NULL,
	"transport" text NOT NULL,
	"via_proxy" boolean NOT NULL,
	"timeout_ms" integer NOT NULL,
	"secret_url" text NOT NULL,
	"display_url" text NOT NULL,
	"url_has_hidden_parts" boolean NOT NULL,
	"secret_headers" text,
	"header_names" text NOT NULL,
	"tools" text NOT NULL,
	"tools_updated_at" timestamp (3) with time zone,
	"tool_settings" text NOT NULL,
	"last_check" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mcp_calls_started_idx" ON "agent_chat"."mcp_calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "mcp_calls_server_started_idx" ON "agent_chat"."mcp_calls" USING btree ("server_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_prefix_idx" ON "agent_chat"."mcp_servers" USING btree ("prefix");