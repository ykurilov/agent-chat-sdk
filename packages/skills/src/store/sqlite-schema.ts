import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SkillStatus } from "../types";

export const skills = sqliteTable("skills", {
  name: text("name").primaryKey(),
  whenToUse: text("when_to_use").notNull(),
  body: text("body").notNull(),
  status: text("status").$type<SkillStatus>().notNull(),
  version: integer("version").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const skillVersions = sqliteTable(
  "skill_versions",
  {
    name: text("name").notNull(),
    version: integer("version").notNull(),
    whenToUse: text("when_to_use").notNull(),
    body: text("body").notNull(),
    author: text("author").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.version] })],
);

export const skillLoads = sqliteTable(
  "skill_loads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    chatId: text("chat_id").notNull(),
    ownerId: text("owner_id").notNull(),
    turnId: text("turn_id").notNull(),
    loadedAt: integer("loaded_at").notNull(),
  },
  (table) => [index("skill_loads_name_loaded_idx").on(table.name, table.loadedAt)],
);
