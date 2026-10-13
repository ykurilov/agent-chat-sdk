import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterEach } from "vitest";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { memoryImageJobStore } from "../../src/index";
import { postgresImageJobStore } from "../../src/postgres";
import { sqliteImageJobStore } from "../../src/sqlite";
import { describeImageJobStoreContract } from "./job-store-contract";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describeImageJobStoreContract("память", async () => {
  const store = memoryImageJobStore();
  return { store, reopen: async () => store };
});

describeImageJobStoreContract("SQLite", async () => {
  const folder = mkdtempSync(join(tmpdir(), "image-jobs-"));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "app.db");
  return { store: sqliteImageJobStore(file), reopen: async () => sqliteImageJobStore(file) };
});

describeImageJobStoreContract("PostgreSQL (pglite)", async () => {
  const database: TemporaryPostgres = await startTemporaryPostgres();
  cleanups.push(() => database.stop());
  const pools: pg.Pool[] = [];
  cleanups.push(async () => {
    for (const pool of pools) await pool.end();
  });
  const open = () => {
    const pool = new pg.Pool({ connectionString: database.connectionString, max: 2 });
    pools.push(pool);
    return postgresImageJobStore(pool);
  };
  return { store: open(), reopen: async () => open() };
});
