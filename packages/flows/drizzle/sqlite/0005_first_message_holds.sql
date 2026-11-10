CREATE TABLE `flow_first_message_holds` (
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`day` text NOT NULL,
	`until` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `chat_id`)
);
