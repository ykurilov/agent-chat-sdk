CREATE TABLE `memory_optimization_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`groups` text DEFAULT '[]' NOT NULL,
	`error` text,
	`usage_record_id` text
);
--> statement-breakpoint
CREATE INDEX `memory_optimization_runs_owner_started_idx` ON `memory_optimization_runs` (`owner_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_optimization_runs_one_running_idx` ON `memory_optimization_runs` (`owner_id`) WHERE "memory_optimization_runs"."status" = 'running';--> statement-breakpoint
ALTER TABLE `memory_notes` ADD `merged_into` text;--> statement-breakpoint
CREATE INDEX `memory_notes_merged_into_idx` ON `memory_notes` (`merged_into`);