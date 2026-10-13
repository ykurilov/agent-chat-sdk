CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chats_owner_updated_idx` ON `chats` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`parent_id` text,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`format_version` integer NOT NULL,
	`status` text NOT NULL,
	`model_id` text,
	`provider_id` text,
	`usage` text,
	`reasoning_durations_ms` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_chat_created_idx` ON `messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_streaming_idx` ON `messages` (`status`) WHERE "messages"."status" = 'streaming';