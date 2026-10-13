import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/journal/postgres-schema.ts",
  out: "./drizzle/postgres",
  schemaFilter: ["agent_chat"],
  // Таблицы учёта миграций хранилища и журнала не должны попадать в снимок схемы.
  tablesFilter: ["sandbox_*"],
});
