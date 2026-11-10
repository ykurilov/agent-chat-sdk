import { tool } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AttachmentRejectedError } from "../../src/attachments/message-attachments";
import type { MessageAttachments } from "../../src/attachments/message-attachments";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { readAll } from "./support/mock-model";
import { callTool, noticeService, saying, scriptedModel, waitTurn } from "./support/notice-chat";

/*
 * Отметить вложения прикреплёнными не вышло (аудит C-03): сообщение со ссылкой на файл не записывается — иначе его файл
 * удалила бы чистка брошенных. Ошибка доходит вызывающему, ветка и счёт сообщений прежние, повтор проходит.
 */

const fileRef = { type: "file" as const, url: "attachment:f1", mediaType: "image/png", filename: "cat.png" };
const withFile = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }, fileRef] });
const plain = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const failures = [
  ["файл отклонён", new AttachmentRejectedError("attachment_unavailable", "Хранилище файлов не ответило")],
  ["хранилище файлов недоступно", new Error("хранилище файлов недоступно")],
] as const;

/** Вложения, у которых первая отметка падает с `failure`, дальше — проходит. */
function failingOnce(failure: Error): MessageAttachments {
  return {
    acceptUserParts: vi.fn(async ({ parts }: Parameters<MessageAttachments["acceptUserParts"]>[0]) =>
      parts.map((part) => ({ type: "file" as const, url: part.url, mediaType: "image/png", filename: "cat.png" })),
    ),
    confirmUserParts: vi.fn<MessageAttachments["confirmUserParts"]>().mockRejectedValueOnce(failure).mockResolvedValue(undefined),
    // Как настоящий модуль: ссылку `attachment:` модель не получает — вместо файла его описание.
    prepareHistory: vi.fn(async ({ history }: Parameters<MessageAttachments["prepareHistory"]>[0]) =>
      history.map((message) => ({ ...message, parts: message.parts.map((part) => (part.type === "file" ? { type: "text" as const, text: "картинка" } : part)) })),
    ),
  };
}

/** Счёт сообщений: сколько мест взято и не отдано назад. */
function countedMessages() {
  let taken = 0;
  const confirmed: string[] = [];
  const limits = {
    assertWithinLimit: async () => {},
    takeMessage: async ({ messageId }: { messageId: string }) => {
      taken += 1;
      const giveBack = async () => {
        taken -= 1;
      };
      return Object.assign(giveBack, { confirm: async () => void confirmed.push(messageId) });
    },
  } as unknown as SpendingLimits;
  return { limits, taken: () => taken, confirmed };
}

/** Инструмент `build`, который идёт, пока тест его не отпустит. */
function slowBuild() {
  let release!: () => void;
  let markStarted!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const build = tool({
    description: "Собрать",
    inputSchema: z.object({}),
    execute: async () => {
      markStarted();
      await released;
      return "собрано";
    },
  });
  return { build, release, started };
}

function setup(failure: Error, extra: { tools?: ToolSet; scripts?: Parameters<typeof scriptedModel>[0] } = {}) {
  const model = scriptedModel(extra.scripts);
  const attachments = failingOnce(failure);
  const counted = countedMessages();
  const { service, storage } = noticeService(model, { attachments, limits: counted.limits, ...(extra.tools && { agent: { tools: extra.tools } }) });
  return { model, service, storage, attachments, ...counted };
}

const idsOf = async (storage: { listMessages(chatId: string): Promise<Array<{ id: string }>> }, chatId: string) =>
  (await storage.listMessages(chatId)).map((message) => message.id);

describe.each(failures)("отметка вложений не удалась (%s): сообщение не записано, повтор проходит", (_name, failure) => {
  it("отправка: ошибка доходит вызывающему, сообщения нет, место в счёте отдано, хода нет; повтор — сообщение и ход", async () => {
    const { model, service, storage, taken, confirmed } = setup(failure);
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, withFile("u1", "смотри"))).rejects.toBe(failure);
    expect(await idsOf(storage, chat.id)).toEqual([]);
    expect(taken()).toBe(0);
    expect(confirmed).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(0);

    await readAll(await service.sendMessage("anna", chat.id, withFile("u1", "смотри")));
    expect(confirmed).toEqual(["u1"]);
    const saved = (await storage.listMessages(chat.id)).find((message) => message.id === "u1");
    expect(saved?.parts).toContainEqual(fileRef);
    expect(taken()).toBe(1);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("правка: новой ветки нет, текущая ветка прежняя; повтор правки проходит", async () => {
    const { model, service, storage, taken } = setup(failure);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, plain("u1", "раз")));
    const before = await service.getHistory("anna", chat.id);

    await expect(service.editMessage("anna", chat.id, "u1", withFile("u1e", "два"))).rejects.toBe(failure);
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.id)).toEqual(before.messages.map((message) => message.id));
    expect(await idsOf(storage, chat.id)).not.toContain("u1e");
    expect(taken()).toBe(1);
    expect(model.doStreamCalls).toHaveLength(1);

    await readAll(await service.editMessage("anna", chat.id, "u1", withFile("u1e", "два")));
    expect((await service.getHistory("anna", chat.id)).messages[0]?.id).toBe("u1e");
    expect(taken()).toBe(2);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("поправка к идущему ходу: поправки нет, ход идёт дальше; повтор поправки принят и получает ответ", async () => {
    const { build, release, started } = slowBuild();
    const { model, service, storage, taken } = setup(failure, { tools: { build }, scripts: [callTool("build", "c1"), saying("Собрал")] });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, plain("u1", "собери")));
    await started;

    await expect(service.steer("anna", chat.id, withFile("p1", "и покрась"))).rejects.toBe(failure);
    expect(await idsOf(storage, chat.id)).not.toContain("p1");
    expect(taken()).toBe(1);

    expect(await service.steer("anna", chat.id, withFile("p1", "и покрась"))).toEqual({ status: "queued", messageId: "p1" });
    expect(taken()).toBe(2);
    release();
    await first;
    await waitTurn(service, chat.id);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("и покрась");
  });
});

describe("durable file notification", () => {
  it("starts after insertion, does not block the answer and does not repeat for retry/edit/plain text", async () => {
    const attachments = failingOnce(new Error("unused"));
    vi.mocked(attachments.confirmUserParts).mockReset().mockResolvedValue(undefined);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const observed: string[] = [];
    const { service, storage } = noticeService(scriptedModel(), { attachments });
    attachments.userMessageStored = vi.fn(async ({ messageId, chatId, parts }) => {
      expect((await storage.listMessages(chatId)).some((message) => message.id === messageId)).toBe(true);
      expect(parts).toEqual([fileRef]); observed.push(messageId); await wait;
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, withFile("u1", "file")));
    expect(observed).toEqual(["u1"]);
    await expect(service.sendMessage("anna", chat.id, withFile("u1", "file"))).rejects.toThrow("уже есть");
    await readAll(await service.editMessage("anna", chat.id, "u1", withFile("edit", "edit")));
    await readAll(await service.sendMessage("anna", chat.id, plain("text", "text")));
    expect(attachments.userMessageStored).toHaveBeenCalledOnce(); release();
  });
  it("notification failures, including a throwing logger, never reject an already inserted message", async () => {
    const attachments = failingOnce(new Error("unused"));
    vi.mocked(attachments.confirmUserParts).mockReset().mockResolvedValue(undefined);
    const error = new Error("library unavailable");
    attachments.userMessageStored = vi.fn().mockRejectedValueOnce(error).mockImplementationOnce(() => { throw error; });
    const logError = vi.fn((_message: string, _error?: unknown) => { throw new Error("logger unavailable"); });
    const { service } = noticeService(scriptedModel(), { attachments, logError });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, withFile("u1", "one")));
    await readAll(await service.sendMessage("anna", chat.id, withFile("u2", "two")));
    expect(logError).toHaveBeenCalledTimes(2); expect(logError.mock.calls[0]![1]).toBe(error);
  });
  it("failed insert and rejected confirmation produce no notification; burst delivery produces one per new message", async () => {
    const attachments = failingOnce(new Error("confirm"));
    attachments.userMessageStored = vi.fn();
    const { service, storage } = noticeService(scriptedModel(), { attachments });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, withFile("refused", "x"))).rejects.toThrow("confirm");
    const insert = vi.spyOn(storage, "insertMessage").mockRejectedValueOnce(new Error("disk"));
    await expect(service.sendMessage("anna", chat.id, withFile("disk", "x"))).rejects.toThrow("disk");
    expect(attachments.userMessageStored).not.toHaveBeenCalled(); insert.mockRestore();
    const burst = await service.sendBurstMessage("anna", chat.id, withFile("burst", "telegram"), { channel: "telegram", quietMs: 0 });
    const stream = await burst.turn; if (stream) await readAll(stream);
    expect(attachments.userMessageStored).toHaveBeenCalledWith({ userId: "anna", chatId: chat.id, messageId: "burst", parts: [fileRef] });
    expect(attachments.userMessageStored).toHaveBeenCalledOnce();
  });
});
