import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/journal/sqlite-schema.ts",
  out: "./drizzle/sqlite",
});
