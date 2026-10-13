import type { AgentChatMessage, ModelProfile } from "@ykurilov/agent-chat-core";
import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import * as publicEntry from "../src";
import { createAttachments } from "../src/create-attachments";
import type { CreateAttachmentsOptions } from "../src/create-attachments";
import { attachmentsInstructions } from "../src/instructions";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import { makeBlankPdf, makePng, utf8 } from "./support/sample-files";

/** DeepSeek-подобная модель: видит картинки везде, кроме Together. */
const deepseekLike = { id: "ds", acceptsImages: true, acceptsImagesByProvider: { together: false } } as unknown as ModelProfile;
const blindEverywhere = { id: "blind", acceptsImages: false } as ModelProfile;

function setup(options: Omit<CreateAttachmentsOptions, "storage"> = {}) {
  const storage = createMemoryAttachmentStorage();
  const attachments = createAttachments({ storage, ...options });
  const upload = async (bytes: Uint8Array, name: string, chatId = "chat-1", userId = "anna") => {
    const form = new FormData();
    form.set("file", new File([bytes as BlobPart], name));
    return attachments.handle({ request: new Request(`http://x/api/chat/${chatId}/attachments`, { method: "POST", body: form }), userId, chatId, segments: [] });
  };
  const uploadImage = async (name = "shot.png", chatId = "chat-1", userId = "anna") => {
    const response = await upload(makePng(2, [255, 0, 0]), name, chatId, userId);
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const message = (id: string, name = "shot.png"): AgentChatMessage => ({
    id: "u1",
    role: "user",
    parts: [{ type: "file", url: `attachment:${id}`, mediaType: "image/png", filename: name }, { type: "text", text: "Что тут?" }],
  });
  const prepare = (history: AgentChatMessage[], profile: ModelProfile, providerId: string, chatId = "chat-1") =>
    attachments.prepareHistory({ chatId, history, model: { profile, providerId } });
  return { storage, attachments, upload, uploadImage, message, prepare };
}

describe("картинка у модели без зрения: решение по паре «модель + провайдер»", () => {
  it("та же модель у зрячего провайдера получает байты, у Together — пометку", async () => {
    const { uploadImage, message, prepare } = setup();
    const id = await uploadImage();
    const [seen] = await prepare([message(id)], deepseekLike, "fireworks");
    expect(seen!.parts[0]).toMatchObject({ type: "file", mediaType: "image/png" });
    const [blind] = await prepare([message(id)], deepseekLike, "together");
    expect(blind!.parts[0]).toEqual({ type: "text", text: "[Картинка «shot.png» не показана: выбранная модель не видит картинки.]" });
  });
});

describe("режим imagesForBlindModels", () => {
  it("не задан — модели без зрения прежняя пометка, инструкция и настройки прежние", async () => {
    const { attachments } = setup();
    expect(attachments.instructions).toBe(attachmentsInstructions);
    expect(await attachments.settings().json()).not.toHaveProperty("imagesForBlindModels");
  });

  it("задан — плашка с номером вложения и именем инструмента; зрячей паре картинка уходит как раньше", async () => {
    const { uploadImage, message, prepare } = setup({ imagesForBlindModels: { toolName: "look_at_attachment" } });
    const id = await uploadImage();
    const [blind] = await prepare([message(id)], deepseekLike, "together");
    expect(blind!.parts).toEqual([
      { type: "text", text: `[Картинка «shot.png», вложение ${id}. Посмотреть: look_at_attachment.]` },
      { type: "text", text: "Что тут?" },
    ]);
    const [seen] = await prepare([message(id)], deepseekLike, "fireworks");
    expect(seen!.parts[0]).toMatchObject({ type: "file" });
  });

  it("плашка одинакова байт в байт на каждом ходе, после смены модели и для старой загрузки", async () => {
    const { uploadImage, message, prepare } = setup({ imagesForBlindModels: { toolName: "look" } });
    const id = await uploadImage();
    const first = JSON.stringify(await prepare([message(id)], deepseekLike, "together"));
    await prepare([message(id)], deepseekLike, "fireworks");
    expect(JSON.stringify(await prepare([message(id)], deepseekLike, "together"))).toBe(first);
    expect(JSON.stringify(await prepare([message(id)], blindEverywhere, "deepseek"))).toBe(first);
  });

  it("свой текст плашки: функция от имени, номера, типа и автора; имя очищено от разметки", async () => {
    const seenInputs: unknown[] = [];
    const { uploadImage, message, prepare } = setup({
      imagesForBlindModels: {
        toolName: "look",
        marker: (image) => {
          seenInputs.push(image);
          return `[Скриншот от ${image.authorId}: ${image.name} #${image.id}]`;
        },
      },
    });
    const id = await uploadImage('a"<b>.png', "chat-1", "anna");
    const [blind] = await prepare([message(id)], blindEverywhere, "p");
    expect(blind!.parts[0]).toEqual({ type: "text", text: `[Скриншот от anna: a  b .png #${id}]` });
    expect(seenInputs[0]).toEqual({ id, name: "a  b .png", mediaType: "image/png", authorId: "anna" });
  });

  it("always — плашка и зрячей модели: картинки главной модели не уходят совсем", async () => {
    const { uploadImage, message, prepare } = setup({ imagesForBlindModels: { toolName: "look", always: true } });
    const id = await uploadImage();
    const [seen] = await prepare([message(id)], deepseekLike, "fireworks");
    expect(seen!.parts[0]).toEqual({ type: "text", text: `[Картинка «shot.png», вложение ${id}. Посмотреть: look.]` });
  });

  it("PDF и текст в режиме не меняются: по-прежнему блоком текста", async () => {
    const { upload, prepare } = setup({ imagesForBlindModels: { toolName: "look" } });
    const { id } = (await (await upload(utf8("a,b"), "t.csv")).json()) as { id: string };
    const [result] = await prepare([{ id: "u1", role: "user", parts: [{ type: "file", url: `attachment:${id}`, mediaType: "text/csv" }] }], blindEverywhere, "p");
    expect((result!.parts[0] as { text: string }).text).toMatch(/^<attachment name="t.csv"/);
  });

  it("инструкция вложений дописана постоянной строкой про плашку и инструмент; настройки говорят клиенту о режиме", async () => {
    const { attachments } = setup({ imagesForBlindModels: { toolName: "look_at_attachment" } });
    expect(attachments.instructions).toMatch(new RegExp(`^${attachmentsInstructions.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} .*look_at_attachment`));
    expect(setup({ imagesForBlindModels: { toolName: "look_at_attachment" } }).attachments.instructions).toBe(attachments.instructions);
    expect(await attachments.settings().json()).toMatchObject({ imagesForBlindModels: true });
  });

  it("пустое имя инструмента — ошибка настройки", () => {
    expect(() => setup({ imagesForBlindModels: { toolName: " " } })).toThrow(/toolName/);
  });
});

describe("readChatImage: картинка своего чата для инструмента приложения", () => {
  it("отдаёт байты, имя, тип и автора картинки этого чата", async () => {
    const { attachments, storage, uploadImage } = setup();
    const id = await uploadImage("shot.png", "chat-1", "anna");
    const image = await attachments.readChatImage({ chatId: "chat-1", attachmentId: id });
    expect(image).toMatchObject({ id, name: "shot.png", mediaType: "image/png", authorId: "anna" });
    expect(image!.bytes).toEqual(await storage.readBytes(id));
  });

  it("чужой чат, не UUID, неизвестный номер, не картинка, удалённый файл — undefined", async () => {
    const { attachments, storage, upload, uploadImage } = setup();
    const foreign = await uploadImage("shot.png", "chat-2");
    const { id: textId } = (await (await upload(utf8("x"), "t.txt")).json()) as { id: string };
    const lost = await uploadImage("lost.png");
    await storage.remove(lost);
    for (const attachmentId of [foreign, "../etc/passwd", crypto.randomUUID(), textId, lost]) {
      expect(await attachments.readChatImage({ chatId: "chat-1", attachmentId })).toBeUndefined();
    }
  });
});

describe("acceptedMediaTypes: только разрешённые типы", () => {
  const onlyImages = { acceptedMediaTypes: ["image/png", "image/jpeg", "image/webp"] };

  it("неподходящий файл — отказ unsupported_type до разбора и записи", async () => {
    const { upload, storage } = setup(onlyImages);
    // Пустой PDF без ограничения дал бы no_text (его разобрали бы); здесь отказ раньше разбора.
    for (const [bytes, name] of [[makeBlankPdf(), "скан.pdf"], [utf8("hello"), "t.txt"]] as const) {
      const response = await upload(bytes, name);
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: { kind: "unsupported_type" } });
    }
    expect(await storage.unattachedTotals("anna")).toEqual({ files: 0, bytes: 0 });
    expect((await upload(makePng(2, [0, 0, 255]), "ok.png")).status).toBe(201);
  });

  it("ingestFile и импорт тоже отказывают", async () => {
    const { attachments } = setup({ acceptedMediaTypes: ["image/jpeg"] });
    expect(await attachments.ingestFile({ userId: "anna", chatId: "chat-1", bytes: makePng(2, [0, 0, 0]), name: "a.png" })).toEqual({ ok: false, reason: "unsupported_type" });
    await expect(attachments.importFile!({ ownerId: "anna", chatId: "chat-1", bytes: makePng(2, [0, 0, 0]), mediaType: "image/png" })).rejects.toMatchObject({
      kind: "unsupported_type",
    });
  });

  it("файл, загруженный до ограничения, в новом сообщении — понятный отказ unsupported_type", async () => {
    const storage = createMemoryAttachmentStorage();
    const before = createAttachments({ storage });
    const ingested = await before.ingestFile({ userId: "anna", chatId: "chat-1", bytes: utf8("x"), name: "t.txt" });
    const after = createAttachments({ storage, ...onlyImages });
    const attempt = after.acceptUserParts({ userId: "anna", chatId: "chat-1", parts: [{ type: "file", url: `attachment:${ingested.ok && ingested.attachment.id}` }] });
    await expect(attempt).rejects.toBeInstanceOf(AttachmentRejectedError);
    await expect(attempt).rejects.toMatchObject({ kind: "unsupported_type", message: "Такой файл прикрепить нельзя: подойдут только PNG, JPEG, WebP." });
  });

  it("большой PNG при [\"image/png\"]: ужатие сделало JPEG, а файл проходит загрузку и отправку — решение по исходному типу", async () => {
    const { upload, storage, attachments } = setup({ acceptedMediaTypes: ["image/png"] });
    // Шум: в JPEG он меньше, чем в PNG, — ужатие меняет тип.
    const noise = Uint8Array.from({ length: 2400 * 600 * 3 }, (_, index) => (index * 2654435761) >>> 24);
    const bigPng = new Uint8Array(await sharp(noise, { raw: { width: 2400, height: 600, channels: 3 } }).png().toBuffer());
    const response = await upload(bigPng, "screen.png");
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await storage.get(id)).toMatchObject({ mediaType: "image/jpeg", sourceMediaType: "image/png" });
    await expect(attachments.acceptUserParts({ userId: "anna", chatId: "chat-1", parts: [{ type: "file", url: `attachment:${id}` }] })).resolves.toHaveLength(1);
  });

  it("старая запись без исходного типа — проверка по её типу", async () => {
    const storage = createMemoryAttachmentStorage();
    const ingested = await createAttachments({ storage }).ingestFile({ userId: "anna", chatId: "chat-1", bytes: makePng(2, [0, 0, 0]), name: "a.png" });
    const id = ingested.ok ? ingested.attachment.id : "";
    const { sourceMediaType: _dropped, ...old } = (await storage.get(id))!;
    await storage.save(old, (await storage.readBytes(id))!);
    const parts = [{ type: "file" as const, url: `attachment:${id}` }];
    await expect(createAttachments({ storage, acceptedMediaTypes: ["image/png"] }).acceptUserParts({ userId: "anna", chatId: "chat-1", parts })).resolves.toHaveLength(1);
    await expect(createAttachments({ storage, acceptedMediaTypes: ["image/jpeg"] }).acceptUserParts({ userId: "anna", chatId: "chat-1", parts })).rejects.toMatchObject({
      kind: "unsupported_type",
    });
  });

  it("настройки для клиента: только разрешённое в поле выбора и списком типов", async () => {
    expect(await setup(onlyImages).attachments.settings().json()).toMatchObject({
      accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
      acceptedMediaTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    expect(await setup().attachments.settings().json()).not.toHaveProperty("acceptedMediaTypes");
  });

  it("тип, которого SDK не распознаёт, или пустой список — ошибка настройки", () => {
    expect(() => setup({ acceptedMediaTypes: ["image/jpg"] })).toThrow(/image\/jpg/);
    expect(() => setup({ acceptedMediaTypes: [] })).toThrow(/acceptedMediaTypes/);
  });
});

describe("публичный вход", () => {
  it("isAttachmentId экспортирован", () => {
    expect(publicEntry.isAttachmentId(crypto.randomUUID())).toBe(true);
    expect(publicEntry.isAttachmentId("../x")).toBe(false);
  });
});
