CREATE TABLE `sandbox_answer_edits` (
	`message_id` text PRIMARY KEY NOT NULL,
	`source_message_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`text_edited` integer NOT NULL,
	`edited_tool_call_ids` text NOT NULL,
	`edited_by` text NOT NULL,
	`edited_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_answer_edits_chat_idx` ON `sandbox_answer_edits` (`chat_id`,`edited_at`);--> statement-breakpoint
CREATE TABLE `sandbox_blob_refs` (
	`call_id` text NOT NULL,
	`hash` text NOT NULL,
	`chat_id` text NOT NULL,
	`owner_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_blob_refs_call_idx` ON `sandbox_blob_refs` (`call_id`);--> statement-breakpoint
CREATE INDEX `sandbox_blob_refs_hash_idx` ON `sandbox_blob_refs` (`hash`,`owner_id`);--> statement-breakpoint
CREATE INDEX `sandbox_blob_refs_chat_idx` ON `sandbox_blob_refs` (`chat_id`);--> statement-breakpoint
CREATE TABLE `sandbox_blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`data` blob NOT NULL,
	`bytes` integer NOT NULL,
	`truncated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sandbox_model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`message_id` text,
	`purpose` text NOT NULL,
	`attempt` integer NOT NULL,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`usage` text,
	`cost_usd` real,
	`started_at` integer NOT NULL,
	`first_chunk_ms` integer,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`instructions_hash` text NOT NULL,
	`message_hashes` text NOT NULL,
	`tools_hash` text NOT NULL,
	`settings_hash` text NOT NULL,
	`response_hash` text NOT NULL,
	`tool_call_ids` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_model_calls_chat_idx` ON `sandbox_model_calls` (`chat_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `sandbox_model_calls_started_idx` ON `sandbox_model_calls` (`started_at`);--> statement-breakpoint
CREATE TABLE `sandbox_settings` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`instructions` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sandbox_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`message_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_hash` text,
	`error` text,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_tool_calls_chat_idx` ON `sandbox_tool_calls` (`chat_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `sandbox_tool_calls_started_idx` ON `sandbox_tool_calls` (`started_at`);