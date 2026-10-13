CREATE TABLE `compactions` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`from_message_id` text NOT NULL,
	`through_message_id` text NOT NULL,
	`summary` text NOT NULL,
	`summary_tokens` integer NOT NULL,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`usage` text,
	`created_at` text NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compactions_chat_seq_idx` ON `compactions` (`chat_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `compactions_seq_idx` ON `compactions` (`seq`);