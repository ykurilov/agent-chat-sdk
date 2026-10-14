import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { startTemporaryPostgres, type TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { FlowStore } from "../../src/store/flow-store";
import { createPostgresFlowStore } from "../../src/store/postgres";
import { createSqliteFlowStore, type SqliteFlowStore } from "../../src/store/sqlite";
import { HOUR } from "../flow-fixtures";
import { agentTexts, appNotices, clockAt, human, OWNER, stateOfChat, T0, timerChat, type TimerChat } from "./timer-chat";

// T070: таймеры в общей базе — две копии сервера шлют одно сообщение; после перезапуска наступивший срабатывает один раз.

const REMIND = "Вы ещё здесь? Можем продолжить, когда будет удобно.";
/** 13.10.2026 по Москве, ЧЧ:ММ. */
const msk = (hours: number, minutes = 0, day = 13) => Date.UTC(2026, 9, day, hours - 3, minutes);

const cleanups: Array<() => Promise<void> | void> = [];
beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(async () => {
  vi.useRealTimers();
  delete process.env.TZ;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const SQLITE_MIGRATIONS = fileURLToPath(new URL("../../drizzle/sqlite", import.meta.url));
const POSTGRES_MIGRATIONS = fileURLToPath(new URL("../../drizzle/postgres", import.meta.url));

/** Две ручки на одну базу: у каждой копии сервера своя. */
const databases: Array<{ name: string; open: () => Promise<[FlowStore, FlowStore]> }> = [
  {
    name: "SQLite",
    open: async () => {
      const folder = mkdtempSync(join(tmpdir(), "agent-flow-timers-"));
      const file = join(folder, "flows.sqlite");
      const stores: SqliteFlowStore[] = [createSqliteFlowStore(file, SQLITE_MIGRATIONS)];
      await stores[0]!.getChat("nobody");
      stores.push(createSqliteFlowStore(file, SQLITE_MIGRATIONS));
      cleanups.push(async () => {
        for (const store of stores) await store.close();
        rmSync(folder, { recursive: true, force: true });
      });
      return [stores[0]!, stores[1]!];
    },
  },
  {
    name: "PostgreSQL",
    open: async () => {
      const database: TemporaryPostgres = await startTemporaryPostgres();
      const pools = [new pg.Pool({ connectionString: database.connectionString, max: 2 }), new pg.Pool({ connectionString: database.connectionString, max: 2 })];
      cleanups.push(async () => {
        for (const pool of pools) await pool.end();
        await database.stop();
      });
      const first = createPostgresFlowStore(pools[0]!, POSTGRES_MIGRATIONS);
      await first.getChat("nobody");
      return [first, createPostgresFlowStore(pools[1]!, POSTGRES_MIGRATIONS)];
    },
  },
];

async function settledBoth(copies: TimerChat[], chatId: string) {
  for (const copy of copies) {
    await waitTurn(copy.service, chatId);
    await copy.flow.settled();
  }
}

describe.each(databases)("таймеры в $name", ({ open }) => {
  it("две копии сервера тикают одновременно — одно служебное сообщение и один ответ", async () => {
    const [firstStore, secondStore] = await open();
    const storage = createInMemoryChatStorage();
    const copies = [timerChat({ store: firstStore, storage }), timerChat({ store: secondStore, storage })];
    const { id } = await copies[0]!.service.createChat(OWNER);
    await human(copies[0]!, id, "Курс по акварели");

    clockAt(T0 + 3 * HOUR);
    await Promise.all(copies.map((copy) => copy.flow.tick()));
    await settledBoth(copies, id);

    expect(await stateOfChat(copies[1]!.service, id)).toBe("remind");
    expect(await appNotices(copies[0]!.storage, id)).toHaveLength(1);
    expect((await agentTexts(copies[0]!.service, id)).filter((text) => text === REMIND)).toHaveLength(1);
    for (const copy of copies) expect(copy.logError).not.toHaveBeenCalled();
  });

  it("сервер был выключен — после подъёма наступивший таймер срабатывает один раз; промежуточные не догоняются", async () => {
    const [store] = await open();
    const storage = createInMemoryChatStorage();
    const before = timerChat({ store, storage });
    const { id } = await before.service.createChat(OWNER);
    await human(before, id, "Курс по акварели");

    // Подъём на следующий день в 13:00: «Напоминание» просрочено на сутки, «утро 10:00» после него ещё не наступило.
    clockAt(msk(13, 0, 14));
    const after = timerChat({ store, storage });
    await after.flow.tick();
    await settledBoth([after], id);
    await after.flow.tick();
    await settledBoth([after], id);

    expect(await stateOfChat(after.service, id)).toBe("remind");
    expect((await agentTexts(after.service, id)).filter((text) => text === REMIND)).toHaveLength(1);
    expect(await appNotices(after.storage, id)).toHaveLength(1);
    expect((await store.getChat(id))?.dueAt).toBe(new Date(msk(10, 0, 15)).toISOString());
  });
});
