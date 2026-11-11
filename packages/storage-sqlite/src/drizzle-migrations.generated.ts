// Создано scripts/embed-migrations.mjs из packages/storage-sqlite/drizzle; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1790637217361, hash: "fa6180a59138a232a1cb9d94efa6031bb233ecd91bcadf71a4d2e73e96e4e86a", bps: true, sql: [
    "CREATE TABLE `chats` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`model_id` text NOT NULL,\n\t`provider_id` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL\n);\n",
    "\nCREATE INDEX `chats_owner_updated_idx` ON `chats` (`owner_id`,`updated_at`);",
    "\nCREATE TABLE `messages` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`parent_id` text,\n\t`role` text NOT NULL,\n\t`parts` text NOT NULL,\n\t`format_version` integer NOT NULL,\n\t`status` text NOT NULL,\n\t`model_id` text,\n\t`provider_id` text,\n\t`usage` text,\n\t`reasoning_durations_ms` text NOT NULL,\n\t`error` text,\n\t`created_at` text NOT NULL,\n\tFOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade\n);\n",
    "\nCREATE INDEX `messages_chat_created_idx` ON `messages` (`chat_id`,`created_at`);",
    "\nCREATE INDEX `messages_streaming_idx` ON `messages` (`status`) WHERE \"messages\".\"status\" = 'streaming';",
  ] },
  // 0001_message_seq
  { folderMillis: 1790717189202, hash: "423ea238f8cd3309c77df1f090d873efbe26132224083db668a280e34ee7543a", bps: true, sql: [
    "ALTER TABLE `messages` ADD `seq` integer DEFAULT 0 NOT NULL;",
    "\nUPDATE `messages` SET `seq` = `rowid`;",
    "\nDROP INDEX `messages_chat_created_idx`;",
    "\nCREATE UNIQUE INDEX `messages_seq_idx` ON `messages` (`seq`);",
    "\nCREATE INDEX `messages_chat_created_idx` ON `messages` (`chat_id`,`created_at`,`seq`);\n",
  ] },
  // 0002_chat_reasoning
  { folderMillis: 1790718146337, hash: "28847ceb90b91ec97fce1d232bb1b140eab5ea0b193524cb550d1b7799bfc77e", bps: true, sql: [
    "ALTER TABLE `chats` ADD `reasoning` text;",
  ] },
  // 0003_compactions
  { folderMillis: 1790721542955, hash: "cbcd2847791f9efe7ee6304405090c708c3d695fac1fd2a30b57da0b466f1a9a", bps: true, sql: [
    "CREATE TABLE `compactions` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`from_message_id` text NOT NULL,\n\t`through_message_id` text NOT NULL,\n\t`summary` text NOT NULL,\n\t`summary_tokens` integer NOT NULL,\n\t`model_id` text NOT NULL,\n\t`provider_id` text NOT NULL,\n\t`usage` text,\n\t`created_at` text NOT NULL,\n\t`seq` integer DEFAULT 0 NOT NULL,\n\tFOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade\n);\n",
    "\nCREATE INDEX `compactions_chat_seq_idx` ON `compactions` (`chat_id`,`seq`);",
    "\nCREATE UNIQUE INDEX `compactions_seq_idx` ON `compactions` (`seq`);",
  ] },
  // 0004_branch_selections
  { folderMillis: 1790735648121, hash: "823b1f9e9f622882df6964e056206488ef1dc8d57e863822fe2e85ed5a4da97f", bps: true, sql: [
    "CREATE TABLE `branch_selections` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`message_id` text NOT NULL,\n\t`selected_at` text NOT NULL,\n\t`seq` integer DEFAULT 0 NOT NULL,\n\tFOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade\n);\n",
    "\nCREATE INDEX `branch_selections_chat_seq_idx` ON `branch_selections` (`chat_id`,`seq`);",
    "\nCREATE UNIQUE INDEX `branch_selections_seq_idx` ON `branch_selections` (`seq`);",
  ] },
  // 0005_chat_title
  { folderMillis: 1790738333184, hash: "d51260d54c7710b880b88ec94ca8280c1d2151ea002c4ab5fb0f6787a091456b", bps: true, sql: [
    "ALTER TABLE `chats` ADD `title` text;",
    "\n-- Названия у прежних чатов: из первого текста первого сообщения собеседника, как это делает ядро\n-- (пробелы схлопнуты, не длиннее 60 знаков и «…»). Очень длинные ряды пробелов (больше 64) схлопываются не до конца.\nUPDATE `chats` SET `title` = (\n  SELECT CASE\n    WHEN length(t) = 0 THEN NULL\n    WHEN length(t) > 60 THEN rtrim(substr(t, 1, 60)) || '…'\n    ELSE t\n  END\n  FROM (\n    SELECT trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(x, char(13), ' '), char(10), ' '), char(9), ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')) AS t\n    FROM (\n      SELECT (\n        SELECT json_extract(p.value, '$.text') FROM json_each(m.parts) AS p\n        WHERE json_extract(p.value, '$.type') = 'text' LIMIT 1\n      ) AS x\n      FROM `messages` AS m\n      WHERE m.chat_id = `chats`.id AND m.role = 'user'\n      ORDER BY m.created_at, m.seq LIMIT 1\n    )\n  )\n);\n",
  ] },
  // 0006_usage_records
  { folderMillis: 1790740140515, hash: "a97547795d7eaffc5cf323f94382fdeace070362686b277f718f41263f4eaf86", bps: true, sql: [
    "CREATE TABLE `usage_records` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`message_id` text,\n\t`source` text NOT NULL,\n\t`model_id` text NOT NULL,\n\t`provider_id` text NOT NULL,\n\t`input_tokens` integer NOT NULL,\n\t`cached_input_tokens` integer NOT NULL,\n\t`cache_write_tokens` integer NOT NULL,\n\t`output_tokens` integer NOT NULL,\n\t`reasoning_tokens` integer NOT NULL,\n\t`cost_usd` real NOT NULL,\n\t`created_at` text NOT NULL\n);\n",
    "\nCREATE INDEX `usage_records_owner_created_idx` ON `usage_records` (`owner_id`,`created_at`);",
    "\nCREATE INDEX `usage_records_chat_created_idx` ON `usage_records` (`chat_id`,`created_at`);",
  ] },
  // 0007_user_model_choices
  { folderMillis: 1790752788778, hash: "e065052e74b77c78c2e772af08202085163bf334a6cef0a0eef5a3c8f7be0776", bps: true, sql: [
    "CREATE TABLE `user_model_choices` (\n\t`owner_id` text PRIMARY KEY NOT NULL,\n\t`model_id` text NOT NULL,\n\t`provider_id` text NOT NULL,\n\t`reasoning` text,\n\t`updated_at` text NOT NULL\n);\n",
  ] },
  // 0008_voice_dialog
  { folderMillis: 1790755964781, hash: "0bad85e76400d4ae4fd25d452fbcf7045c620ec159b077c073be518c5fda6c27", bps: true, sql: [
    "CREATE TABLE `voice_choices` (\n\t`owner_id` text PRIMARY KEY NOT NULL,\n\t`voice_id` text NOT NULL,\n\t`updated_at` text NOT NULL\n);\n",
    "\nALTER TABLE `messages` ADD `voice_cut` text;",
  ] },
  // 0009_memory_notes
  { folderMillis: 1790759903309, hash: "24eacd844307e151fcca6162d0a6cb7511811e340f11e6d27a3a348e774adc66", bps: true, sql: [
    "CREATE TABLE `memory_notes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`categories` text NOT NULL,\n\t`content` text NOT NULL,\n\t`version` integer DEFAULT 1 NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n",
    "\nCREATE INDEX `memory_notes_owner_updated_idx` ON `memory_notes` (`owner_id`,`updated_at`);",
  ] },
  // 0010_memory_optimization
  { folderMillis: 1790761149164, hash: "59af37bb0e69b0c69a9087d8e37028af09789d8a9764043250d8a06759bbaf39", bps: true, sql: [
    "CREATE TABLE `memory_optimization_runs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`started_at` integer NOT NULL,\n\t`finished_at` integer,\n\t`status` text NOT NULL,\n\t`groups` text DEFAULT '[]' NOT NULL,\n\t`error` text,\n\t`usage_record_id` text\n);\n",
    "\nCREATE INDEX `memory_optimization_runs_owner_started_idx` ON `memory_optimization_runs` (`owner_id`,`started_at`);",
    "\nCREATE UNIQUE INDEX `memory_optimization_runs_one_running_idx` ON `memory_optimization_runs` (`owner_id`) WHERE \"memory_optimization_runs\".\"status\" = 'running';",
    "\nALTER TABLE `memory_notes` ADD `merged_into` text;",
    "\nCREATE INDEX `memory_notes_merged_into_idx` ON `memory_notes` (`merged_into`);",
  ] },
  // 0011_usage_estimated
  { folderMillis: 1790938845657, hash: "9f80b73e93bc185baa36a03fd0fbc997998bd99c64f403e5c7913f9fa8d18722", bps: true, sql: [
    "ALTER TABLE `usage_records` ADD `estimated` integer DEFAULT false NOT NULL;",
  ] },
  // 0012_message_alive_at
  { folderMillis: 1790944385262, hash: "9f6428da30a32aec3b8569efd56f4ea71b212f01cb4d04ea9ed5d4220d0b9a31", bps: true, sql: [
    "ALTER TABLE `messages` ADD `alive_at` text;",
  ] },
  // 0013_spending_limit_states
  { folderMillis: 1791185874367, hash: "b9bb386d3aa74283aac71512527f1ffa75bd74a0661df7cc0151996fe51b5bcf", bps: true, sql: [
    "CREATE TABLE `spending_limit_states` (\n\t`key` text PRIMARY KEY NOT NULL,\n\t`value` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`updated_at` text NOT NULL\n);\n",
  ] },
  // 0014_chat_origin
  { folderMillis: 1791197610961, hash: "b5e906059b8c10c2d88a7a0cd1eb2608ebe3106f6f0fa5081d64f7c59af59e63", bps: true, sql: [
    "ALTER TABLE `chats` ADD `origin` text;",
  ] },
  // 0015_chat_subject_after_turn
  { folderMillis: 1791265707340, hash: "44b870dcbcaf4ef7bec3416b36d4ab2cb58b62afb821744b49b301507bdce538", bps: true, sql: [
    "ALTER TABLE `chats` ADD `subject_key` text;",
    "\nALTER TABLE `chats` ADD `subject_data` text;",
    "\nCREATE UNIQUE INDEX `chats_owner_subject_idx` ON `chats` (`owner_id`,`subject_key`);",
    "\nALTER TABLE `messages` ADD `after_turn` text;",
    "\nCREATE INDEX `messages_after_turn_pending_idx` ON `messages` (`after_turn`) WHERE \"messages\".\"after_turn\" = 'pending';",
  ] },
  // 0016_chat_closed
  { folderMillis: 1791285236475, hash: "2b574bb852b12d867146b1a68a05c46c39840b8158b1e6382833fcf8df903a7e", bps: true, sql: [
    "ALTER TABLE `chats` ADD `closed` text;",
  ] },
  // 0017_chat_turn_leases
  { folderMillis: 1791967992215, hash: "caf472f803cc3d42322de0a601392afcefad8b9c04909051d3f7a1c1f5591373", bps: true, sql: [
    "CREATE TABLE `chat_turn_leases` (\n\t`chat_id` text PRIMARY KEY NOT NULL,\n\t`holder` text NOT NULL,\n\t`until` integer NOT NULL\n);\n",
  ] },
  // 0018_pending_bursts
  { folderMillis: 1792017491455, hash: "88c4008efaa9701f32deb336f35b66693638acb510530f399f1a4fcb922358ca", bps: true, sql: [
    "CREATE TABLE `pending_bursts` (\n\t`chat_id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`message_id` text NOT NULL,\n\t`due_at` integer NOT NULL,\n\t`holder` text NOT NULL,\n\t`held_until` integer NOT NULL,\n\t`page` text\n);\n",
  ] },
  // 0019_stop_requests
  { folderMillis: 1794403274307, hash: "7692f3fc2a232a0f2f9de347a600bc2cd35765faa737a57e7bf4bbead914d3b3", bps: true, sql: [
    "CREATE TABLE `stop_requests` (\n\t`chat_id` text NOT NULL,\n\t`turn_request_id` text NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`expires_at` integer NOT NULL,\n\tPRIMARY KEY(`chat_id`, `turn_request_id`)\n);\n",
    "\nCREATE INDEX `stop_requests_expires_idx` ON `stop_requests` (`expires_at`);",
    "\nCREATE INDEX `stop_requests_owner_idx` ON `stop_requests` (`owner_id`,`expires_at`);",
  ] },
];
