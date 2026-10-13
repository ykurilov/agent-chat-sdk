CREATE TABLE `image_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`group_name` text,
	`status` text NOT NULL,
	`active` integer NOT NULL,
	`open` integer NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `image_jobs_owner_key_idx` ON `image_jobs` (`owner_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_jobs_open_key_idx` ON `image_jobs` (`owner_id`,`key`) WHERE open = 1;--> statement-breakpoint
CREATE INDEX `image_jobs_group_idx` ON `image_jobs` (`group_name`);--> statement-breakpoint
CREATE INDEX `image_jobs_active_lease_idx` ON `image_jobs` (`active`,`lease_until`);