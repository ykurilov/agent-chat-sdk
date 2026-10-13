import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

function readLocalEnv(): Record<string, string> {
  const path = new URL("./.env.local", import.meta.url);
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

export default defineConfig({
  test: {
    projects: [
      {
        // Внутри репозитория пакеты берутся из исходников (без сборки): условие из `exports` каждого пакета.
        resolve: { conditions: ["@ykurilov/agent-chat-source"] },
        ssr: { resolve: { conditions: ["@ykurilov/agent-chat-source"] } },
        test: {
          name: "unit",
          include: ["packages/*/tests/**/*.test.{ts,tsx}", "skins/*/tests/**/*.test.{ts,tsx}", "scripts/tests/**/*.test.ts", "apps/demo/tests/**/*.test.ts"],
          exclude: ["**/node_modules/**", "packages/*/tests/live/**"],
          // Слепок пустой базы pglite создаётся один раз до тестов, а не внутри первого теста каждого процесса.
          globalSetup: ["packages/storage-postgres/tests/support/pglite-snapshot.global-setup.ts"],
        },
      },
      {
        resolve: { conditions: ["@ykurilov/agent-chat-source"] },
        ssr: { resolve: { conditions: ["@ykurilov/agent-chat-source"] } },
        test: {
          name: "live",
          include: ["packages/*/tests/live/**/*.live.test.ts"],
          testTimeout: 180_000,
          env: readLocalEnv(),
        },
      },
    ],
  },
});
