CREATE TABLE `mcp_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `mcp_calls_started_idx` ON `mcp_calls` (`started_at`);--> statement-breakpoint
CREATE INDEX `mcp_calls_server_started_idx` ON `mcp_calls` (`server_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`status` text NOT NULL,
	`transport` text NOT NULL,
	`via_proxy` integer NOT NULL,
	`timeout_ms` integer NOT NULL,
	`secret_url` text NOT NULL,
	`display_url` text NOT NULL,
	`url_has_hidden_parts` integer NOT NULL,
	`secret_headers` text,
	`header_names` text NOT NULL,
	`tools` text NOT NULL,
	`tools_updated_at` integer,
	`tool_settings` text NOT NULL,
	`last_check` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_prefix_idx` ON `mcp_servers` (`prefix`);