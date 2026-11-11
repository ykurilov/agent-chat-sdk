CREATE TABLE `stop_requests` (
	`chat_id` text NOT NULL,
	`turn_request_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`chat_id`, `turn_request_id`)
);
--> statement-breakpoint
CREATE INDEX `stop_requests_expires_idx` ON `stop_requests` (`expires_at`);--> statement-breakpoint
CREATE INDEX `stop_requests_owner_idx` ON `stop_requests` (`owner_id`,`expires_at`);