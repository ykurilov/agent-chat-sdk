CREATE TABLE `flow_people` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`time_zone` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flow_side_tasks` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`chat_id` text DEFAULT '' NOT NULL,
	`asks` integer DEFAULT 0 NOT NULL,
	`done_at` integer,
	PRIMARY KEY(`owner_id`, `task_id`, `chat_id`)
);
--> statement-breakpoint
ALTER TABLE `flow_chats` ADD `ended_at` integer;--> statement-breakpoint
ALTER TABLE `flow_chats` ADD `end_reason` text;--> statement-breakpoint
ALTER TABLE `flow_chats` ADD `paused_until` integer;--> statement-breakpoint
ALTER TABLE `flow_chats` ADD `window_closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `flow_chats` ADD `day_closed_on` text;--> statement-breakpoint
ALTER TABLE `flow_chats` ADD `delivery` text;