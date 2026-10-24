import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createAttachments } from "../src/create-attachments";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import type { AttachmentStorage, StoredAttachment } from "../src/attachment-storage";

const HOUR = 60 * 60_000;

/**
 * Отправка сообщения с файлом идёт двумя шагами: приём (`acceptUserParts`) и отметка (`confirmUserParts`) перед
 * записью сообщения. Между ними и рядом с ними — удаление человеком и чистка брошенных. Сообщение не должно уйти со
 * ссылкой на файл, которого нет или который не отмечен, а отмеченный файл никто, кроме удаления чата, не убирает.
 */
function setup(overrides: (memory: AttachmentStorage) => Partial<AttachmentStorage> = () => ({})) {
  const memory = createMemoryAttachmentStorage();
  const storage: AttachmentStorage = { ...memory, ...overrides(memory) };
  let current = Date.parse("2026-03-01T12:00:00.000Z");
  const attachments = createAttachments({ storage, now: () => new Date(current) });
  async function add(overrides: Partial<StoredAttachment> = {}): Promise<StoredAttachment> {
    const item: StoredAttachment = {
      id: crypto.randomUUID(),
      chatId: "chat-1",
      ownerId: "anna",
      name: "заметки.txt",
      mediaType: "text/plain",
      kind: "text",
      size: 3,
      createdAt: new Date(current).toISOString(),
      attached: false,
      extractedText: "abc",
      ...overrides,
    };
    await memory.save(item, new Uint8Array([1, 2, 3]));
    return item;
  }
  const accept = (item: { id: string }) =>
    attachments.acceptUserParts({ userId: "anna", chatId: "chat-1", parts: [{ type: "file", url: `attachment:${item.id}` }] });
  const remove = (item: { id: string }, userId = "anna") =>
    attachments.handle({
      request: new Request(`http://x/api/chat/chat-1/attachments/${item.id}`, { method: "DELETE" }),
      userId,
      chatId: "chat-1",
      segments: [item.id],
    });
  return { memory, attachments, add, accept, remove, advance: (ms: number) => void (current += ms) };
}

/** Вызов ждёт, пока тест его не отпустит; `reached` — вызов дошёл до остановки. */
function gate() {
  let open!: () => void;
  let reach!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (reach = resolve));
  return { open, reached, wait: () => (reach(), opened) };
}

describe("отправка файла и удаление в то же время", () => {
  it("файл удалили между приёмом и отметкой — отметка отказывает attachment_not_found, сообщение не пишется", async () => {
    const { add, accept, remove, attachments } = setup();
    const item = await add();
    const parts = await accept(item);
    expect((await remove(item)).status).toBe(204);

    const error = await attachments.confirmUserParts(parts).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AttachmentRejectedError);
    expect(error).toMatchObject({ kind: "attachment_not_found" });
  });

  it("удаление прочитало «не прикреплён», а отметка успела раньше удаления — 409, файл отправленного сообщения цел", async () => {
    const deleteRead = gate();
    let holdNextGet = false;
    const { memory, add, accept, remove, attachments } = setup((memory) => ({
      async get(id) {
        const record = await memory.get(id);
        if (holdNextGet) {
          holdNextGet = false;
          await deleteRead.wait();
        }
        return record;
      },
    }));
    const item = await add();
    const parts = await accept(item);
    holdNextGet = true;
    const deleting = remove(item);
    await deleteRead.reached;
    await attachments.confirmUserParts(parts);
    deleteRead.open();

    const response = await deleting;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "attached" } });
    expect((await memory.get(item.id))?.attached).toBe(true);
    expect([...(await memory.readBytes(item.id))!]).toEqual([1, 2, 3]);
  });

  it("чужой человек (только смотрит чат) удалить файл не может: 404, отправка владельца проходит", async () => {
    const { add, accept, remove, attachments, memory } = setup();
    const item = await add();
    const parts = await accept(item);
    expect((await remove(item, "viewer")).status).toBe(404);
    await attachments.confirmUserParts(parts);
    expect((await memory.get(item.id))?.attached).toBe(true);
  });
});

describe("отметка файлов перед записью сообщения", () => {
  it("хранилище не отметило файл (запись есть, attached не стал true) — отказ attachment_not_found", async () => {
    const { add, accept, attachments } = setup(() => ({ async markAttached() {} }));
    const item = await add();
    const parts = await accept(item);
    await expect(attachments.confirmUserParts(parts)).rejects.toMatchObject({ kind: "attachment_not_found" });
  });

  it("сбой записи отметки — отказ attachment_unavailable; повтор той же отправки после сбоя проходит", async () => {
    let failing = true;
    const { add, accept, attachments, memory } = setup((memory) => ({
      async markAttached(id) {
        if (failing) throw new Error("EIO: диск недоступен");
        await memory.markAttached(id);
      },
    }));
    const item = await add();
    const parts = await accept(item);
    const error = await attachments.confirmUserParts(parts).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AttachmentRejectedError);
    expect(error).toMatchObject({ kind: "attachment_unavailable" });
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);

    failing = false;
    await attachments.confirmUserParts(await accept(item));
    expect((await memory.get(item.id))?.attached).toBe(true);
  });

  it("повтор отметки уже прикреплённого файла не ошибка: отправку можно повторить", async () => {
    const { add, accept, attachments, memory } = setup();
    const item = await add();
    await attachments.confirmUserParts(await accept(item));
    await attachments.confirmUserParts(await accept(item));
    expect((await memory.get(item.id))?.attached).toBe(true);
  });
});

describe("все пути удаления неотправленного — одним условным удалением", () => {
  const generalRemoveForbidden = () => ({
    async remove(): Promise<void> {
      throw new Error("безусловное remove — только для удаления чата и отменённого импорта");
    },
  });

  it("DELETE человека идёт через removeUnattached", async () => {
    const { add, remove, memory } = setup(generalRemoveForbidden);
    const item = await add();
    expect((await remove(item)).status).toBe(204);
    expect(await memory.get(item.id)).toBeUndefined();
  });

  it("просроченный файл при приёме убирается через removeUnattached", async () => {
    const { add, accept, memory, advance } = setup(generalRemoveForbidden);
    const item = await add();
    advance(25 * HOUR);
    await expect(accept(item)).rejects.toMatchObject({ kind: "attachment_expired" });
    expect(await memory.get(item.id)).toBeUndefined();
  });

  it("хранилище без removeUnattached не принимается: ошибка при создании, а не тихое безусловное удаление", () => {
    const { removeUnattached: _missing, ...legacy } = createMemoryAttachmentStorage();
    expect(() => createAttachments({ storage: legacy as AttachmentStorage })).toThrow(/removeUnattached/);
  });
});
