import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDiskAttachmentStorage } from "../src/disk-attachment-storage";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import { describeAttachmentStorageContract } from "../src/attachment-storage-contract";

describe("хранилище в памяти", () => {
  describeAttachmentStorageContract(() => createMemoryAttachmentStorage());
});

describe("хранилище на диске", () => {
  const folders: string[] = [];
  afterAll(async () => {
    await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
  });
  const create = async () => {
    const folder = await mkdtemp(join(tmpdir(), "attachments-"));
    folders.push(folder);
    return createDiskAttachmentStorage({ directory: join(folder, "вложенная", "папка") });
  };
  describeAttachmentStorageContract(create);

  it("на диске только файлы <id>.bin и <id>.json: имя из записи в путь не попадает", async () => {
    const folder = await mkdtemp(join(tmpdir(), "attachments-"));
    folders.push(folder);
    const storage = createDiskAttachmentStorage({ directory: folder });
    const id = crypto.randomUUID();
    await storage.save(
      { id, chatId: "c", ownerId: "u", name: "../../etc/passwd", mediaType: "text/plain", kind: "text", size: 1, createdAt: new Date().toISOString(), attached: false },
      new Uint8Array([65]),
    );
    expect((await readdir(folder)).sort()).toEqual([`${id}.bin`, `${id}.json`]);
  });

  it("после перезапуска (новый объект на той же папке) записи на месте", async () => {
    const folder = await mkdtemp(join(tmpdir(), "attachments-"));
    folders.push(folder);
    const id = crypto.randomUUID();
    const record = { id, chatId: "c", ownerId: "u", name: "a.txt", mediaType: "text/plain", kind: "text" as const, size: 1, createdAt: new Date().toISOString(), attached: false };
    await createDiskAttachmentStorage({ directory: folder }).save(record, new Uint8Array([65]));
    const again = createDiskAttachmentStorage({ directory: folder });
    expect(await again.get(id)).toEqual(record);
    expect([...(await again.readBytes(id))!]).toEqual([65]);
  });

  it("чистка убирает «сирот»: байты без записи и недописанные временные файлы старше порога; свежие и целые не трогает", async () => {
    const folder = await mkdtemp(join(tmpdir(), "attachments-"));
    folders.push(folder);
    const storage = createDiskAttachmentStorage({ directory: folder });
    const whole = crypto.randomUUID();
    await storage.save(
      { id: whole, chatId: "c", ownerId: "u", name: "a.txt", mediaType: "text/plain", kind: "text", size: 1, createdAt: new Date().toISOString(), attached: false },
      new Uint8Array([65]),
    );
    const oldOrphan = `${crypto.randomUUID()}.bin`;
    const oldTemporary = `${crypto.randomUUID()}.json.${crypto.randomUUID()}.tmp`;
    const freshOrphan = `${crypto.randomUUID()}.bin`;
    const freshTemporary = `${crypto.randomUUID()}.bin.${crypto.randomUUID()}.tmp`;
    const foreign = "readme.txt";
    for (const name of [oldOrphan, oldTemporary, freshOrphan, freshTemporary, foreign]) await writeFile(join(folder, name), "x");
    const longAgo = new Date(Date.now() - 48 * 60 * 60_000);
    for (const name of [oldOrphan, oldTemporary, foreign]) await utimes(join(folder, name), longAgo, longAgo);

    await storage.removeUnattachedOlderThan(new Date(Date.now() - 24 * 60 * 60_000));
    expect((await readdir(folder)).sort()).toEqual([`${whole}.bin`, `${whole}.json`, freshOrphan, freshTemporary, foreign].sort());
  });

  it("байты записаны, а запись нет (сбой между двумя шагами): через сутки сирота уходит, до этого не мешает", async () => {
    const folder = await mkdtemp(join(tmpdir(), "attachments-"));
    folders.push(folder);
    const storage = createDiskAttachmentStorage({ directory: folder });
    const id = crypto.randomUUID();
    await writeFile(join(folder, `${id}.bin`), "x");
    expect(await storage.get(id)).toBeUndefined();
    await storage.removeUnattachedOlderThan(new Date(Date.now() - 24 * 60 * 60_000));
    expect(await readdir(folder)).toEqual([`${id}.bin`]);
    await storage.removeUnattachedOlderThan(new Date(Date.now() + 60_000));
    expect(await readdir(folder)).toEqual([]);
  });
});
