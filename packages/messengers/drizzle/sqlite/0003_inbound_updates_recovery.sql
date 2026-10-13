ALTER TABLE `messenger_updates` ADD `messenger` text;--> statement-breakpoint
ALTER TABLE `messenger_updates` ADD `bot_id` text;--> statement-breakpoint
ALTER TABLE `messenger_updates` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `messenger_updates` ADD `holder` text;--> statement-breakpoint
ALTER TABLE `messenger_updates` ADD `lease_until` integer;--> statement-breakpoint
ALTER TABLE `messenger_updates` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `messenger_updates_work_idx` ON `messenger_updates` (`messenger`,`bot_id`,`lease_until`);