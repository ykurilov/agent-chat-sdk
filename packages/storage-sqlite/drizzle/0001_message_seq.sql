ALTER TABLE `messages` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `messages` SET `seq` = `rowid`;--> statement-breakpoint
DROP INDEX `messages_chat_created_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_seq_idx` ON `messages` (`seq`);--> statement-breakpoint
CREATE INDEX `messages_chat_created_idx` ON `messages` (`chat_id`,`created_at`,`seq`);
