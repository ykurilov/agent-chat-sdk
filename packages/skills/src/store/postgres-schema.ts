import { bigserial, index, integer, pgSchema, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { SkillStatus } from "../types";

/** Та же схема базы, что у хранилища чатов: у приложения одна база и одна схема `agent_chat`. */
const agentChatSchema = pgSchema("agent_chat");

const moment = (name: string) => timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const skills = agentChatSchema.table("skills", {
  name: text("name").primaryKey(),
  whenToUse: text("when_to_use").notNull(),
  body: text("body").notNull(),
  status: text("status").$type<SkillStatus>().notNull(),
  version: integer("version").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: moment("created_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: moment("updated_at").notNull(),
});

export const skillVersions = agentChatSchema.table(
  "skill_versions",
  {
    name: text("name").notNull(),
    version: integer("version").notNull(),
    whenToUse: text("when_to_use").notNull(),
    body: text("body").notNull(),
    author: text("author").notNull(),
    createdAt: moment("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.version] })],
);

export const skillLoads = agentChatSchema.table(
  "skill_loads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    chatId: text("chat_id").notNull(),
    ownerId: text("owner_id").notNull(),
    turnId: text("turn_id").notNull(),
    loadedAt: moment("loaded_at").notNull(),
  },
  (table) => [index("skill_loads_name_loaded_idx").on(table.name, table.loadedAt)],
);
