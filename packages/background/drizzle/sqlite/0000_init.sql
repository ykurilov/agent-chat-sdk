CREATE TABLE `background_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`channel` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`input` text,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`helper_messages` text,
	`progress` text,
	`result` text,
	`error` text,
	`lease_owner` text,
	`lease_until` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`delivered_at` integer
);
--> statement-breakpoint
CREATE INDEX `background_tasks_status_lease_idx` ON `background_tasks` (`status`,`lease_until`);--> statement-breakpoint
CREATE INDEX `background_tasks_owner_status_idx` ON `background_tasks` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `background_tasks_chat_delivered_idx` ON `background_tasks` (`chat_id`,`delivered_at`);