import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.FLOW_TEST_API_PORT ?? 8951);
const webPort = Number(process.env.FLOW_TEST_WEB_PORT ?? 5951);
const cwd = fileURLToPath(new URL("..", import.meta.url));
const env = { FLOW_TEST_API_PORT: String(apiPort), FLOW_TEST_WEB_PORT: String(webPort) };

/** Тестовый чат сценария на модели-заглушке: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c flow-test-chat/playwright.config.ts`. */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${webPort}`, trace: "retain-on-failure" },
  projects: [{ name: "flow-test-chat", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "pnpm exec tsx --conditions=@ykurilov/agent-chat-source flow-test-chat/server.ts",
      url: `http://localhost:${apiPort}/api/flow-test/health`,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd,
    },
    {
      command: "pnpm exec vite --config flow-test-chat/vite.config.ts",
      url: `http://localhost:${webPort}`,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd,
    },
  ],
});
