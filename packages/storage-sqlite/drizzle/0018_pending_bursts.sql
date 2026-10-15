CREATE TABLE `pending_bursts` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`message_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`holder` text NOT NULL,
	`held_until` integer NOT NULL,
	`page` text
);
