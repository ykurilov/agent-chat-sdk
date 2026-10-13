CREATE TABLE `branch_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`selected_at` text NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `branch_selections_chat_seq_idx` ON `branch_selections` (`chat_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `branch_selections_seq_idx` ON `branch_selections` (`seq`);