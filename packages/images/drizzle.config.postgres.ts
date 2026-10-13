import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/image-queue/postgres-schema.ts",
  out: "./drizzle/postgres",
  schemaFilter: ["agent_chat"],
  // Таблицы учёта миграций ядра, песочницы и фона не должны попадать в снимок схемы.
  tablesFilter: ["image_jobs"],
});
