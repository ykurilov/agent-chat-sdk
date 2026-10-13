import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackgroundTasks, DeliverNoticesInput } from "@ykurilov/agent-chat-core";
import { jsonSchema } from "ai";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTemporaryPostgres } from "../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../storage-postgres/tests/support/pglite-server";
import { backgroundTool, createBackgroundTasks } from "../src/index";
import { postgresTaskStore } from "../src/postgres";
import { sqliteTaskStore } from "../src/sqlite";
import type { TaskStore } from "../src/types";
import { callTool, createFakePort, toolsModel } from "./support/fake-port";
import type { FakePort } from "./support/fake-port";
import { taskRecord } from "./store/task-store-contract";

/** SC-007: две копии сервера на одной базе, 20 задач — каждая выполнена и доставлена ровно один раз. Настоящие часы. */
const TASKS = 20;
const LEASE_MS = 3_000;

interface Copy {
  service: BackgroundTasks;
  port: FakePort;
}

/** Общий счёт на обе копии: какие задачи дошли до конца работы. */
function createWork() {
  const completed: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = false;
  const definition = backgroundTool({
    description: "Считает отчёт",
    inputSchema: jsonSchema<{ n: number }>({ type: "object", properties: { n: { type: "number" } }, required: ["n"] }),
    title: (input) => `Отчёт ${input.n}`,
    rerunAfterRestart: true,
    async run(input, { signal }) {
      const aborted = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      const pause = holding ? gate : new Promise<void>((resolve) => setTimeout(resolve, 5 + (input.n % 7) * 3));
      await Promise.race([pause, aborted]);
      completed.push(String(input.n));
      return { n: input.n };
    },
  });
  return {
    definition,
    completed,
    hold() {
      holding = true;
    },
    release,
  };
}

function openCopy(store: TaskStore, work: ReturnType<typeof createWork>, delivered: DeliverNoticesInput[]): Copy {
  const service = createBackgroundTasks({ store, tools: { build_report: work.definition }, maxRunningPerUser: TASKS, leaseMs: LEASE_MS });
  const port = createFakePort({ delivered });
  service.attach(port);
  return { service, port };
}

/** Доставки по задачам с обеих копий: попытки, а не то, что ядро пропустило бы как повтор. */
function deliveriesByTask(copies: Copy[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { port } of copies) {
    for (const attempt of port.attempts) {
      for (const notice of attempt.notices) counts.set(notice.taskId!, (counts.get(notice.taskId!) ?? 0) + 1);
    }
  }
  return counts;
}

/** `ids[n]` — задача человека `owner-${n}`. */
async function expectEachOnce(store: TaskStore, copies: Copy[], work: ReturnType<typeof createWork>, ids: string[]): Promise<void> {
  await vi.waitFor(
    async () => {
      for (const [n, id] of ids.entries()) expect((await store.get(`owner-${n}`, id))?.deliveredAt).toBeTruthy();
    },
    { timeout: 10_000, interval: 50 },
  );
  for (const [n, id] of ids.entries()) expect((await store.get(`owner-${n}`, id))?.status).toBe("done");
  expect([...work.completed].sort()).toEqual([...Array(TASKS).keys()].map(String).sort());
  const deliveries = deliveriesByTask(copies);
  expect(ids.map((id) => deliveries.get(id))).toEqual(ids.map(() => 1));
  for (const { port } of copies) expect(port.errors).toEqual([]);
}

function describeTwoCopies(name: string, openStores: () => Promise<{ first: TaskStore; second: TaskStore; close(): Promise<void> }>) {
  describe(`две копии на одной базе: ${name} (T059)`, { timeout: 20_000 }, () => {
    const cleanups: Array<() => Promise<void>> = [];
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    });

    async function twoCopies(work: ReturnType<typeof createWork>) {
      const stores = await openStores();
      const delivered: DeliverNoticesInput[] = [];
      const copies = [openCopy(stores.first, work, delivered), openCopy(stores.second, work, delivered)];
      cleanups.push(stores.close);
      cleanups.push(async () => {
        for (const { service } of copies) await service.flush();
      });
      return { stores, copies };
    }

    it("брошенные задачи делят обе копии сразу: каждая выполнена и доставлена один раз", async () => {
      const work = createWork();
      const { stores, copies } = await twoCopies(work);
      const ids: string[] = [];
      for (let n = 0; n < TASKS; n += 1) {
        const record = taskRecord({
          ownerId: `owner-${n}`,
          chatId: `chat-${n}`,
          input: { n },
          title: `Отчёт ${n}`,
          status: n % 2 === 0 ? "queued" : "running",
          attempt: n % 2,
          leaseOwner: "dead-copy",
          leaseUntil: new Date(Date.now() - 1_000).toISOString(),
        });
        ids.push(record.id);
        await stores.first.create(record);
      }
      await Promise.all(copies.map(({ service }) => service.recover()));
      await expectEachOnce(stores.first, copies, work, ids);
    });

    it("копия остановилась посреди работы — другая доделывает её задачи, итог и доставка по одному разу", async () => {
      const work = createWork();
      work.hold();
      const { stores, copies } = await twoCopies(work);
      await Promise.all(copies.map(({ service }) => service.recover()));
      const ids: string[] = [];
      for (let n = 0; n < TASKS; n += 1) {
        const { service } = copies[n % 2]!;
        const tools = service.tools(toolsModel({ ownerId: `owner-${n}`, chatId: `chat-${n}` }));
        const answer = await callTool(tools, "build_report", { n });
        expect(answer.status).toBe("started");
        ids.push(answer.taskId);
      }
      await copies[0]!.service.flush();
      work.release();
      await expectEachOnce(stores.second, copies, work, ids);
      // Все итоги, в том числе задач первой копии, доставила вторая.
      expect(copies[0]!.port.attempts).toEqual([]);
      expect(copies[1]!.port.attempts).toHaveLength(TASKS);
    });
  });
}

describeTwoCopies("SQLite", async () => {
  const folder = mkdtempSync(join(tmpdir(), "background-two-copies-"));
  const filePath = join(folder, "tasks.sqlite");
  const first = sqliteTaskStore(filePath);
  const second = sqliteTaskStore(filePath);
  return {
    first,
    second,
    async close() {
      await first.close?.();
      await second.close?.();
      rmSync(folder, { recursive: true, force: true });
    },
  };
});

describeTwoCopies("PostgreSQL", async () => {
  const database: TemporaryPostgres = await startTemporaryPostgres();
  const pools = [new pg.Pool({ connectionString: database.connectionString, max: 2 }), new pg.Pool({ connectionString: database.connectionString, max: 2 })];
  const first = postgresTaskStore(pools[0]!);
  await first.countActive("nobody");
  return {
    first,
    second: postgresTaskStore(pools[1]!),
    async close() {
      for (const pool of pools) await pool.end();
      await database.stop();
    },
  };
});
