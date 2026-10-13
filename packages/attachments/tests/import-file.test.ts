import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createAttachments } from "../src/create-attachments";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import { makePdf, makePng } from "./support/sample-files";

function setup(limits = {}) {
  const storage = createMemoryAttachmentStorage();
  const attachments = createAttachments({ storage, limits });
  return { storage, attachments };
}

const idOf = (url: string) => url.slice("attachment:".length);

describe("importFile — картинка импорта переписки", () => {
  it("тем же конвейером, сразу прикреплена; часть file с адресом вложения", async () => {
    const { attachments, storage } = setup();
    const part = await attachments.importFile!({ ownerId: "anna", chatId: "chat-1", bytes: makePng(2, [0, 255, 0]), mediaType: "image/png", filename: "схема.png" });
    expect(part).toEqual({ type: "file", url: expect.stringMatching(/^attachment:[0-9a-f-]{36}$/), mediaType: "image/png", filename: "схема.png" });
    expect(await storage.get(idOf(part.url))).toMatchObject({ chatId: "chat-1", ownerId: "anna", kind: "image", attached: true });
    expect((await storage.unattachedTotals("anna")).files).toBe(0);
  });

  it("лимит неотправленных файлов не действует", async () => {
    const { attachments, storage } = setup({ maxUnsentFiles: 1 });
    for (let index = 0; index < 3; index++) {
      await attachments.importFile!({ ownerId: "anna", chatId: "chat-1", bytes: makePng(2, [index, 0, 0]), mediaType: "image/png" });
    }
    expect(await storage.removeAllOfChat("chat-1")).toBe(3);
  });

  it("без имени — имя по умолчанию", async () => {
    const { attachments } = setup();
    const part = await attachments.importFile!({ ownerId: "anna", chatId: "chat-1", bytes: makePng(2, [0, 0, 0]), mediaType: "image/png" });
    expect(part.filename).toBe("image.png");
  });

  it("не картинка — AttachmentRejectedError, ничего не записано", async () => {
    const { attachments, storage } = setup();
    const failure = attachments.importFile!({ ownerId: "anna", chatId: "chat-1", bytes: makePdf(["текст"]), mediaType: "image/png", filename: "a.png" });
    await expect(failure).rejects.toBeInstanceOf(AttachmentRejectedError);
    await expect(failure).rejects.toMatchObject({ kind: "unsupported_type" });
    expect(await storage.removeAllOfChat("chat-1")).toBe(0);
  });

  it("discardImportedFiles убирает файлы", async () => {
    const { attachments, storage } = setup();
    const part = await attachments.importFile!({ ownerId: "anna", chatId: "chat-1", bytes: makePng(2, [0, 0, 0]), mediaType: "image/png" });
    await attachments.discardImportedFiles!([part]);
    expect(await storage.get(idOf(part.url))).toBeFalsy();
  });
});

describe("importFile — граница пакета", () => {
  it("обход лимита неотправленных наружу не торчит: только importFile из договора", () => {
    const { attachments } = setup();
    expect("ingestImportedImage" in attachments).toBe(false);
  });
});
