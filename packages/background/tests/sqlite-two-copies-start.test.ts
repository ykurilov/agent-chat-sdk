import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteTaskStore } from "../src/store/sqlite";

/** Поток с TypeScript: загрузчик tsx — из зависимостей репозитория. */
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const STORE_MODULE = new URL("../src/store/sqlite.ts", import.meta.url).href;
const MIGRATIONS = fileURLToPath(new URL("../drizzle/sqlite", import.meta.url));
const COPIES = 4;

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** Миграции пакета и ещё одна, новая и долгая: пока первая копия её применяет, остальные уже открывают файл. */
function withNewSlowMigration(folder: string): string {
  const migrations = join(folder, "migrations");
  cpSync(MIGRATIONS, migrations, { recursive: true });
  const journalPath = join(migrations, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number; when: number; tag: string }> };
  const last = journal.entries.at(-1)!;
  const tag = "9999_copies_check";
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(migrations, `${tag}.sql`), "CREATE TABLE `copies_check` AS WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n LIMIT 1000000) SELECT x FROM n;");
  return migrations;
}

/** Копии открывают хранилище в один момент; ответ каждой — открылось или ошибка. */
async function openAtOnce(filePath: string, migrations: string): Promise<Array<{ ok: boolean; error?: string }>> {
  const start = new SharedArrayBuffer(4);
  const workers = Array.from({ length: COPIES }, () => new Worker(new URL("./support/open-sqlite-store.worker.ts", import.meta.url), {
    execArgv: ["--conditions=@ykurilov/agent-chat-source", "--import", TSX_LOADER],
    workerData: { modulePath: STORE_MODULE, exportName: "createSqliteTaskStore", args: [filePath, migrations], start },
  }));
  const ready = workers.map((worker) => new Promise<void>((resolve) => worker.once("message", () => resolve())));
  const results = workers.map((worker) => new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
    worker.on("message", (message) => message !== "ready" && resolve(message as { ok: boolean; error?: string }));
    worker.once("error", reject);
  }));
  await Promise.all(ready);
  Atomics.store(new Int32Array(start), 0, 1);
  Atomics.notify(new Int32Array(start), 0);
  try {
    return await Promise.all(results);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

describe("Задачи фона в SQLite: копии сервера на одном файле", () => {
  it("вышла новая миграция, копии стартуют разом: каждая открылась без ошибки", async () => {
    const folder = mkdtempSync(join(tmpdir(), "sqlite-copies-"));
    folders.push(folder);
    const filePath = join(folder, "chat.sqlite");
    await ((createSqliteTaskStore(filePath, MIGRATIONS) as { close?: () => unknown }).close?.());
    expect(await openAtOnce(filePath, withNewSlowMigration(folder))).toEqual(Array.from({ length: COPIES }, () => ({ ok: true })));
  }, 60_000);
});
