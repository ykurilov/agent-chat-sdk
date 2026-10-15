import pg from "pg";
import { afterEach, describe } from "vitest";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { createPostgresMcpStore } from "../../src/postgres";
import { describeMcpStoreContract } from "./mcp-store-contract";

const databases: TemporaryPostgres[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.stop();
});

describe("MCP в PostgreSQL (встроенная база pglite за обычным протоколом)", () => {
  describeMcpStoreContract(async () => {
    const database = await startTemporaryPostgres();
    databases.push(database);
    const pools = [new pg.Pool({ connectionString: database.connectionString, max: 2 })];
    return {
      store: createPostgresMcpStore({ pool: pools[0]! }),
      reopen: async () => {
        const pool = new pg.Pool({ connectionString: database.connectionString, max: 2 });
        pools.push(pool);
        return createPostgresMcpStore({ pool });
      },
      close: async () => {
        for (const pool of pools) await pool.end();
      },
    };
  });
});
