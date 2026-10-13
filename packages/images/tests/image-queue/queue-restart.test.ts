import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { postgresImageJobStore } from "../../src/postgres";
import { sqliteImageJobStore } from "../../src/sqlite";
import { fakeKie } from "../support/fake-kie";
import { jobRecord } from "./job-store-contract";
import { costs, flush, order, queueSetup, stopQueues, usageBook } from "./queue-harness";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  await stopQueues();
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function sqliteFile() {
  const folder = mkdtempSync(join(tmpdir(), "image-queue-"));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "app.db");
}

/** `fetch` одной копии сервера поверх общего поддельного KIE: видно, кто опрашивал. */
function copyFetch(kie: ReturnType<typeof fakeKie>) {
  const checks: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/jobs/recordInfo")) checks.push(String(input));
    return kie.fetch(input, init);
  });
  return { fetch, checks };
}

describe("очередь картинок на SQLite: перезапуск и две копии", () => {
  it("перезапуск: новое хранилище на том же файле доопрашивает задачу, расход один, картинка доставлена", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T10:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const file = sqliteFile();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const book = usageBook();
    const firstStore = sqliteImageJobStore(file);
    cleanups.push(() => firstStore.close?.());
    const { queue: first } = queueSetup(kie, { store: firstStore, spending: { storage: book } });
    const placed = await first.order(order);
    expect(placed.status).toBe("generating");
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();
    await first.stop();

    kie.states[1] = { state: "success", credits: 0.8 };
    const secondStore = sqliteImageJobStore(file);
    cleanups.push(() => secondStore.close?.());
    const { queue: second, deliver } = queueSetup(kie, { store: secondStore, spending: { storage: book } });
    await flush();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]![1]).toMatchObject({ key: order.key, data: order.data });
    expect(kie.tasks).toHaveLength(1);
    expect(costs(book.records)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
    expect(await second.list({ group: "app-1" })).toMatchObject([{ status: "ready", result: { path: "img/hero.webp" } }]);
  });

  it("две копии на одном файле: задачу ведёт та, что держит аренду; доставка одна", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T10:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const file = sqliteFile();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const book = usageBook();
    const storeA = sqliteImageJobStore(file);
    const storeB = sqliteImageJobStore(file);
    cleanups.push(() => storeA.close?.(), () => storeB.close?.());
    const a = copyFetch(kie);
    const b = copyFetch(kie);
    // Срок попытки длиннее ожидания: за 120 с вторая копия трижды обходит хранилище, а задача ещё идёт.
    const long = { attemptTimeoutMs: 300_000 };
    const copyA = queueSetup(a, { ...long, store: storeA, spending: { storage: book } });
    const copyB = queueSetup(b, { ...long, store: storeB, spending: { storage: book } });
    await copyA.queue.order(order);

    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(a.checks.length).toBeGreaterThan(0);
    expect(b.checks).toEqual([]);

    kie.states[1] = { state: "success", credits: 0.8 };
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(copyA.deliver).toHaveBeenCalledTimes(1);
    expect(copyB.deliver).not.toHaveBeenCalled();
    expect(book.records).toHaveLength(1);
  });
});

/** Поток с TypeScript: загрузчик tsx — из зависимостей пакета. */
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function sqliteWriter(workerData: { file: string; id: string; increments: number }): Promise<{ done: number; conflicts: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./sqlite-writer.worker.ts", import.meta.url), { execArgv: ["--import", TSX_LOADER], workerData });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => code !== 0 && reject(new Error(`поток записи вышел с кодом ${code}`)));
  });
}

describe("хранилище задач на SQLite: настоящая гонка записей из нескольких потоков", () => {
  it("четыре потока правят одну задачу условной записью: без ошибок «база занята», ни одна правка не потеряна", { timeout: 60_000 }, async () => {
    const file = sqliteFile();
    const store = sqliteImageJobStore(file);
    cleanups.push(() => store.close?.());
    await store.insert(jobRecord({ id: "race" }));
    const increments = 250;
    const results = await Promise.all(Array.from({ length: 4 }, () => sqliteWriter({ file, id: "race", increments })));
    expect(results.map((result) => result.done)).toEqual([increments, increments, increments, increments]);
    expect(await store.get("race")).toMatchObject({ attempt: 1 + 4 * increments, version: 1 + 4 * increments });
  });
});

describe("очередь картинок на SQLite: два заказа на одно место с двух копий", () => {
  it("открыта ровно одна задача, другая вытеснена; картинка доставлена один раз", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T10:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const file = sqliteFile();
    const kie = fakeKie({ states: { 1: { state: "generating" }, 2: { state: "generating" } } });
    const book = usageBook();
    const storeA = sqliteImageJobStore(file);
    const storeB = sqliteImageJobStore(file);
    cleanups.push(() => storeA.close?.(), () => storeB.close?.());
    const copyA = queueSetup(kie, { store: storeA, spending: { storage: book } });
    const copyB = queueSetup(kie, { store: storeB, spending: { storage: book } });

    await Promise.all([copyA.queue.order(order), copyB.queue.order({ ...order, prompt: "Зелёное яблоко" })]);
    const jobs = await storeA.list({ ownerId: order.ownerId, key: order.key });
    expect(jobs.filter((job) => job.status === "generating")).toHaveLength(1);
    expect(jobs.filter((job) => job.status === "superseded")).toHaveLength(jobs.length - 1);

    kie.states[1] = { state: "success", credits: 0.8 };
    kie.states[2] = { state: "success", credits: 0.8 };
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(copyA.deliver.mock.calls.length + copyB.deliver.mock.calls.length).toBe(1);
  });
});

describe("очередь картинок на PostgreSQL (pglite): перезапуск", () => {
  it("новое хранилище на той же базе доопрашивает задачу, расход один, картинка доставлена", async () => {
    const database = await startTemporaryPostgres();
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
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const book = usageBook();
    const fast = { pollIntervalMs: 50, attemptTimeoutMs: 10_000, leaseMs: 2_000 };
    const { queue: first } = queueSetup(kie, { ...fast, store: open(), spending: { storage: book } });
    const placed = await first.order(order);
    expect(placed.status).toBe("generating");
    await vi.waitFor(() => expect(kie.checks.length).toBeGreaterThan(0));
    await first.stop();

    kie.states[1] = { state: "success", credits: 0.8 };
    const { deliver } = queueSetup(kie, { ...fast, store: open(), spending: { storage: book } });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(kie.tasks).toHaveLength(1);
    expect(costs(book.records)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
  });
});
