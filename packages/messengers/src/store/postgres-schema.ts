import { bigserial, boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Та же схема базы, что у хранилища чатов: у приложения одна база и одна схема `agent_chat`. */
const agentChatSchema = pgSchema("agent_chat");

const moment = (name: string) => timestamp(name, { mode: "date", precision: 3, withTimezone: true });
const messengerColumn = () => text("messenger", { enum: ["telegram", "vk", "max"] }).notNull();

/** Привязанный аккаунт: человек в мессенджере ↔ пользователь приложения. */
export const messengerLinks = agentChatSchema.table(
  "messenger_links",
  {
    messenger: messengerColumn(),
    botId: text("bot_id").notNull(),
    externalUserId: text("external_user_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    username: text("username"),
    linkedAt: moment("linked_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messenger, table.botId, table.externalUserId] }), index("messenger_links_user_idx").on(table.userId, table.messenger)],
);

/** Одноразовые коды привязки: хранится только хеш кода. */
export const messengerLinkCodes = agentChatSchema.table(
  "messenger_link_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: text("user_id").notNull(),
    messenger: messengerColumn(),
    expiresAt: moment("expires_at").notNull(),
    usedAt: moment("used_at"),
  },
  (table) => [index("messenger_link_codes_expires_idx").on(table.expiresAt)],
);

/** Внешний чат (личный или группа): кому он засчитывается, какой чат агента сейчас ведётся, можно ли писать. */
export const messengerConversations = agentChatSchema.table(
  "messenger_conversations",
  {
    messenger: messengerColumn(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    type: text("type", { enum: ["private", "group"] }).notNull(),
    /** Личный чат — привязанный пользователь; группа — плательщик. */
    userId: text("user_id").notNull(),
    /** Группа: кто подключил бота. */
    connectedBy: text("connected_by"),
    currentChatId: text("current_chat_id"),
    /** Человек заблокировал бота: писать ему нельзя. */
    blocked: boolean("blocked").notNull().default(false),
    /** `false` — бота убрали из группы. */
    active: boolean("active").notNull().default(true),
    createdAt: moment("created_at").notNull(),
    updatedAt: moment("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messenger, table.botId, table.externalChatId] }), index("messenger_conversations_user_idx").on(table.userId), index("messenger_conversations_current_chat_idx").on(table.currentChatId)],
);

/** Обращения участника группы к боту: по ним считается предел за час. */
export const messengerMemberHits = agentChatSchema.table(
  "messenger_member_hits",
  {
    id: text("id").primaryKey(),
    messenger: messengerColumn(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    externalUserId: text("external_user_id").notNull(),
    at: moment("at").notNull(),
  },
  (table) => [index("messenger_member_hits_member_idx").on(table.messenger, table.botId, table.externalChatId, table.externalUserId, table.at)],
);

/**
 * Принятые обновления мессенджера: повтор с тем же ключом второй раз не обрабатывается. Необработанное обновление
 * лежит с содержимым за копией сервера до `lease_until`: упала — его забирает другая копия.
 */
export const messengerUpdates = agentChatSchema.table(
  "messenger_updates",
  {
    key: text("key").primaryKey(),
    status: text("status", { enum: ["received", "done", "failed"] }).notNull(),
    receivedAt: moment("received_at").notNull(),
    finishedAt: moment("finished_at"),
    // Обновление в работе: чьё, содержимое, за кем до какого срока, сколько раз забрано. У метки и законченного — пусто.
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }),
    botId: text("bot_id"),
    payload: jsonb("payload"),
    holder: text("holder"),
    leaseUntil: moment("lease_until"),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [index("messenger_updates_received_idx").on(table.receivedAt), index("messenger_updates_work_idx").on(table.messenger, table.botId, table.leaseUntil)],
);

/** Кнопки под сообщениями: короткий номер → действие (в кнопку мессенджера длинное действие не влезает). */
export const messengerButtons = agentChatSchema.table(
  "messenger_buttons",
  {
    id: text("id").primaryKey(),
    messenger: messengerColumn(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    action: jsonb("action").notNull(),
    createdAt: moment("created_at").notNull(),
    usedAt: moment("used_at"),
  },
  (table) => [index("messenger_buttons_created_idx").on(table.createdAt)],
);

/** Аренда опроса: один опрашивающий на бота из всех копий сервера. */
export const messengerLeases = agentChatSchema.table("messenger_leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  leaseUntil: moment("lease_until").notNull(),
});

/** Очередь отправки: итоги, ещё не ушедшие в мессенджер, за копией сервера до `lease_until`. Порядок — `seq`. */
export const messengerDeliveries = agentChatSchema.table(
  "messenger_deliveries",
  {
    id: text("id").primaryKey(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    messenger: messengerColumn(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    payload: jsonb("payload").notNull(),
    holder: text("holder").notNull(),
    leaseUntil: moment("lease_until").notNull(),
    createdAt: moment("created_at").notNull(),
  },
  (table) => [index("messenger_deliveries_bot_idx").on(table.messenger, table.botId, table.leaseUntil), index("messenger_deliveries_holder_idx").on(table.holder)],
);
