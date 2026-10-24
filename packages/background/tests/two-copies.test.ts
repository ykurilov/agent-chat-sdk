import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHelper, BackgroundTasks, DeliverNoticesInput, RunHelperInput, RunHelperResult } from "@ykurilov/agent-chat-core";
import { jsonSchema } from "ai";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTemporaryPostgres } from "../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../storage-postgres/tests/support/pglite-server";
import { assertSafeToWipe } from "../../storage-postgres/tests/support/wipe-guard";
import { backgroundTool, createBackgroundTasks, memoryTaskStore } from "../src/index";
import { postgresTaskStore } from "../src/postgres";
import { sqliteTaskStore } from "../src/sqlite";
import type { TaskStore } from "../src/types";
import { callTool, createFakePort, toolsModel } from "./support/fake-port";
import type { FakePort } from "./support/fake-port";
import { pausedRecord, taskRecord } from "./store/task-store-contract";

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

/** Фоновый помощник, который работает, пока задачу не остановят. */
const researcher: AgentHelper = { description: "Ищет сведения", instructions: "Ищи", model: { providerId: "fake", modelId: "fake-model" }, background: true };
const endlessHelper = (input: RunHelperInput) =>
  new Promise<RunHelperResult>((_, reject) => input.abortSignal.addEventListener("abort", () => reject(input.abortSignal.reason), { once: true }));

function openCopy(store: TaskStore, work: ReturnType<typeof createWork>, delivered: DeliverNoticesInput[], maxRunningPerUser = TASKS): Copy {
  const service = createBackgroundTasks({ store, tools: { build_report: work.definition }, maxRunningPerUser, leaseMs: LEASE_MS });
  const port = createFakePort({ delivered, helpers: { researcher }, runHelper: endlessHelper });
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

/** Точка встречи: каждый пришедший ждёт, пока соберутся `size`, но не дольше 300 мс (дальше идёт один). */
function meetingPoint(size: number): () => Promise<void> {
  let waiting: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= size) {
        for (const go of waiting.splice(0)) go();
        return;
      }
      setTimeout(() => {
        waiting = waiting.filter((go) => go !== resolve);
        resolve();
      }, 300);
    });
}

/** Хранилище, у которого подсчёт мест и резервирование места сначала проходят точку встречи двух копий. */
function atMeetingPoint(store: TaskStore, meet: () => Promise<void>): TaskStore {
  return {
    ...store,
    countActive: async (ownerId) => (await meet(), store.countActive(ownerId)),
    admitWithinLimit: async (admission, maxActive) => (await meet(), store.admitWithinLimit(admission, maxActive)),
  };
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

    it("предел задач человека общий для копий: одновременные запуски из двух чатов на двух копиях его не превышают", async () => {
      const work = createWork();
      work.hold();
      const stores = await openStores();
      cleanups.push(stores.close);
      const delivered: DeliverNoticesInput[] = [];
      // Обе копии сначала доходят до хранилища и только потом идут дальше: так выглядит худшее совпадение по времени.
      const meet = meetingPoint(2);
      const copies = [openCopy(atMeetingPoint(stores.first, meet), work, delivered, 1), openCopy(atMeetingPoint(stores.second, meet), work, delivered, 1)];
      cleanups.push(async () => {
        for (const { service } of copies) await service.flush();
      });
      const starts = await Promise.all(
        [0, 1, 2, 3].map((n) => callTool(copies[n % 2]!.service.tools(toolsModel({ ownerId: "anna", chatId: `chat-${n % 2}` })), "build_report", { n })),
      );
      expect(starts.filter((answer) => answer.status === "started")).toHaveLength(1);
      expect(starts.filter((answer) => answer.status === "too_many_tasks")).toHaveLength(3);
      expect(await stores.first.countActive("anna")).toBe(1);
      // Чужой человек своё место получает.
      expect((await callTool(copies[1]!.service.tools(toolsModel({ ownerId: "boris", chatId: "chat-b" })), "build_report", { n: 9 })).status).toBe("started");

      // Задачи закончились — места освободились на обеих копиях.
      work.release();
      await vi.waitFor(async () => expect(await stores.first.countActive("anna")).toBe(0), { timeout: 10_000, interval: 50 });
      expect((await callTool(copies[1]!.service.tools(toolsModel({ ownerId: "anna", chatId: "chat-1" })), "build_report", { n: 10 })).status).toBe("started");
    });

    it("ответ на паузе на одной копии и новый запуск на другой одновременно: последнее место достаётся одному", async () => {
      const work = createWork();
      work.hold();
      const stores = await openStores();
      cleanups.push(stores.close);
      const paused = pausedRecord({ ownerId: "anna", chatId: "chat-paused" });
      await stores.first.create(paused);
      const meet = meetingPoint(2);
      const delivered: DeliverNoticesInput[] = [];
      const copies = [openCopy(atMeetingPoint(stores.first, meet), work, delivered, 1), openCopy(atMeetingPoint(stores.second, meet), work, delivered, 1)];
      cleanups.push(async () => {
        work.release();
        for (const { service } of copies) await service.flush();
      });
      const [started, answer] = await Promise.all([
        callTool(copies[0]!.service.tools(toolsModel({ ownerId: "anna", chatId: "chat-0" })), "build_report", { n: 1 }),
        copies[1]!.service.answerApproval("anna", "chat-paused", paused.id, "approval-1", "allow").catch((error: unknown) => error),
      ]);
      expect([started.status === "started", answer === "resumed"].filter(Boolean)).toHaveLength(1);
      expect(await stores.first.countActive("anna")).toBe(1);
      if (answer !== "resumed") {
        expect(answer).toMatchObject({ name: "TurnRefusedError", code: "too_many_tasks" });
        expect(await stores.first.get("anna", paused.id)).toMatchObject({ status: "awaiting_approval", progress: { pendingApproval: { approvalId: "approval-1" } } });
      }
    });
  });
}

describeTwoCopies("память", async () => {
  const store = memoryTaskStore();
  return { first: store, second: store, close: async () => {} };
});

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
  // Вторая ручка тоже уже прошла миграцию: иначе её первый запрос опоздает, и одновременного запуска не выйдет.
  const second = postgresTaskStore(pools[1]!);
  await second.countActive("nobody");
  return {
    first,
    second,
    async close() {
      for (const pool of pools) await pool.end();
      await database.stop();
    },
  };
});

/**
 * База рядом с данной, со своим именем. Тесты хранилища (store/postgres-task-store.test.ts) идут параллельно в другом
 * процессе и стирают схему `agent_chat` в данной базе: в общей базе они стёрли бы задачи посреди этих тестов.
 */
async function siblingDatabase(connectionString: string, suffix: string): Promise<string> {
  const url = new URL(connectionString);
  const name = `${decodeURIComponent(url.pathname.replace(/^\//, ""))}_${suffix}`;
  url.pathname = `/${encodeURIComponent(name)}`;
  const admin = new pg.Client({ connectionString });
  await admin.connect();
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await admin.query(`create database "${name.replaceAll('"', '""')}"`);
  } finally {
    await admin.end();
  }
  return url.toString();
}

/** Настоящий PostgreSQL (`AGENT_CHAT_TEST_POSTGRES_URL`, см. store/postgres-task-store.test.ts): у pglite подключения склеены в одно. */
const realPostgresUrl = process.env.AGENT_CHAT_TEST_POSTGRES_URL;
if (realPostgresUrl) {
  assertSafeToWipe(realPostgresUrl);
  let database: Promise<string> | undefined;
  describeTwoCopies("настоящий PostgreSQL", async () => {
    const url = await (database ??= siblingDatabase(realPostgresUrl, "two_copies"));
    const reset = new pg.Client({ connectionString: url });
    await reset.connect();
    await reset.query("drop schema if exists agent_chat cascade");
    await reset.end();
    const pools = [new pg.Pool({ connectionString: url, max: 4 }), new pg.Pool({ connectionString: url, max: 4 })];
    const first = postgresTaskStore(pools[0]!);
    await first.countActive("nobody");
    const second = postgresTaskStore(pools[1]!);
    await second.countActive("nobody");
    return {
      first,
      second,
      async close() {
        for (const pool of pools) await pool.end();
      },
    };
  });
}
