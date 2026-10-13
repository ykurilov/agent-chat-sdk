import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/store/sqlite-schema.ts",
  out: "./drizzle/sqlite",
  // Таблицы учёта миграций и чужие таблицы той же базы не должны попадать в снимок схемы.
  tablesFilter: ["messenger_*"],
});
