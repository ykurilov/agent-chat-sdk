import { assertAttachmentId, isAttachmentId } from "./attachment-storage";
import type { AttachmentStorage, StoredAttachment } from "./attachment-storage";

/** Хранилище в памяти: для тестов и демонстраций. После перезапуска сервера пусто. */
export function createMemoryAttachmentStorage(): AttachmentStorage {
  const records = new Map<string, { record: StoredAttachment; bytes: Uint8Array }>();
  return {
    async save(record, bytes) {
      assertAttachmentId(record.id);
      records.set(record.id, { record: { ...record }, bytes: bytes.slice() });
    },
    async get(id) {
      const entry = isAttachmentId(id) ? records.get(id) : undefined;
      return entry && { ...entry.record };
    },
    async readBytes(id) {
      return isAttachmentId(id) ? records.get(id)?.bytes.slice() : undefined;
    },
    async markAttached(id) {
      const entry = isAttachmentId(id) ? records.get(id) : undefined;
      if (entry) entry.record.attached = true;
    },
    async remove(id) {
      if (isAttachmentId(id)) records.delete(id);
    },
    async removeAllOfChat(chatId) {
      let removed = 0;
      for (const [id, { record }] of records) {
        if (record.chatId === chatId) {
          records.delete(id);
          removed++;
        }
      }
      return removed;
    },
    async unattachedTotals(ownerId) {
      let files = 0;
      let bytes = 0;
      for (const { record } of records.values()) {
        if (record.ownerId === ownerId && !record.attached) {
          files++;
          bytes += record.size;
        }
      }
      return { files, bytes };
    },
    async removeUnattachedOlderThan(before) {
      let removed = 0;
      for (const [id, { record }] of records) {
        if (!record.attached && Date.parse(record.createdAt) < before.getTime()) {
          records.delete(id);
          removed++;
        }
      }
      return removed;
    },
  };
}
