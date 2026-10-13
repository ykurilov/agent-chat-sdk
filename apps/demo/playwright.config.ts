import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Порты можно сменить, если рядом идёт другой прогон (другая ветка на этой же машине).
const apiPort = Number(process.env.DEMO_E2E_API_PORT ?? 8931);
const webPort = Number(process.env.DEMO_E2E_WEB_PORT ?? 5931);
// Файл базы и папку сборки задаёт главный процесс; процессы тестов наследуют их через окружение.
const runId = (process.env.DEMO_E2E_RUN_ID ??= `${process.pid}-${Date.now()}`);
const databaseFile = (process.env.DEMO_E2E_DB_FILE ??= join(tmpdir(), `agent-chat-e2e-${runId}.sqlite`));
const distDir = (process.env.DEMO_E2E_DIST ??= join(tmpdir(), `agent-chat-e2e-dist-${runId}`));

/*
 * Как устроен прогон (подробнее: apps/demo/e2e-coverage.md).
 * Демо раздаётся собранным (`vite build` + `vite preview`): так его видит пользователь, и замеры скорости
 * не зависят от режима разработки.
 *
 * `pnpm test:e2e` — проверки поведения, все одновременно, у каждого теста свой чат:
 *   timing         — замеры сроков связи (30, 45, 75 с): настоящие ожидания на своих серверах, процессор почти не грузят;
 *   iphone-webkit  — то, в чём Safari отличается: лента;
 *   desktop-light  — сценарии на компьютере, один раз (тесты с пометкой @long — настоящие долгие ожидания);
 *   desktop-dark   — тёмная тема, только снимки и проверка цветов;
 *   iphone-light   — то, что зависит от экрана телефона: лента, вёрстка.
 * Долгие группы стоят первыми: воркеры берут тесты по порядку групп, и долгие ожидания идут рядом с остальными, а не в хвосте.
 * Тесты, которые роняют сервер или меняют имитацию связи, поднимают свой сервер (support/own-server.ts).
 *
 * `pnpm test:e2e:perf` (`DEMO_E2E_PERF=1`) — замеры скорости, отдельно от проверок поведения и без соседей:
 * телефон с замедлением процессора ×4, затем компьютер. Запускать после правок, влияющих на скорость, и в конце этапа.
 */

// Профили iPhone с замерами времени идут в Chromium: там есть замедление процессора и наблюдатель долгих задач.
const iphone = { ...devices["iPhone 15"], browserName: "chromium" as const, defaultBrowserType: "chromium" as const };
// Такие разрешения знает только Chromium; WebKit на них падает при открытии страницы.
const clipboard = ["clipboard-read", "clipboard-write"];

// Всё, что не относится к телефону и замерам, идёт на компьютере: новый файл с проверкой попадёт сюда сам.
const notOnDesktop = ["phone.spec.ts", "model-picker-phone.spec.ts", "branches-phone.spec.ts", "chat-list-phone.spec.ts", "tool-approval-phone.spec.ts", "widgets-phone.spec.ts", "diagrams-phone.spec.ts", "live-demos-phone.spec.ts", "images-phone.spec.ts", "videos-phone.spec.ts", "memory-phone.spec.ts", "agent-panel-phone.spec.ts", "sandbox-phone.spec.ts", "composer-actions-phone.spec.ts", "steering-phone.spec.ts", "simple-work-view-phone.spec.ts", "feed.spec.ts", "voice-dialog-phone.spec.ts", "voice-dialog-webkit.spec.ts", "perf-*.spec.ts", "timing.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  workers: 6,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "timing",
      fullyParallel: true,
      testMatch: "timing.spec.ts",
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "iphone-webkit",
      fullyParallel: true,
      testMatch: ["feed.spec.ts", "voice-dialog-webkit.spec.ts", "live-demos-escape.spec.ts"],
      use: { ...devices["iPhone 15"], browserName: "webkit", colorScheme: "light" },
    },
    {
      name: "desktop-light",
      fullyParallel: true,
      testIgnore: notOnDesktop,
      use: { ...devices["Desktop Chrome"], colorScheme: "light", permissions: clipboard },
    },
    {
      name: "desktop-dark",
      fullyParallel: true,
      testMatch: "themes.spec.ts",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark", permissions: clipboard },
    },
    {
      name: "iphone-light",
      fullyParallel: true,
      testMatch: ["phone.spec.ts", "model-picker-phone.spec.ts", "branches-phone.spec.ts", "chat-list-phone.spec.ts", "tool-approval-phone.spec.ts", "widgets-phone.spec.ts", "diagrams-phone.spec.ts", "live-demos-phone.spec.ts", "images-phone.spec.ts", "videos-phone.spec.ts", "memory-phone.spec.ts", "agent-panel-phone.spec.ts", "sandbox-phone.spec.ts", "composer-actions-phone.spec.ts", "steering-phone.spec.ts", "simple-work-view-phone.spec.ts", "feed.spec.ts", "liveness-screen.spec.ts", "voice-dialog-phone.spec.ts"],
      use: { ...iphone, colorScheme: "light", permissions: clipboard },
    },
    // Замеры скорости: не входят в обычный прогон, включаются `DEMO_E2E_PERF=1` (`pnpm test:e2e:perf`).
    ...(process.env.DEMO_E2E_PERF
      ? [
          {
            name: "perf-phone",
            fullyParallel: false,
            testMatch: "perf-feed.spec.ts",
            use: { ...iphone, colorScheme: "light" as const, permissions: clipboard },
          },
          {
            name: "perf-desktop",
            dependencies: ["perf-phone"],
            fullyParallel: false,
            testMatch: ["perf-latency.spec.ts", "perf-panel-open.spec.ts"],
            use: { ...devices["Desktop Chrome"], colorScheme: "light" as const },
          },
        ]
      : []),
    // Замер задержки голосового режима на подменах: не входит в обычный прогон, включается `DEMO_E2E_DIALOG_LATENCY=1`.
    ...(process.env.DEMO_E2E_DIALOG_LATENCY
      ? [
          {
            name: "dialog-latency",
            fullyParallel: false,
            testMatch: "perf-dialog-latency.spec.ts",
            use: { ...devices["Desktop Chrome"], colorScheme: "light" as const },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: "pnpm exec tsx --conditions=@ykurilov/agent-chat-source server/index.ts",
      url: `http://localhost:${apiPort}/api/health`,
      env: { DEMO_MODEL: "mock", DEMO_API_PORT: String(apiPort), DEMO_WEB_PORT: String(webPort), DEMO_DB_FILE: databaseFile },
      reuseExistingServer: false,
    },
    {
      // Одна сборка на прогон: в ней же проверяем, что в браузер не попали ключи (SC-007, FR-025).
      command: `pnpm exec vite build --logLevel warn --outDir ${distDir} --emptyOutDir && node ../../scripts/check-no-secrets.mjs ${distDir} && pnpm exec vite preview --outDir ${distDir}`,
      url: `http://localhost:${webPort}`,
      env: { DEMO_API_PORT: String(apiPort), DEMO_WEB_PORT: String(webPort) },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
