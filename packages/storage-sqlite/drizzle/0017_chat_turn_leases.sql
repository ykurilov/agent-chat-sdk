CREATE TABLE `chat_turn_leases` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`until` integer NOT NULL
);
