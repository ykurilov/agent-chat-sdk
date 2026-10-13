import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SKIN_GALLERY_PORT ?? 5941);

/** Снимки и вёрстка скина без сервера чата: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c skin-gallery/playwright.config.ts`. */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "skin-gallery", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite --config skin-gallery/vite.config.ts",
    url: `http://localhost:${port}`,
    env: { SKIN_GALLERY_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  },
});
