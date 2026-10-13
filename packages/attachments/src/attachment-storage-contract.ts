import { describe, expect, it } from "vitest";
import type { AttachmentStorage, StoredAttachment } from "./attachment-storage";

/**
 * Проверки договора хранилища файлов. Каждая реализация подключает их в своих тестах:
 * `describeAttachmentStorageContract(() => createMyStorage())`.
 */
export function describeAttachmentStorageContract(createStorage: () => AttachmentStorage | Promise<AttachmentStorage>): void {
  function record(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
    return {
      id: crypto.randomUUID(),
      chatId: "chat-1",
      ownerId: "anna",
      name: "заметки.txt",
      mediaType: "text/plain",
      kind: "text",
      size: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      attached: false,
      extractedText: "abc",
      textTruncated: false,
      ...overrides,
    };
  }
  const bytes = () => new Uint8Array([1, 2, 3]);

  describe("договор хранилища файлов", () => {
    it("записанное читается: запись и байты как были", async () => {
      const storage = await createStorage();
      const saved = record();
      await storage.save(saved, bytes());
      expect(await storage.get(saved.id)).toEqual(saved);
      expect([...(await storage.readBytes(saved.id))!]).toEqual([1, 2, 3]);
    });

    it("нет такого файла — undefined", async () => {
      const storage = await createStorage();
      const id = crypto.randomUUID();
      expect(await storage.get(id)).toBeUndefined();
      expect(await storage.readBytes(id)).toBeUndefined();
    });

    it("после записи изменение исходных байтов и записи хранилище не задевает", async () => {
      const storage = await createStorage();
      const saved = record();
      const source = bytes();
      await storage.save(saved, source);
      source[0] = 99;
      saved.name = "испорчено";
      expect([...(await storage.readBytes(saved.id))!]).toEqual([1, 2, 3]);
      expect((await storage.get(saved.id))?.name).toBe("заметки.txt");
    });

    it("markAttached отмечает файл прикреплённым; повторный вызов и неизвестный файл не ошибка", async () => {
      const storage = await createStorage();
      const saved = record();
      await storage.save(saved, bytes());
      await storage.markAttached(saved.id);
      await storage.markAttached(saved.id);
      expect((await storage.get(saved.id))?.attached).toBe(true);
      await storage.markAttached(crypto.randomUUID());
    });

    it("remove убирает запись и байты; повторно и для неизвестного — не ошибка", async () => {
      const storage = await createStorage();
      const saved = record();
      await storage.save(saved, bytes());
      await storage.remove(saved.id);
      expect(await storage.get(saved.id)).toBeUndefined();
      expect(await storage.readBytes(saved.id)).toBeUndefined();
      await storage.remove(saved.id);
      await storage.remove(crypto.randomUUID());
    });

    it("removeAllOfChat убирает все файлы этого чата, и прикреплённые тоже; чужие чаты целы; говорит, сколько убрал", async () => {
      const storage = await createStorage();
      const free = record({ chatId: "chat-1" });
      const attached = record({ chatId: "chat-1" });
      const other = record({ chatId: "chat-2" });
      for (const item of [free, attached, other]) await storage.save(item, bytes());
      await storage.markAttached(attached.id);
      expect(await storage.removeAllOfChat("chat-1")).toBe(2);
      for (const item of [free, attached]) {
        expect(await storage.get(item.id)).toBeUndefined();
        expect(await storage.readBytes(item.id)).toBeUndefined();
      }
      expect(await storage.get(other.id)).toBeDefined();
      expect([...(await storage.readBytes(other.id))!]).toEqual([1, 2, 3]);
      expect(await storage.removeAllOfChat("chat-1")).toBe(0);
      expect(await storage.removeAllOfChat("нет-такого")).toBe(0);
    });

    it("removeUnattachedOlderThan убирает только старые непривязанные и говорит, сколько убрал", async () => {
      const storage = await createStorage();
      const oldFree = record({ createdAt: "2026-01-01T00:00:00.000Z" });
      const oldAttached = record({ createdAt: "2026-01-01T00:00:00.000Z" });
      const freshFree = record({ createdAt: "2026-03-01T00:00:00.000Z" });
      for (const item of [oldFree, oldAttached, freshFree]) await storage.save(item, bytes());
      await storage.markAttached(oldAttached.id);
      expect(await storage.removeUnattachedOlderThan(new Date("2026-02-01T00:00:00.000Z"))).toBe(1);
      expect(await storage.get(oldFree.id)).toBeUndefined();
      expect(await storage.get(oldAttached.id)).toBeDefined();
      expect(await storage.get(freshFree.id)).toBeDefined();
    });

    it("unattachedTotals считает только неотправленные файлы этого человека, по всем его чатам", async () => {
      const storage = await createStorage();
      await storage.save(record({ size: 10 }), bytes());
      await storage.save(record({ size: 5, chatId: "chat-2" }), bytes());
      await storage.save(record({ size: 100, ownerId: "boris" }), bytes());
      const sent = record({ size: 1000 });
      await storage.save(sent, bytes());
      await storage.markAttached(sent.id);
      expect(await storage.unattachedTotals("anna")).toEqual({ files: 2, bytes: 15 });
      expect(await storage.unattachedTotals("boris")).toEqual({ files: 1, bytes: 100 });
      expect(await storage.unattachedTotals("nobody")).toEqual({ files: 0, bytes: 0 });
    });

    it("id не в виде UUID: записать нельзя, прочитать нечего, ошибок обращения к файловой системе нет", async () => {
      const storage = await createStorage();
      for (const id of ["../../etc/passwd", "a/b", "", "..", "x".repeat(300)]) {
        await expect(storage.save(record({ id }), bytes())).rejects.toThrow();
        expect(await storage.get(id)).toBeUndefined();
        expect(await storage.readBytes(id)).toBeUndefined();
        await storage.remove(id);
        await storage.markAttached(id);
      }
    });

    it("картинка без извлечённого текста хранится без этих полей, исходный тип сохраняется", async () => {
      const storage = await createStorage();
      const { extractedText: _text, textTruncated: _truncated, ...image } = record({ kind: "image", mediaType: "image/jpeg", sourceMediaType: "image/png", name: "a.png" });
      await storage.save(image, bytes());
      expect(await storage.get(image.id)).toEqual(image);
    });
  });
}
