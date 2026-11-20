import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SKIN_GALLERY_PORT ?? 5941);
/** Проверки со своим конфигом (свой сервер, размер окна) в общий прогон не входят: общий конфиг ставит им не те условия. Их запускает свой `<имя>.playwright.config.ts`. */
const withOwnConfig = readdirSync(fileURLToPath(new URL(".", import.meta.url)))
  .filter((file) => file.endsWith(".playwright.config.ts"))
  .map((file) => file.replace(".playwright.config.ts", ".spec.ts"));

/** Снимки и вёрстка скина без сервера чата: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c skin-gallery/playwright.config.ts`. Остальное — по одному на каждый `*.playwright.config.ts` (`pnpm --filter @ykurilov/agent-chat-demo skin-gallery:all`). */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  testIgnore: withOwnConfig,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "skin-gallery", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @ykurilov/agent-chat-react build && pnpm --filter @ykurilov/agent-chat-skin-oduvanchik build && pnpm exec vite --config skin-gallery/vite.config.ts",
    url: `http://localhost:${port}`,
    env: { SKIN_GALLERY_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  },
});
