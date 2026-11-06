import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const port = Number(process.env.SKIN_GALLERY_PORT ?? 5987);
export default defineConfig({
  testDir: ".", testMatch: "native-fetch.spec.ts", workers: 1, reporter: "list", timeout: 60000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }],
  webServer: {
    command: "pnpm -r --workspace-concurrency=2 --filter @ykurilov/agent-chat-skin-oduvanchik... --filter @ykurilov/agent-chat-attachments... build && pnpm exec vite --config skin-gallery/vite.config.ts --host 127.0.0.1",
    cwd: fileURLToPath(new URL("..", import.meta.url)), url: `http://127.0.0.1:${port}/native-fetch.html`,
    env: { SKIN_GALLERY_PORT: String(port) }, reuseExistingServer: false, timeout: 180000,
  },
});
