CREATE TABLE `flow_chats` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`version_id` text NOT NULL,
	`state_id` text NOT NULL,
	`pending` text DEFAULT '[]' NOT NULL,
	`due_at` integer,
	`due_exit_id` text,
	`due_branch_head` text,
	`time_zone` text NOT NULL,
	`lease_until` integer,
	`lease_owner` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `flow_chats_due_idx` ON `flow_chats` (`due_at`);--> statement-breakpoint
CREATE INDEX `flow_chats_flow_state_idx` ON `flow_chats` (`flow_id`,`version_id`,`state_id`);--> statement-breakpoint
CREATE INDEX `flow_chats_owner_idx` ON `flow_chats` (`owner_id`);--> statement-breakpoint
CREATE TABLE `flow_client_cards` (
	`owner_id` text NOT NULL,
	`field_id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	`chat_id` text NOT NULL,
	`flow_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `field_id`)
);
--> statement-breakpoint
CREATE TABLE `flow_first_messages` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `day`)
);
--> statement-breakpoint
CREATE TABLE `flow_versions` (
	`flow_id` text NOT NULL,
	`version_id` text NOT NULL,
	`hash` text NOT NULL,
	`flow` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`flow_id`, `version_id`)
);
