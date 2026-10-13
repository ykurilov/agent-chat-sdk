ALTER TABLE `chats` ADD `subject_key` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `subject_data` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chats_owner_subject_idx` ON `chats` (`owner_id`,`subject_key`);--> statement-breakpoint
ALTER TABLE `messages` ADD `after_turn` text;--> statement-breakpoint
CREATE INDEX `messages_after_turn_pending_idx` ON `messages` (`after_turn`) WHERE "messages"."after_turn" = 'pending';