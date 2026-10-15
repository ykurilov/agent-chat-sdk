CREATE TABLE `skill_loads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`chat_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`loaded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skill_loads_name_loaded_idx` ON `skill_loads` (`name`,`loaded_at`);--> statement-breakpoint
CREATE TABLE `skill_versions` (
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`when_to_use` text NOT NULL,
	`body` text NOT NULL,
	`author` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`name`, `version`)
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`name` text PRIMARY KEY NOT NULL,
	`when_to_use` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
