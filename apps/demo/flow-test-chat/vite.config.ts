import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, searchForWorkspaceRoot } from "vite";

/** Страница стенда тестового чата: редактор сценария из исходников, запросы `/api` — на сервер стенда. */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: { conditions: [...defaultClientConditions, "@ykurilov/agent-chat-source"] },
  server: {
    port: Number(process.env.FLOW_TEST_WEB_PORT ?? 5951),
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
    proxy: { "/api": `http://localhost:${process.env.FLOW_TEST_API_PORT ?? 8951}` },
  },
});
