// Создано scripts/embed-migrations.mjs из packages/messengers/drizzle/postgres; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791177857068, hash: "39915d1a76f4cfbc008865874aa64196f1533454637bce760c90e5c399294f33", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"messenger_buttons\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"messenger\" text NOT NULL,\n\t\"bot_id\" text NOT NULL,\n\t\"external_chat_id\" text NOT NULL,\n\t\"action\" jsonb NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\t\"used_at\" timestamp (3) with time zone\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"messenger_conversations\" (\n\t\"messenger\" text NOT NULL,\n\t\"bot_id\" text NOT NULL,\n\t\"external_chat_id\" text NOT NULL,\n\t\"type\" text NOT NULL,\n\t\"user_id\" text NOT NULL,\n\t\"connected_by\" text,\n\t\"current_chat_id\" text,\n\t\"blocked\" boolean DEFAULT false NOT NULL,\n\t\"active\" boolean DEFAULT true NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL,\n\tCONSTRAINT \"messenger_conversations_messenger_bot_id_external_chat_id_pk\" PRIMARY KEY(\"messenger\",\"bot_id\",\"external_chat_id\")\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"messenger_leases\" (\n\t\"name\" text PRIMARY KEY NOT NULL,\n\t\"holder\" text NOT NULL,\n\t\"lease_until\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"messenger_link_codes\" (\n\t\"code_hash\" text PRIMARY KEY NOT NULL,\n\t\"user_id\" text NOT NULL,\n\t\"messenger\" text NOT NULL,\n\t\"expires_at\" timestamp (3) with time zone NOT NULL,\n\t\"used_at\" timestamp (3) with time zone\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"messenger_links\" (\n\t\"messenger\" text NOT NULL,\n\t\"bot_id\" text NOT NULL,\n\t\"external_user_id\" text NOT NULL,\n\t\"user_id\" text NOT NULL,\n\t\"name\" text NOT NULL,\n\t\"username\" text,\n\t\"linked_at\" timestamp (3) with time zone NOT NULL,\n\tCONSTRAINT \"messenger_links_messenger_bot_id_external_user_id_pk\" PRIMARY KEY(\"messenger\",\"bot_id\",\"external_user_id\")\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"messenger_member_hits\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"messenger\" text NOT NULL,\n\t\"bot_id\" text NOT NULL,\n\t\"external_chat_id\" text NOT NULL,\n\t\"external_user_id\" text NOT NULL,\n\t\"at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"messenger_updates\" (\n\t\"key\" text PRIMARY KEY NOT NULL,\n\t\"status\" text NOT NULL,\n\t\"received_at\" timestamp (3) with time zone NOT NULL,\n\t\"finished_at\" timestamp (3) with time zone\n);\n",
    "\nCREATE INDEX \"messenger_buttons_created_idx\" ON \"agent_chat\".\"messenger_buttons\" USING btree (\"created_at\");",
    "\nCREATE INDEX \"messenger_conversations_user_idx\" ON \"agent_chat\".\"messenger_conversations\" USING btree (\"user_id\");",
    "\nCREATE INDEX \"messenger_link_codes_expires_idx\" ON \"agent_chat\".\"messenger_link_codes\" USING btree (\"expires_at\");",
    "\nCREATE INDEX \"messenger_links_user_idx\" ON \"agent_chat\".\"messenger_links\" USING btree (\"user_id\",\"messenger\");",
    "\nCREATE INDEX \"messenger_member_hits_member_idx\" ON \"agent_chat\".\"messenger_member_hits\" USING btree (\"messenger\",\"bot_id\",\"external_chat_id\",\"external_user_id\",\"at\");",
    "\nCREATE INDEX \"messenger_updates_received_idx\" ON \"agent_chat\".\"messenger_updates\" USING btree (\"received_at\");",
  ] },
  // 0001_pending_deliveries
  { folderMillis: 1791186540027, hash: "44795a4cf1085a5965b98d873e05ac95efb421464dce375cc324e238949d3d5e", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"messenger_deliveries\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"seq\" bigserial NOT NULL,\n\t\"messenger\" text NOT NULL,\n\t\"bot_id\" text NOT NULL,\n\t\"external_chat_id\" text NOT NULL,\n\t\"payload\" jsonb NOT NULL,\n\t\"holder\" text NOT NULL,\n\t\"lease_until\" timestamp (3) with time zone NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE INDEX \"messenger_deliveries_bot_idx\" ON \"agent_chat\".\"messenger_deliveries\" USING btree (\"messenger\",\"bot_id\",\"lease_until\");",
    "\nCREATE INDEX \"messenger_deliveries_holder_idx\" ON \"agent_chat\".\"messenger_deliveries\" USING btree (\"holder\");",
  ] },
  // 0002_conversations_current_chat_idx
  { folderMillis: 1791362487518, hash: "e9e54b5e377abd811864791cd88efc015f4840aa9905dae7321214e49925c198", bps: true, sql: [
    "CREATE INDEX \"messenger_conversations_current_chat_idx\" ON \"agent_chat\".\"messenger_conversations\" USING btree (\"current_chat_id\");",
  ] },
  // 0003_inbound_updates_recovery
  { folderMillis: 1791362712569, hash: "5eeb24d6d9fb93e7a765b74ca5832dd7608753aae36e6de49755e84d40c54b89", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"messenger_updates\" ADD COLUMN \"messenger\" text;",
    "\nALTER TABLE \"agent_chat\".\"messenger_updates\" ADD COLUMN \"bot_id\" text;",
    "\nALTER TABLE \"agent_chat\".\"messenger_updates\" ADD COLUMN \"payload\" jsonb;",
    "\nALTER TABLE \"agent_chat\".\"messenger_updates\" ADD COLUMN \"holder\" text;",
    "\nALTER TABLE \"agent_chat\".\"messenger_updates\" ADD COLUMN \"lease_until\" timestamp (3) with time zone;",
    "\nALTER TABLE \"agent_chat\".\"messenger_updates\" ADD COLUMN \"attempts\" integer DEFAULT 0 NOT NULL;",
    "\nCREATE INDEX \"messenger_updates_work_idx\" ON \"agent_chat\".\"messenger_updates\" USING btree (\"messenger\",\"bot_id\",\"lease_until\");",
  ] },
];
