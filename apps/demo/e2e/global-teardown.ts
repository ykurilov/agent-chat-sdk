import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDatabaseFiles } from "./support/own-server";

/**
 * База прогона наполняется длинными чатами и весит сотни мегабайт, а сборка демо лежит во временной папке:
 * после прогона они удаляются, вместе с базами собственных серверов тестов, если тест упал и не убрал их сам.
 */
export default function removeRunFiles() {
  const databaseFile = process.env.DEMO_E2E_DB_FILE;
  if (databaseFile) removeDatabaseFiles(databaseFile);
  const distDir = process.env.DEMO_E2E_DIST;
  if (distDir) rmSync(distDir, { recursive: true, force: true });
  const runId = process.env.DEMO_E2E_RUN_ID;
  for (const name of readdirSync(tmpdir())) {
    if (runId && name.startsWith(`agent-chat-e2e-own-${runId}-`)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
}
