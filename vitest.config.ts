import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

function readLocalEnv(): Record<string, string> {
  const path = new URL("./.env.local", import.meta.url);
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

/**
 * Потолок памяти тестов, общий для всех пакетов. 15.10 один тест раздул процесс до 97 ГБ и положил Мак.
 * - куча V8 каждого воркера — не больше 4 ГБ (`--max-old-space-size`);
 * - не больше 6 воркеров сразу: даже при сбое всех вместе тесты не съедят всю память;
 * - память вне кучи (буферы, WASM pglite, sqlite) стережёт `worker-memory-guard`: воркер больше 4 ГБ вместе с потомками
 *   убивается с понятной строкой в выводе (порог — AGENT_CHAT_TEST_WORKER_RSS_MB).
 */
const workerLimits = {
  pool: "forks" as const,
  execArgv: ["--max-old-space-size=4096"],
};
const workerMemoryGuard = "scripts/vitest/worker-memory-guard.global-setup.ts";

export default defineConfig({
  test: {
    maxWorkers: 6,
    projects: [
      {
        // Внутри репозитория пакеты берутся из исходников (без сборки): условие из `exports` каждого пакета.
        resolve: { conditions: ["@ykurilov/agent-chat-source"] },
        ssr: { resolve: { conditions: ["@ykurilov/agent-chat-source"] } },
        test: {
          ...workerLimits,
          name: "unit",
          // Тесты хранилищ (SQLite, pglite) на диске и в WASM: когда машину грузят чужие процессы (агенты, сборки),
          // 5 с по умолчанию им мало — 15.10 полный прогон шёл 845 с вместо 140 и ронял их по сроку. Зависший тест
          // всё равно падает, только позже.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          include: ["packages/*/tests/**/*.test.{ts,tsx}", "skins/*/tests/**/*.test.{ts,tsx}", "scripts/tests/**/*.test.ts", "apps/demo/tests/**/*.test.ts"],
          exclude: ["**/node_modules/**", "packages/*/tests/live/**"],
          // Слепок пустой базы pglite создаётся один раз до тестов, а не внутри первого теста каждого процесса.
          globalSetup: [workerMemoryGuard, "packages/storage-postgres/tests/support/pglite-snapshot.global-setup.ts"],
        },
      },
      {
        resolve: { conditions: ["@ykurilov/agent-chat-source"] },
        ssr: { resolve: { conditions: ["@ykurilov/agent-chat-source"] } },
        test: {
          ...workerLimits,
          name: "live",
          globalSetup: [workerMemoryGuard],
          include: ["packages/*/tests/live/**/*.live.test.ts"],
          testTimeout: 180_000,
          env: readLocalEnv(),
        },
      },
    ],
  },
});
