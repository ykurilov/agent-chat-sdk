import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, searchForWorkspaceRoot } from "vite";
import type { ProxyOptions } from "vite";

const apiPort = Number(process.env.DEMO_API_PORT ?? 8627);

const apiProxy: Record<string, ProxyOptions> = {
  "/api": {
    target: `http://localhost:${apiPort}`,
    // Голос идёт на сервер по WebSocket (`/api/voice/stream`).
    ws: true,
    configure: (proxy) => {
      // Сервер демо упал посреди потока: рвём и соединение с браузером, как было бы без прокси.
      // Иначе прокси держит его открытым, и вкладка вечно ждёт продолжения ответа.
      proxy.on("proxyRes", (proxyRes, _request, response) => {
        proxyRes.on("close", () => {
          if (!proxyRes.complete) response.destroy();
        });
      });
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Внутри репозитория пакеты чата берутся из исходников, без сборки: условие из `exports` каждого пакета.
    conditions: [...defaultClientConditions, "@ykurilov/agent-chat-source"],
  },
  server: {
    port: Number(process.env.DEMO_WEB_PORT ?? 5627),
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
    proxy: apiProxy,
  },
  // Собранное демо (`vite preview`) ходит на тот же сервер: e2e проверяют сборку, какую видит пользователь.
  preview: {
    port: Number(process.env.DEMO_WEB_PORT ?? 5627),
    strictPort: true,
    proxy: apiProxy,
  },
});
