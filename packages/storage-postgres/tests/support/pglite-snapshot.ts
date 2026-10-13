import { readFile } from "node:fs/promises";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** Файл со слепком пустой базы pglite; его до тестов пишет `pglite-snapshot.global-setup.ts`. */
    pgliteEmptySnapshotPath: string;
  }
}

let emptySnapshot: Promise<Blob> | undefined;

/** Слепок пустой базы для `PGlite.create({ loadDataDir })`, один на процесс тестов. */
export function emptyDatabaseSnapshot(): Promise<Blob> {
  emptySnapshot ??= (async () => {
    const path = inject("pgliteEmptySnapshotPath");
    if (!path) throw new Error("Слепка пустой базы pglite нет: в vitest.config.ts у проекта не подключён pglite-snapshot.global-setup.ts");
    return new Blob([await readFile(path)]);
  })();
  return emptySnapshot;
}
