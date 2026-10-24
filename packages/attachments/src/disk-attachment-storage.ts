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
 * процесс сервера, как и база на SQLite. На том же договоре стоит и атомарность условного удаления относительно
 * отметки: дела с одним файлом идут по очереди внутри процесса. Два процесса на одной папке её не получают.
 */
export function createDiskAttachmentStorage(options: { directory: string }): AttachmentStorage {
  const { directory } = options;
  const binPath = (id: string) => join(directory, `${id}.bin`);
  const jsonPath = (id: string) => join(directory, `${id}.json`);
  let unsentIndex: Promise<Map<string, UnsentEntry>> | undefined;
  const fileQueues = new Map<string, Promise<unknown>>();

  /** Дела с одним файлом — по очереди: чтение записи и запись или удаление после него не перемежаются с чужими. */
  function oneAtATime<T>(id: string, work: () => Promise<T>): Promise<T> {
    const done = (fileQueues.get(id) ?? Promise.resolve()).then(work);
    const settled = done.catch(() => undefined);
    fileQueues.set(id, settled);
    void settled.then(() => {
      if (fileQueues.get(id) === settled) fileQueues.delete(id);
    });
    return done;
  }

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

  /** Убирает файл, если он есть, не прикреплён и подходит под `stale`; проверка и удаление — одним делом файла. */
  function removeIfUnattached(id: string, stale: (record: StoredAttachment) => boolean = () => true): Promise<boolean> {
    return oneAtATime(id, async () => {
      const record = await readRecord(id);
      if (!record || record.attached || !stale(record)) return false;
      await removeFiles(id);
      return true;
    });
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
      await oneAtATime(record.id, async () => {
        await mkdir(directory, { recursive: true });
        await writeAtomically(binPath(record.id), bytes);
        await writeAtomically(jsonPath(record.id), JSON.stringify(record));
        if (!record.attached) (await loadedIndex())?.set(record.id, { ownerId: record.ownerId, size: record.size });
      });
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
      if (!isAttachmentId(id)) return;
      await oneAtATime(id, async () => {
        const record = await readRecord(id);
        if (record && !record.attached) await writeAtomically(jsonPath(id), JSON.stringify({ ...record, attached: true }));
        (await loadedIndex())?.delete(id);
      });
    },
    async remove(id) {
      if (isAttachmentId(id)) await oneAtATime(id, () => removeFiles(id));
    },
    async removeUnattached(id) {
      return isAttachmentId(id) && removeIfUnattached(id);
    },
    async removeAllOfChat(chatId) {
      const mine = (await listRecords()).filter((record) => record.chatId === chatId);
      for (const record of mine) await oneAtATime(record.id, () => removeFiles(record.id));
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
          const stale = (record: StoredAttachment) => Date.parse(record.createdAt) < before.getTime();
          if (await removeIfUnattached(id, stale).catch(() => false)) removed++;
        } else if (name.endsWith(".tmp")) {
          // Недописанный временный файл: свежий может быть загрузкой в пути.
          if (await modifiedBefore(name, before)) await rm(join(directory, name), { force: true });
        } else if (name.endsWith(".bin") && !present.has(`${name.slice(0, -".bin".length)}.json`)) {
          // Байты без записи (сбой между двумя шагами `save`). Запись могла появиться после чтения папки: проверяем в деле файла.
          const id = name.slice(0, -".bin".length);
          await oneAtATime(id, async () => {
            const recordAppeared = (await readRecord(id).catch(() => undefined)) !== undefined;
            if (!recordAppeared && (await modifiedBefore(name, before))) await rm(join(directory, name), { force: true });
          });
        }
      }
      return removed;
    },
  };
}
