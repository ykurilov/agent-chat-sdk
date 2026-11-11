// Создано scripts/embed-migrations.mjs из packages/storage-postgres/drizzle; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1790715871912, hash: "5bda099f3dd949b1d48959adaae5ba3180b5245db34026bb4b8b674d3f774400", bps: true, sql: [
    "CREATE SCHEMA IF NOT EXISTS \"agent_chat\";\n",
    "\nCREATE TABLE \"agent_chat\".\"chats\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"model_id\" text NOT NULL,\n\t\"provider_id\" text NOT NULL,\n\t\"created_at\" text NOT NULL,\n\t\"updated_at\" text NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"messages\" (\n\t\"seq\" bigint GENERATED ALWAYS AS IDENTITY (sequence name \"agent_chat\".\"messages_seq_seq\" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"parent_id\" text,\n\t\"role\" text NOT NULL,\n\t\"parts\" json NOT NULL,\n\t\"format_version\" integer NOT NULL,\n\t\"status\" text NOT NULL,\n\t\"model_id\" text,\n\t\"provider_id\" text,\n\t\"usage\" json,\n\t\"reasoning_durations_ms\" json NOT NULL,\n\t\"error\" json,\n\t\"created_at\" text NOT NULL\n);\n",
    "\nALTER TABLE \"agent_chat\".\"messages\" ADD CONSTRAINT \"messages_chat_id_chats_id_fk\" FOREIGN KEY (\"chat_id\") REFERENCES \"agent_chat\".\"chats\"(\"id\") ON DELETE cascade ON UPDATE no action;",
    "\nCREATE INDEX \"chats_owner_updated_idx\" ON \"agent_chat\".\"chats\" USING btree (\"owner_id\",\"updated_at\");",
    "\nCREATE INDEX \"messages_chat_created_idx\" ON \"agent_chat\".\"messages\" USING btree (\"chat_id\",\"created_at\",\"seq\");",
    "\nCREATE INDEX \"messages_streaming_idx\" ON \"agent_chat\".\"messages\" USING btree (\"status\") WHERE \"agent_chat\".\"messages\".\"status\" = 'streaming';",
  ] },
  // 0001_chat_reasoning
  { folderMillis: 1790718471271, hash: "ea0c40817fb8618fb95f9ad20744688d3eed2dbef79830041ca967944f312376", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"chats\" ADD COLUMN \"reasoning\" text;",
  ] },
  // 0002_compactions
  { folderMillis: 1790721546337, hash: "ef8ad0fbd22be1d1015ee8dad8e2f6138d01b28a7403aecbe12d18ee895d52ba", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"compactions\" (\n\t\"seq\" bigint GENERATED ALWAYS AS IDENTITY (sequence name \"agent_chat\".\"compactions_seq_seq\" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"from_message_id\" text NOT NULL,\n\t\"through_message_id\" text NOT NULL,\n\t\"summary\" text NOT NULL,\n\t\"summary_tokens\" integer NOT NULL,\n\t\"model_id\" text NOT NULL,\n\t\"provider_id\" text NOT NULL,\n\t\"usage\" json,\n\t\"created_at\" text NOT NULL\n);\n",
    "\nALTER TABLE \"agent_chat\".\"compactions\" ADD CONSTRAINT \"compactions_chat_id_chats_id_fk\" FOREIGN KEY (\"chat_id\") REFERENCES \"agent_chat\".\"chats\"(\"id\") ON DELETE cascade ON UPDATE no action;",
    "\nCREATE INDEX \"compactions_chat_seq_idx\" ON \"agent_chat\".\"compactions\" USING btree (\"chat_id\",\"seq\");",
  ] },
  // 0003_branch_selections
  { folderMillis: 1790735648692, hash: "10c33b0e6010b035042a8660f35ed29a0593fae4c54ecc2740d75cc3af55153d", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"branch_selections\" (\n\t\"seq\" bigint GENERATED ALWAYS AS IDENTITY (sequence name \"agent_chat\".\"branch_selections_seq_seq\" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"message_id\" text NOT NULL,\n\t\"selected_at\" text NOT NULL\n);\n",
    "\nALTER TABLE \"agent_chat\".\"branch_selections\" ADD CONSTRAINT \"branch_selections_chat_id_chats_id_fk\" FOREIGN KEY (\"chat_id\") REFERENCES \"agent_chat\".\"chats\"(\"id\") ON DELETE cascade ON UPDATE no action;",
    "\nCREATE INDEX \"branch_selections_chat_seq_idx\" ON \"agent_chat\".\"branch_selections\" USING btree (\"chat_id\",\"seq\");",
  ] },
  // 0004_chat_title
  { folderMillis: 1790738333623, hash: "7a54293f92dad4eb6ee2db7b81587ea01ca66a60d647127f04842c87dbcef1fd", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"chats\" ADD COLUMN \"title\" text;",
    "\n-- Названия у прежних чатов: из первого текста первого сообщения собеседника, как это делает ядро\n-- (пробелы схлопнуты, не длиннее 60 знаков и «…»).\nUPDATE \"agent_chat\".\"chats\" AS c SET \"title\" = (\n  SELECT CASE\n    WHEN char_length(t) = 0 THEN NULL\n    WHEN char_length(t) > 60 THEN rtrim(left(t, 60)) || '…'\n    ELSE t\n  END\n  FROM (\n    SELECT btrim(regexp_replace(x, '\\s+', ' ', 'g')) AS t\n    FROM (\n      SELECT (\n        SELECT p->>'text' FROM json_array_elements(m.parts) AS p\n        WHERE p->>'type' = 'text' LIMIT 1\n      ) AS x\n      FROM \"agent_chat\".\"messages\" AS m\n      WHERE m.chat_id = c.id AND m.role = 'user'\n      ORDER BY m.created_at, m.seq LIMIT 1\n    ) AS first_text\n  ) AS cleaned\n);\n",
  ] },
  // 0005_usage_records
  { folderMillis: 1790740141054, hash: "42471afa5087b46a870158f268e68a53d9411042772aa19de466479ac56707ce", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"usage_records\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"message_id\" text,\n\t\"source\" text NOT NULL,\n\t\"model_id\" text NOT NULL,\n\t\"provider_id\" text NOT NULL,\n\t\"input_tokens\" bigint NOT NULL,\n\t\"cached_input_tokens\" bigint NOT NULL,\n\t\"cache_write_tokens\" bigint NOT NULL,\n\t\"output_tokens\" bigint NOT NULL,\n\t\"reasoning_tokens\" bigint NOT NULL,\n\t\"cost_usd\" double precision NOT NULL,\n\t\"created_at\" text NOT NULL\n);\n",
    "\nCREATE INDEX \"usage_records_owner_created_idx\" ON \"agent_chat\".\"usage_records\" USING btree (\"owner_id\",\"created_at\");",
    "\nCREATE INDEX \"usage_records_chat_created_idx\" ON \"agent_chat\".\"usage_records\" USING btree (\"chat_id\",\"created_at\");",
  ] },
  // 0006_user_model_choices
  { folderMillis: 1790752789473, hash: "ce1b90d09141be18d69b1dffc646e8e99142babe88009795e2c98659c3c49705", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"user_model_choices\" (\n\t\"owner_id\" text PRIMARY KEY NOT NULL,\n\t\"model_id\" text NOT NULL,\n\t\"provider_id\" text NOT NULL,\n\t\"reasoning\" text,\n\t\"updated_at\" text NOT NULL\n);\n",
  ] },
  // 0007_voice_dialog
  { folderMillis: 1790755965363, hash: "1c17ca71d7377ff7304e0d7befd89aa889e01b81d1dee56b97024afbcff3aa67", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"voice_choices\" (\n\t\"owner_id\" text PRIMARY KEY NOT NULL,\n\t\"voice_id\" text NOT NULL,\n\t\"updated_at\" text NOT NULL\n);\n",
    "\nALTER TABLE \"agent_chat\".\"messages\" ADD COLUMN \"voice_cut\" json;",
  ] },
  // 0008_memory_notes
  { folderMillis: 1790759982638, hash: "652d3eea6b62dad2c2edc7ffb306909f8ca69dd911210ee7425d2f08800ea448", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"memory_notes\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"categories\" jsonb NOT NULL,\n\t\"content\" text NOT NULL,\n\t\"version\" integer DEFAULT 1 NOT NULL,\n\t\"created_at\" timestamp with time zone NOT NULL,\n\t\"updated_at\" timestamp with time zone NOT NULL\n);\n",
    "\nCREATE INDEX \"memory_notes_owner_updated_idx\" ON \"agent_chat\".\"memory_notes\" USING btree (\"owner_id\",\"updated_at\");",
  ] },
  // 0009_memory_optimization
  { folderMillis: 1790761236531, hash: "3b8e31b07b1e28bbf864560629b2d2bd309d237620379a6f959a95fef23de39e", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"memory_optimization_runs\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"started_at\" timestamp with time zone NOT NULL,\n\t\"finished_at\" timestamp with time zone,\n\t\"status\" text NOT NULL,\n\t\"groups\" jsonb DEFAULT '[]'::jsonb NOT NULL,\n\t\"error\" text,\n\t\"usage_record_id\" text\n);\n",
    "\nALTER TABLE \"agent_chat\".\"memory_notes\" ADD COLUMN \"merged_into\" text;",
    "\nCREATE INDEX \"memory_optimization_runs_owner_started_idx\" ON \"agent_chat\".\"memory_optimization_runs\" USING btree (\"owner_id\",\"started_at\");",
    "\nCREATE UNIQUE INDEX \"memory_optimization_runs_one_running_idx\" ON \"agent_chat\".\"memory_optimization_runs\" USING btree (\"owner_id\") WHERE \"agent_chat\".\"memory_optimization_runs\".\"status\" = 'running';",
    "\nCREATE INDEX \"memory_notes_merged_into_idx\" ON \"agent_chat\".\"memory_notes\" USING btree (\"merged_into\");",
  ] },
  // 0010_usage_estimated
  { folderMillis: 1790938846233, hash: "8aecf90b7f91c5fdd145f34a40b37a7f48eb241406c3ce57a029cefd303fd45b", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"usage_records\" ADD COLUMN \"estimated\" boolean DEFAULT false NOT NULL;",
  ] },
  // 0011_message_alive_at
  { folderMillis: 1790944385687, hash: "4e5a3fe4945d5208f4c2df006d8e153fdc8b9268ebc9a08ed4b6b4ecf7a82c66", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"messages\" ADD COLUMN \"alive_at\" text;",
  ] },
  // 0012_spending_limit_states
  { folderMillis: 1791185874971, hash: "fdd524d59380eb0fea94d3a2a8c28ae1ac98fcd08446d797b653a16b1434c05a", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"spending_limit_states\" (\n\t\"key\" text PRIMARY KEY NOT NULL,\n\t\"value\" text NOT NULL,\n\t\"version\" integer NOT NULL,\n\t\"updated_at\" text NOT NULL\n);\n",
  ] },
  // 0013_chat_origin
  { folderMillis: 1791197610368, hash: "af64ddc45fd3715d9fd2031860d7fd4a5ec7fa7d15e51c130956d0be3e06e398", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"chats\" ADD COLUMN \"origin\" text;",
  ] },
  // 0014_chat_subject_after_turn
  { folderMillis: 1791265708083, hash: "3c58fce1fd0c6440492a6da8ccbf1d58044dcdd38a40cb6e01220281db1d7fe1", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"chats\" ADD COLUMN \"subject_key\" text;",
    "\nALTER TABLE \"agent_chat\".\"chats\" ADD COLUMN \"subject_data\" json;",
    "\nALTER TABLE \"agent_chat\".\"messages\" ADD COLUMN \"after_turn\" text;",
    "\nCREATE UNIQUE INDEX \"chats_owner_subject_idx\" ON \"agent_chat\".\"chats\" USING btree (\"owner_id\",\"subject_key\");",
    "\nCREATE INDEX \"messages_after_turn_pending_idx\" ON \"agent_chat\".\"messages\" USING btree (\"after_turn\") WHERE \"agent_chat\".\"messages\".\"after_turn\" = 'pending';",
  ] },
  // 0015_chat_closed
  { folderMillis: 1791285255799, hash: "0f8402da4644ae030f8935bedcc35ea41f53d24a0083717506357562fcdae219", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"chats\" ADD COLUMN \"closed\" json;",
  ] },
  // 0016_chat_turn_leases
  { folderMillis: 1791968017742, hash: "840ddf4a0c8bff43b2241a339d7aa67abf7cb3a59cd396fd6f1f380c79632d0f", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"chat_turn_leases\" (\n\t\"chat_id\" text PRIMARY KEY NOT NULL,\n\t\"holder\" text NOT NULL,\n\t\"until\" timestamp with time zone NOT NULL\n);\n",
  ] },
  // 0017_pending_bursts
  { folderMillis: 1792017521169, hash: "a533a271a5a9c8154a8320b608727d34fe0e0a3969ff880501cf59792d944914", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"pending_bursts\" (\n\t\"chat_id\" text PRIMARY KEY NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"message_id\" text NOT NULL,\n\t\"due_at\" timestamp with time zone NOT NULL,\n\t\"holder\" text NOT NULL,\n\t\"held_until\" timestamp with time zone NOT NULL,\n\t\"page\" jsonb\n);\n",
  ] },
  // 0018_usage_created_index
  { folderMillis: 1793442948920, hash: "309053a858e4d5da6ab55fb22282b4dfdc45ba9c3a35a2a665cc00231477fccd", bps: true, sql: [
    "CREATE INDEX \"usage_records_created_idx\" ON \"agent_chat\".\"usage_records\" USING btree (\"created_at\");",
  ] },
  // 0019_stop_requests
  { folderMillis: 1794403275223, hash: "b2b13cca84b216efcc536e2b2f51c354abebdaf28a758edbcc7918b9f9b942a4", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"stop_requests\" (\n\t\"chat_id\" text NOT NULL,\n\t\"turn_request_id\" text NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"expires_at\" timestamp with time zone NOT NULL,\n\tCONSTRAINT \"stop_requests_chat_id_turn_request_id_pk\" PRIMARY KEY(\"chat_id\",\"turn_request_id\")\n);\n",
    "\nCREATE INDEX \"stop_requests_expires_idx\" ON \"agent_chat\".\"stop_requests\" USING btree (\"expires_at\");",
    "\nCREATE INDEX \"stop_requests_owner_idx\" ON \"agent_chat\".\"stop_requests\" USING btree (\"owner_id\",\"expires_at\");",
  ] },
];
