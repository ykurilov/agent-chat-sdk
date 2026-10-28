import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
const port = Number(process.env.SKIN_GALLERY_PORT ?? 5961);
export default defineConfig({
  testDir: ".", testMatch: "flow-editor-drafts.spec.ts", workers: 1, reporter: "list",
  outputDir: "../test-results/flow-editor-drafts",
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", video: "on" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: { command: "pnpm -r --workspace-concurrency=2 --filter @ykurilov/agent-chat-skin-oduvanchik... build && pnpm exec vite --config skin-gallery/vite.config.ts --host 127.0.0.1", cwd: fileURLToPath(new URL("..", import.meta.url)), env: { SKIN_GALLERY_PORT: String(port) }, url: `http://127.0.0.1:${port}/flow-editor-drafts.html`, timeout: 120_000, reuseExistingServer: false },
});
