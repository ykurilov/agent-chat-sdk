import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Привязанный аккаунт: человек в мессенджере ↔ пользователь приложения. */
export const messengerLinks = sqliteTable(
  "messenger_links",
  {
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }).notNull(),
    botId: text("bot_id").notNull(),
    externalUserId: text("external_user_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    username: text("username"),
    linkedAt: integer("linked_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messenger, table.botId, table.externalUserId] }), index("messenger_links_user_idx").on(table.userId, table.messenger)],
);

/** Одноразовые коды привязки: хранится только хеш кода. */
export const messengerLinkCodes = sqliteTable(
  "messenger_link_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: text("user_id").notNull(),
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }).notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (table) => [index("messenger_link_codes_expires_idx").on(table.expiresAt)],
);

/** Внешний чат (личный или группа): кому он засчитывается, какой чат агента сейчас ведётся, можно ли писать. */
export const messengerConversations = sqliteTable(
  "messenger_conversations",
  {
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }).notNull(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    type: text("type", { enum: ["private", "group"] }).notNull(),
    /** Личный чат — привязанный пользователь; группа — плательщик. */
    userId: text("user_id").notNull(),
    /** Группа: кто подключил бота. */
    connectedBy: text("connected_by"),
    currentChatId: text("current_chat_id"),
    /** Человек заблокировал бота: писать ему нельзя. */
    blocked: integer("blocked", { mode: "boolean" }).notNull().default(false),
    /** `false` — бота убрали из группы. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messenger, table.botId, table.externalChatId] }), index("messenger_conversations_user_idx").on(table.userId), index("messenger_conversations_current_chat_idx").on(table.currentChatId)],
);

/** Обращения участника группы к боту: по ним считается предел за час. */
export const messengerMemberHits = sqliteTable(
  "messenger_member_hits",
  {
    id: text("id").primaryKey(),
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }).notNull(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    externalUserId: text("external_user_id").notNull(),
    at: integer("at").notNull(),
  },
  (table) => [index("messenger_member_hits_member_idx").on(table.messenger, table.botId, table.externalChatId, table.externalUserId, table.at)],
);

/**
 * Принятые обновления мессенджера: повтор с тем же ключом второй раз не обрабатывается. Необработанное обновление
 * лежит с содержимым за копией сервера до `lease_until`: упала — его забирает другая копия.
 */
export const messengerUpdates = sqliteTable(
  "messenger_updates",
  {
    key: text("key").primaryKey(),
    status: text("status", { enum: ["received", "done", "failed"] }).notNull(),
    receivedAt: integer("received_at").notNull(),
    finishedAt: integer("finished_at"),
    // Обновление в работе: чьё, содержимое, за кем до какого срока, сколько раз забрано. У метки и законченного — пусто.
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }),
    botId: text("bot_id"),
    payload: text("payload", { mode: "json" }),
    holder: text("holder"),
    leaseUntil: integer("lease_until"),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [index("messenger_updates_received_idx").on(table.receivedAt), index("messenger_updates_work_idx").on(table.messenger, table.botId, table.leaseUntil)],
);

/** Кнопки под сообщениями: короткий номер → действие (в кнопку мессенджера длинное действие не влезает). */
export const messengerButtons = sqliteTable(
  "messenger_buttons",
  {
    id: text("id").primaryKey(),
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }).notNull(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    action: text("action", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
    usedAt: integer("used_at"),
  },
  (table) => [index("messenger_buttons_created_idx").on(table.createdAt)],
);

/** Аренда опроса: один опрашивающий на бота из всех копий сервера. */
export const messengerLeases = sqliteTable("messenger_leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  leaseUntil: integer("lease_until").notNull(),
});

/** Очередь отправки: итоги, ещё не ушедшие в мессенджер, за копией сервера до `lease_until`. Порядок — `rowid`. */
export const messengerDeliveries = sqliteTable(
  "messenger_deliveries",
  {
    id: text("id").primaryKey(),
    messenger: text("messenger", { enum: ["telegram", "vk", "max"] }).notNull(),
    botId: text("bot_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    holder: text("holder").notNull(),
    leaseUntil: integer("lease_until").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("messenger_deliveries_bot_idx").on(table.messenger, table.botId, table.leaseUntil), index("messenger_deliveries_holder_idx").on(table.holder)],
);
