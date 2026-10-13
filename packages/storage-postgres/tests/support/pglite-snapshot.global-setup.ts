import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { TestProject } from "vitest/node";

/**
 * Один раз до всех тестов создаёт пустую базу pglite и кладёт её слепок во временный файл.
 * Создание базы с нуля (initdb в WASM) — около 0,6 с чистого процессора, а под нагрузкой в разы дольше.
 * Внутри теста оно съедало его срок; здесь оно идёт до тестов, а тесты разворачивают базу из слепка (около 0,1 с).
 */
export default async function prepareEmptyDatabaseSnapshot(project: TestProject): Promise<() => Promise<void>> {
  const folder = await mkdtemp(join(tmpdir(), "agent-chat-pglite-"));
  const path = join(folder, "empty.tar");
  const database = await PGlite.create();
  try {
    const snapshot = await database.dumpDataDir("none");
    await writeFile(path, new Uint8Array(await snapshot.arrayBuffer()));
  } finally {
    await database.close();
  }
  project.provide("pgliteEmptySnapshotPath", path);
  return () => rm(folder, { recursive: true, force: true });
}
