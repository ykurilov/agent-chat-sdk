import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const port = Number(process.env.SKIN_GALLERY_PORT ?? 5960);
const apiPort = Number(process.env.FLOW_TEST_API_PORT ?? 8960);
const cwd = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: ".", testMatch: "flow-navigation.spec.ts", workers: 1, reporter: "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "webkit", use: { browserName: "webkit", viewport: { width: 1440, height: 1000 } } },
    { name: "phone-webkit", use: { ...devices["iPhone 15"], browserName: "webkit" } },
    { name: "phone-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: [
    { command: "pnpm exec tsx --conditions=@ykurilov/agent-chat-source flow-test-chat/server.ts", cwd,
      env: { FLOW_TEST_API_PORT: String(apiPort) }, url: `http://127.0.0.1:${apiPort}/api/flow-test/health`, reuseExistingServer: false, timeout: 60_000 },
    { command: "pnpm -r --workspace-concurrency=4 --filter @ykurilov/agent-chat-skin-oduvanchik... build && pnpm exec vite --config skin-gallery/oduvanchik-flows.vite.config.ts --host 127.0.0.1", cwd,
      env: { FLOW_TEST_API_PORT: String(apiPort), SKIN_GALLERY_PORT: String(port) }, url: `http://127.0.0.1:${port}/oduvanchik-flows.html`, stdout: "pipe", reuseExistingServer: false, timeout: 120_000 },
  ],
});
