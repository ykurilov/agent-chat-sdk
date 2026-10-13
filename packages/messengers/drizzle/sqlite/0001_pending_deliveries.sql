CREATE TABLE `messenger_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`messenger` text NOT NULL,
	`bot_id` text NOT NULL,
	`external_chat_id` text NOT NULL,
	`payload` text NOT NULL,
	`holder` text NOT NULL,
	`lease_until` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messenger_deliveries_bot_idx` ON `messenger_deliveries` (`messenger`,`bot_id`,`lease_until`);--> statement-breakpoint
CREATE INDEX `messenger_deliveries_holder_idx` ON `messenger_deliveries` (`holder`);