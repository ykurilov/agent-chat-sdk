import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, searchForWorkspaceRoot } from "vite";

/** Витрина скина для снимков экрана: пакеты чата берутся из исходников, как в демо. */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: { conditions: [...defaultClientConditions, "@ykurilov/agent-chat-source"] },
  server: {
    port: Number(process.env.SKIN_GALLERY_PORT ?? 5941),
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
});
