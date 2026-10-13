CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text,
	`source` text NOT NULL,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`cached_input_tokens` integer NOT NULL,
	`cache_write_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`reasoning_tokens` integer NOT NULL,
	`cost_usd` real NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_records_owner_created_idx` ON `usage_records` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_records_chat_created_idx` ON `usage_records` (`chat_id`,`created_at`);