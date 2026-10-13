import { describe, expect, it } from "vitest";
import { createAttachments } from "../src/create-attachments";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import { makePdf, makePng, utf8 } from "./support/sample-files";

function setup(limits = {}) {
  const storage = createMemoryAttachmentStorage();
  const attachments = createAttachments({ storage, limits });
  return { storage, attachments };
}

describe("T048: ingestFile — файл с сервера тем же конвейером, что адрес загрузки", () => {
  it("картинка: вид по содержимому, запись не прикреплена, своя у человека и чата", async () => {
    const { attachments, storage } = setup();
    const result = await attachments.ingestFile({ userId: "anna", chatId: "chat-1", bytes: makePng(2, [0, 255, 0]), name: "photo" });
    expect(result).toMatchObject({ ok: true, attachment: { name: "photo", mediaType: "image/png", kind: "image" } });
    if (!result.ok) throw new Error("не принят");
    expect(result.attachment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await storage.get(result.attachment.id)).toMatchObject({ chatId: "chat-1", ownerId: "anna", attached: false });
  });

  it("PDF и текст: текст достаётся сразу, есть оценка токенов", async () => {
    const { attachments, storage } = setup();
    const pdf = await attachments.ingestFile({ userId: "anna", chatId: "chat-1", bytes: makePdf(["Code ZEBRA-4471"]), name: "счёт.pdf" });
    if (!pdf.ok) throw new Error("не принят");
    expect(pdf.attachment).toMatchObject({ kind: "pdf", mediaType: "application/pdf" });
    expect(pdf.attachment.textTokens).toBeGreaterThan(0);
    expect((await storage.get(pdf.attachment.id))?.extractedText).toContain("ZEBRA-4471");
  });

  it("имя очищается так же, как у загрузки", async () => {
    const { attachments } = setup();
    const result = await attachments.ingestFile({ userId: "anna", chatId: "chat-1", bytes: utf8("текст"), name: "../../etc/pass\nwd.txt" });
    expect(result).toMatchObject({ ok: true, attachment: { name: "passwd.txt" } });
  });

  it("отказы — видом ошибки, ничего не записано", async () => {
    const { attachments, storage } = setup({ maxFileBytes: 100, maxUnsentFiles: 1 });
    const refuse = (bytes: Uint8Array, name = "a.txt") => attachments.ingestFile({ userId: "anna", chatId: "chat-1", bytes, name });
    expect(await refuse(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    expect(await refuse(utf8("я".repeat(200)))).toEqual({ ok: false, reason: "too_large" });
    expect(await refuse(new Uint8Array([0, 1, 2, 3, 0, 0, 0xff]), "x.bin")).toEqual({ ok: false, reason: "unsupported_type" });
    expect((await storage.unattachedTotals("anna")).files).toBe(0);
    expect(await refuse(utf8("один"))).toMatchObject({ ok: true });
    expect(await refuse(utf8("два"))).toEqual({ ok: false, reason: "too_many_unsent" });
  });

  it("принятый файл прикрепляется к сообщению как загруженный", async () => {
    const { attachments } = setup();
    const result = await attachments.ingestFile({ userId: "anna", chatId: "chat-1", bytes: utf8("a,b\n1,2"), name: "t.csv" });
    if (!result.ok) throw new Error("не принят");
    const parts = await attachments.acceptUserParts({
      userId: "anna",
      chatId: "chat-1",
      parts: [{ type: "file", url: `attachment:${result.attachment.id}`, mediaType: "text/csv", filename: "t.csv" }],
    });
    expect(parts).toEqual([{ type: "file", url: `attachment:${result.attachment.id}`, mediaType: "text/csv", filename: "t.csv" }]);
  });
});
