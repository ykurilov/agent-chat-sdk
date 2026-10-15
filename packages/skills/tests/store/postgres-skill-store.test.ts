import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { postgresSkillStore } from "../../src/postgres";
import { at, describeSkillStoreContract, newSkill } from "./skill-store-contract";

const databases: TemporaryPostgres[] = [];
async function freshDatabase(): Promise<TemporaryPostgres> {
  const database = await startTemporaryPostgres();
  databases.push(database);
  return database;
}
afterEach(async () => {
  for (const database of databases.splice(0)) await database.stop();
});

describe("навыки в PostgreSQL (встроенная база pglite за обычным протоколом)", () => {
  describeSkillStoreContract(async () => {
    const database = await freshDatabase();
    const firstPool = new pg.Pool({ connectionString: database.connectionString, max: 2 });
    const secondPool = new pg.Pool({ connectionString: database.connectionString, max: 2 });
    // В pglite блокировка миграций общая и ничего не исключает: вторая ручка открывается после миграции первой.
    const first = postgresSkillStore(firstPool);
    await first.list();
    return {
      first,
      second: postgresSkillStore(secondPool),
      close: async () => {
        await firstPool.end();
        await secondPool.end();
      },
    };
  });

  it("таблицы в схеме agent_chat и свой журнал миграций; пул приложения не закрывается; NUL в тексте не ломает запись", async () => {
    const database = await freshDatabase();
    const pool = new pg.Pool({ connectionString: database.connectionString, max: 2 });
    try {
      await postgresSkillStore(pool).create(newSkill(), at(1));
      expect((await postgresSkillStore(pool).get("game-dev"))?.version).toBe(1);
      const { rows } = await pool.query("select table_name from information_schema.tables where table_schema = 'agent_chat' order by table_name");
      expect(rows.map((row) => row.table_name)).toEqual(expect.arrayContaining(["__skills_migrations", "skills", "skill_versions", "skill_loads"]));
      const withNul = await postgresSkillStore(pool).create(newSkill({ name: "nul", body: "a\u0000b" }), at(2));
      expect(withNul.body).toBe("ab");
    } finally {
      await pool.end();
    }
  });
});
