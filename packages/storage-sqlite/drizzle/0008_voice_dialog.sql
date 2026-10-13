CREATE TABLE `voice_choices` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`voice_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `voice_cut` text;