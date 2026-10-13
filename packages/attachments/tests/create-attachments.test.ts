import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createAttachments } from "../src/create-attachments";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import type { StoredAttachment } from "../src/attachment-storage";
import { defaultAttachmentLimits } from "../src/limits";

async function setup(limits = {}) {
  const storage = createMemoryAttachmentStorage();
  const attachments = createAttachments({ storage, limits });
  async function add(overrides: Partial<StoredAttachment> = {}): Promise<StoredAttachment> {
    const item: StoredAttachment = {
      id: crypto.randomUUID(),
      chatId: "chat-1",
      ownerId: "anna",
      name: "заметки.txt",
      mediaType: "text/plain",
      kind: "text",
      size: 3,
      createdAt: new Date().toISOString(),
      attached: false,
      extractedText: "abc",
      textTruncated: false,
      ...overrides,
    };
    await storage.save(item, new Uint8Array([1]));
    return item;
  }
  const part = (item: { id: string }, extra: object = {}) => ({ type: "file" as const, url: `attachment:${item.id}`, ...extra });
  const accept = (parts: ReturnType<typeof part>[], userId = "anna", chatId = "chat-1") =>
    attachments.acceptUserParts({ userId, chatId, parts });
  return { storage, attachments, add, part, accept };
}

describe("приём вложений сообщения", () => {
  it("свои файлы принимаются: имя и тип берутся из записи, а не от клиента; файл отмечается прикреплённым", async () => {
    const { add, part, accept, storage, attachments } = await setup();
    const item = await add();
    const stored = await accept([part(item, { mediaType: "text/x-evil", filename: "../../hack" })]);
    expect(stored).toEqual([{ type: "file", url: `attachment:${item.id}`, mediaType: "text/plain", filename: "заметки.txt" }]);
    expect((await storage.get(item.id))?.attached).toBe(false);
    await attachments.confirmUserParts(stored);
    expect((await storage.get(item.id))?.attached).toBe(true);
  });

  it("чужой файл, файл из другого чата, несуществующий и ссылка не в формате — одно и то же «не найдено», ничего не привязано", async () => {
    const { add, part, accept, storage } = await setup();
    const mine = await add();
    const foreignOwner = await add({ ownerId: "boris" });
    const otherChat = await add({ chatId: "chat-2" });
    for (const bad of [
      [part(mine), part(foreignOwner)],
      [part(otherChat)],
      [part({ id: crypto.randomUUID() })],
      [{ type: "file" as const, url: "https://example.com/a.png" }],
      [part({ id: "../../etc/passwd" })],
    ]) {
      await expect(accept(bad)).rejects.toMatchObject({ kind: "attachment_not_found" });
    }
    expect((await storage.get(mine.id))?.attached).toBe(false);
  });

  it("больше 10 файлов — отказ too_many; лимит настраивается", async () => {
    const { add, part, accept } = await setup();
    const many = await Promise.all(Array.from({ length: 11 }, () => add()));
    await expect(accept(many.map((item) => part(item)))).rejects.toMatchObject({ kind: "too_many" });
    const small = await setup({ maxFiles: 1 });
    const two = await Promise.all([small.add(), small.add()]);
    await expect(small.accept(two.map((item) => small.part(item)))).rejects.toBeInstanceOf(AttachmentRejectedError);
  });

  it("текста больше потолка на сообщение — отказ too_much_text", async () => {
    const { add, part, accept } = await setup({ maxMessageTextTokens: 100 });
    const files = await Promise.all([add({ extractedText: "а".repeat(200) }), add({ extractedText: "а".repeat(200) })]);
    await expect(accept(files.map((item) => part(item)))).rejects.toMatchObject({ kind: "too_much_text" });
    await expect(accept([part(files[0]!)])).resolves.toHaveLength(1);
  });

  it("один файл дважды в одном сообщении считается один раз", async () => {
    const { add, part, accept } = await setup();
    const item = await add();
    expect(await accept([part(item), part(item)])).toHaveLength(1);
  });

  it("уже прикреплённый файл того же чата можно приложить снова", async () => {
    const { add, part, accept } = await setup();
    const item = await add({ attached: true });
    expect(await accept([part(item)])).toHaveLength(1);
  });

  it("лимиты по умолчанию — из решений: 10 файлов, 20 МБ, 25 000 и 100 000 токенов", () => {
    expect(defaultAttachmentLimits).toMatchObject({
      maxFiles: 10,
      maxFileBytes: 20 * 1024 * 1024,
      maxFileTextTokens: 25_000,
      maxMessageTextTokens: 100_000,
    });
  });
});

describe("удаление файлов чата", () => {
  it("removeChatFiles убирает файлы этого чата и не трогает чужие", async () => {
    const { add, attachments, storage } = await setup();
    const mine = await add({ chatId: "chat-1" });
    const attached = await add({ chatId: "chat-1", attached: true });
    const other = await add({ chatId: "chat-2" });
    await attachments.removeChatFiles!("chat-1");
    expect(await storage.get(mine.id)).toBeUndefined();
    expect(await storage.get(attached.id)).toBeUndefined();
    expect(await storage.get(other.id)).toBeDefined();
  });
});

describe("брошенные и просроченные загрузки", () => {
  const HOUR = 60 * 60_000;
  const start = Date.parse("2026-03-01T12:00:00.000Z");

  function clockSetup() {
    let current = start;
    const storage = createMemoryAttachmentStorage();
    const attachments = createAttachments({ storage, now: () => new Date(current) });
    const record = (ageMs: number, overrides: Partial<StoredAttachment> = {}): StoredAttachment => ({
      id: crypto.randomUUID(),
      chatId: "chat-1",
      ownerId: "anna",
      name: "a.txt",
      mediaType: "text/plain",
      kind: "text",
      size: 1,
      createdAt: new Date(current - ageMs).toISOString(),
      attached: false,
      extractedText: "abc",
      ...overrides,
    });
    const upload = async () => {
      const form = new FormData();
      form.set("file", new File([new TextEncoder().encode("новый")], "n.txt"));
      const response = await attachments.handle({
        request: new Request("http://x/api/chat/chat-1/attachments", { method: "POST", body: form }),
        userId: "anna",
        chatId: "chat-1",
        segments: [],
      });
      expect(response.status).toBe(201);
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
    return { storage, attachments, record, upload, settle, advance: (ms: number) => void (current += ms) };
  }

  it("при загрузке чистятся неотправленные файлы старше 24 часов; прикреплённые и свежие остаются", async () => {
    const { storage, record, upload, settle } = clockSetup();
    const old = record(25 * HOUR);
    const oldAttached = record(48 * HOUR, { attached: true });
    const fresh = record(23 * HOUR);
    for (const item of [old, oldAttached, fresh]) await storage.save(item, new Uint8Array([1]));
    await upload();
    await settle();
    expect(await storage.get(old.id)).toBeUndefined();
    expect(await storage.get(oldAttached.id)).toBeDefined();
    expect(await storage.get(fresh.id)).toBeDefined();
  });

  it("чистка идёт не чаще раза в 15 минут", async () => {
    const { storage, record, upload, settle, advance } = clockSetup();
    await upload();
    await settle();
    const old = record(25 * HOUR);
    await storage.save(old, new Uint8Array([1]));
    advance(14 * 60_000);
    await upload();
    await settle();
    expect(await storage.get(old.id)).toBeDefined();
    advance(2 * 60_000);
    await upload();
    await settle();
    expect(await storage.get(old.id)).toBeUndefined();
  });

  it("файл, загруженный больше 24 часов назад и ещё не отправленный, — отказ attachment_expired с понятным текстом, файл убирается", async () => {
    const { storage, attachments, record } = clockSetup();
    const old = record(25 * HOUR);
    await storage.save(old, new Uint8Array([1]));
    const error = await attachments
      .acceptUserParts({ userId: "anna", chatId: "chat-1", parts: [{ type: "file", url: `attachment:${old.id}` }] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AttachmentRejectedError);
    expect(error).toMatchObject({ kind: "attachment_expired" });
    expect((error as Error).message).toMatch(/загрузите/i);
    expect(await storage.get(old.id)).toBeUndefined();
  });

  it("суток не касаются файла, уже отправленного в сообщении: срок только для неотправленных", async () => {
    const { storage, attachments, record } = clockSetup();
    const old = record(30 * HOUR, { attached: true });
    await storage.save(old, new Uint8Array([1]));
    await expect(
      attachments.acceptUserParts({ userId: "anna", chatId: "chat-1", parts: [{ type: "file", url: `attachment:${old.id}` }] }),
    ).resolves.toHaveLength(1);
  });
});

describe("хранилище для других пакетов (024, картинки агента)", () => {
  it("attachments.storage — то самое хранилище: пакет картинок пишет в него файлы, которые отдаёт маршрут вложений", async () => {
    const { attachments, storage } = await setup();
    expect(attachments.storage).toBe(storage);
  });

  it("проверка типа файла по содержимому доступна снаружи", async () => {
    const { detectFileKind } = await import("../src/index");
    expect(detectFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "")).toEqual({ kind: "image", mediaType: "image/jpeg" });
  });
});
