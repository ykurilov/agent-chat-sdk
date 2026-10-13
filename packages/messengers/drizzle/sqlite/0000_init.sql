CREATE TABLE `messenger_buttons` (
	`id` text PRIMARY KEY NOT NULL,
	`messenger` text NOT NULL,
	`bot_id` text NOT NULL,
	`external_chat_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `messenger_buttons_created_idx` ON `messenger_buttons` (`created_at`);--> statement-breakpoint
CREATE TABLE `messenger_conversations` (
	`messenger` text NOT NULL,
	`bot_id` text NOT NULL,
	`external_chat_id` text NOT NULL,
	`type` text NOT NULL,
	`user_id` text NOT NULL,
	`connected_by` text,
	`current_chat_id` text,
	`blocked` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`messenger`, `bot_id`, `external_chat_id`)
);
--> statement-breakpoint
CREATE INDEX `messenger_conversations_user_idx` ON `messenger_conversations` (`user_id`);--> statement-breakpoint
CREATE TABLE `messenger_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`lease_until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messenger_link_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`messenger` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `messenger_link_codes_expires_idx` ON `messenger_link_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `messenger_links` (
	`messenger` text NOT NULL,
	`bot_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`username` text,
	`linked_at` integer NOT NULL,
	PRIMARY KEY(`messenger`, `bot_id`, `external_user_id`)
);
--> statement-breakpoint
CREATE INDEX `messenger_links_user_idx` ON `messenger_links` (`user_id`,`messenger`);--> statement-breakpoint
CREATE TABLE `messenger_member_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`messenger` text NOT NULL,
	`bot_id` text NOT NULL,
	`external_chat_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messenger_member_hits_member_idx` ON `messenger_member_hits` (`messenger`,`bot_id`,`external_chat_id`,`external_user_id`,`at`);--> statement-breakpoint
CREATE TABLE `messenger_updates` (
	`key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`received_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `messenger_updates_received_idx` ON `messenger_updates` (`received_at`);