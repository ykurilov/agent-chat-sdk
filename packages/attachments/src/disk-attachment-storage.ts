import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertAttachmentId, isAttachmentId } from "./attachment-storage";
import type { AttachmentStorage, StoredAttachment } from "./attachment-storage";

interface UnsentEntry {
  ownerId: string;
  size: number;
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Хранилище на диске: в папке лежат `<id>.bin` (байты) и `<id>.json` (запись). Имя файла из записи в путь
 * не входит, `id` проверяется как UUID до обращения к файловой системе. Запись идёт через временный файл и
 * переименование, поэтому оборванная загрузка записи не оставляет: запись появляется последней. Байты без записи
 * и временные файлы, оставшиеся после сбоя, убирает та же чистка, что и брошенные загрузки.
 *
 * Список неотправленных файлов держится в памяти (читается с диска один раз): хранилище рассчитано на один
 * процесс сервера, как и база на SQLite.
 */
export function createDiskAttachmentStorage(options: { directory: string }): AttachmentStorage {
  const { directory } = options;
  const binPath = (id: string) => join(directory, `${id}.bin`);
  const jsonPath = (id: string) => join(directory, `${id}.json`);
  let unsentIndex: Promise<Map<string, UnsentEntry>> | undefined;

  async function writeAtomically(path: string, data: Uint8Array | string): Promise<void> {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }

  async function readRecord(id: string): Promise<StoredAttachment | undefined> {
    if (!isAttachmentId(id)) return undefined;
    try {
      return JSON.parse(await readFile(jsonPath(id), "utf8")) as StoredAttachment;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async function listNames(): Promise<string[]> {
    try {
      return await readdir(directory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async function loadUnsent(): Promise<Map<string, UnsentEntry>> {
    const unsent = new Map<string, UnsentEntry>();
    for (const name of await listNames()) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      const record = await readRecord(id).catch(() => undefined);
      if (record && !record.attached) unsent.set(id, { ownerId: record.ownerId, size: record.size });
    }
    return unsent;
  }

  /** Читается с диска один раз; сбой чтения не запоминается. */
  function unsent(): Promise<Map<string, UnsentEntry>> {
    unsentIndex ??= loadUnsent().catch((error: unknown) => {
      unsentIndex = undefined;
      throw error;
    });
    return unsentIndex;
  }

  /** Список, если он уже читался; иначе `undefined`: тогда при первом чтении он и так увидит актуальный диск. */
  const loadedIndex = () => unsentIndex?.catch(() => undefined);

  async function removeFiles(id: string): Promise<void> {
    await Promise.all([rm(jsonPath(id), { force: true }), rm(binPath(id), { force: true })]);
    (await loadedIndex())?.delete(id);
  }

  async function modifiedBefore(name: string, before: Date): Promise<boolean> {
    try {
      return (await stat(join(directory, name))).mtimeMs < before.getTime();
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  /** Записи (`<id>.json`) папки: id и запись; нечитаемые пропускаются. */
  async function listRecords(): Promise<StoredAttachment[]> {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: StoredAttachment[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const record = await readRecord(name.slice(0, -".json".length)).catch(() => undefined);
      if (record) records.push(record);
    }
    return records;
  }

  return {
    async save(record, bytes) {
      assertAttachmentId(record.id);
      await mkdir(directory, { recursive: true });
      await writeAtomically(binPath(record.id), bytes);
      await writeAtomically(jsonPath(record.id), JSON.stringify(record));
      if (!record.attached) (await loadedIndex())?.set(record.id, { ownerId: record.ownerId, size: record.size });
    },
    get: readRecord,
    async readBytes(id) {
      if (!isAttachmentId(id)) return undefined;
      try {
        return new Uint8Array(await readFile(binPath(id)));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async markAttached(id) {
      const record = await readRecord(id);
      if (record && !record.attached) await writeAtomically(jsonPath(id), JSON.stringify({ ...record, attached: true }));
      (await loadedIndex())?.delete(id);
    },
    async remove(id) {
      if (isAttachmentId(id)) await removeFiles(id);
    },
    async removeAllOfChat(chatId) {
      const mine = (await listRecords()).filter((record) => record.chatId === chatId);
      for (const record of mine) await removeFiles(record.id);
      return mine.length;
    },
    async unattachedTotals(ownerId) {
      let files = 0;
      let bytes = 0;
      for (const entry of (await unsent()).values()) {
        if (entry.ownerId === ownerId) {
          files++;
          bytes += entry.size;
        }
      }
      return { files, bytes };
    },
    async removeUnattachedOlderThan(before) {
      const names = await listNames();
      const present = new Set(names);
      let removed = 0;
      for (const name of names) {
        if (name.endsWith(".json")) {
          const id = name.slice(0, -".json".length);
          const record = await readRecord(id).catch(() => undefined);
          if (record && !record.attached && Date.parse(record.createdAt) < before.getTime()) {
            await removeFiles(id);
            removed++;
          }
        } else if (name.endsWith(".tmp") || (name.endsWith(".bin") && !present.has(`${name.slice(0, -".bin".length)}.json`))) {
          // Недописанный временный файл или байты без записи (сбой между двумя шагами `save`): свежие могут быть загрузкой в пути.
          if (await modifiedBefore(name, before)) await rm(join(directory, name), { force: true });
        }
      }
      return removed;
    },
  };
}
