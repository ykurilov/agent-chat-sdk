import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { AgentNotice, KnownTexts, ReplyCheck, ReplyCheckInput, ReplyChecksSetting, UsageRecord } from "../../../src/index";
import { ChatNotFoundError } from "../../../src/index";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { finishPart, generateResult, readAll, streamOf, streamStart } from "../support/mock-model";
import { doneNotice, noticeService, saying, userMessage } from "../support/notice-chat";

/** Проверка, которая ничего не меняет и запоминает, что получила. */
function watching(seen: ReplyCheckInput[]): ReplyCheck {
  return async (input) => {
    seen.push(input);
  };
}

function setup(replyChecks: ReplyChecksSetting, scripts: LanguageModelV4StreamPart[][] = [], extra: Parameters<typeof noticeService>[1] = {}, rewrites: string[] = []) {
  const storage = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    written.push(record);
    return insert(record);
  };
  const logged: string[] = [];
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf(scripts[call++] ?? saying(`ответ ${call}`)) }),
    doGenerate: async () => generateResult(rewrites.shift() ?? "", { output: 7 }),
  });
  const { service } = noticeService(model, { storage, logError: (line) => void logged.push(String(line)), replyChecks, ...extra });
  return { service, storage, model, logged, written };
}

const staffReply = (text: string): AgentNotice => ({ kind: "app", name: "flow_staff_reply", title: `Живой сотрудник ответил человеку вместо тебя: «${text}».` });

const wake = (chatId: string, notices: AgentNotice[], key: string) => ({ ownerId: "anna", chatId, notices, wakeAgent: true, deliveryKey: key, awaitAnswer: true });

describe("066: knownTexts — тексты приложения вне инструкции", () => {
  it("тексты приложения идут в seenTexts проверки хода; функция получает владельца и чат", async () => {
    const seen: ReplyCheckInput[] = [];
    const knownTexts = vi.fn<KnownTexts>(async () => ["Первое сообщение: https://first.example", "Прощание"]);
    const { service } = setup({ checks: [watching(seen)], knownTexts });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(knownTexts).toHaveBeenCalledWith({ ownerId: "anna", chatId: chat.id });
    expect(seen[0]!.seenTexts).toEqual(expect.arrayContaining(["Первое сообщение: https://first.example", "Прощание", "Ты помощник."]));
  });

  it("обычная функция тоже подходит; пустые и не строки отбрасываются", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service } = setup({ checks: [watching(seen)], knownTexts: () => ["текст", "", 5 as unknown as string] });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(seen[0]!.seenTexts).toContain("текст");
    expect(seen[0]!.seenTexts).not.toContain("");
    expect(seen[0]!.seenTexts).not.toContain(5);
  });

  it("knownTexts упал — строка в журнал, проверки идут без этих текстов, ответ не теряется", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service, logged } = setup({
      checks: [watching(seen)],
      knownTexts: async () => {
        throw new Error("база недоступна");
      },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(seen).toHaveLength(1);
    expect(logged.some((line) => line.includes("knownTexts упал") && line.includes("база недоступна"))).toBe(true);
  });

  it("knownTexts не функция — TypeError при создании службы", () => {
    expect(() => setup({ checks: [], knownTexts: "текст" as unknown as KnownTexts })).toThrow(TypeError);
  });
});

describe("066: service.checkReply — проверка текста вне хода модели", () => {
  it("те же проверки и тот же набор seenTexts: инструкция, блоки, реплики человека, тексты приложения; ответы агента — нет", async () => {
    const seen: ReplyCheckInput[] = [];
    const replacing: ReplyCheck = async (input) => {
      seen.push(input);
      return input.text.includes("Пpивет") ? { text: input.text.replace("Пpивет", "Привет"), note: "заменено" } : undefined;
    };
    const { service, logged } = setup(
      { checks: [replacing], knownTexts: () => ["Прощание: https://bye.example"] },
      [saying("Прошлый ответ: https://made-up.example/old")],
      { agent: { instructions: "Инструкция: https://instr.example", contextBlocks: () => [{ key: "skills", text: "Блок: https://block.example" }] } },
    );
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "мой сайт https://human.example")));
    seen.length = 0;
    const result = await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "Пpивет! https://instr.example" });
    expect(result).toEqual({ text: "Привет! https://instr.example", notes: ["заменено"] });
    expect(seen[0]).toMatchObject({ ownerId: "anna", chatId: chat.id, text: "Пpивет! https://instr.example" });
    const all = seen[0]!.seenTexts.join("\n");
    for (const expected of ["https://instr.example", "https://block.example", "https://human.example", "https://bye.example"]) expect(all).toContain(expected);
    expect(all).not.toContain("https://made-up.example/old");
    expect(logged.some((line) => line.includes("[replyChecks]") && line.includes("заменено"))).toBe(true);
  });

  it("переписка моделью чата; расход answer_correction без сообщения; ход не запускается", async () => {
    const rewriting: ReplyCheck = async ({ text, rewrite }) => ({ text: await rewrite("Ты редактор.", text) });
    const { service, model, written } = setup([rewriting], [], {}, ["Чистовик"]);
    const chat = await service.createChat("anna");
    const result = await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "Черновик" });
    expect(result.text).toBe("Чистовик");
    expect(model.doStreamCalls).toHaveLength(0);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(written.map((record) => [record.source, record.messageId])).toEqual([["answer_correction", null]]);
  });

  it("проверка упала или вернула пустое — остаётся текст до неё, как на ходе; следующие проверки идут", async () => {
    const broken: ReplyCheck = async () => {
      throw new Error("сломалась");
    };
    const empty: ReplyCheck = async () => ({ text: " " });
    const second: ReplyCheck = async ({ text }) => ({ text: `${text}!` });
    const { service, logged } = setup([broken, empty, second]);
    const chat = await service.createChat("anna");
    expect(await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "Текст" })).toEqual({ text: "Текст!", notes: [] });
    expect(logged.some((line) => line.includes("сломалась"))).toBe(true);
    expect(logged.some((line) => line.includes("пустой текст"))).toBe(true);
  });

  it("без проверок — текст как есть; чужой или неизвестный чат — ChatNotFoundError", async () => {
    const { service } = setup([]);
    const chat = await service.createChat("anna");
    expect(await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "Текст" })).toEqual({ text: "Текст", notes: [] });
    await expect(service.checkReply({ ownerId: "boris", chatId: chat.id, text: "Текст" })).rejects.toBeInstanceOf(ChatNotFoundError);
  });
});

describe("066: слова человека — только из сообщений человека", () => {
  it("на ходе: ссылка из реплики сотрудника и служебного сообщения не законна; сообщение человека и итог фоновой задачи — законны", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service } = setup([watching(seen)], [saying("Принято."), saying("Хорошо.")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "моя страница https://human.example")));
    await service.deliverNotices(wake(chat.id, [staffReply("загляните на https://staff.example")], "staff-1"));
    await service.deliverNotices(wake(chat.id, [{ kind: "conversation_started", title: "Начни разговор: расскажи про https://nudge.example" }], "first-1"));
    await service.deliverNotices(wake(chat.id, [doneNotice("Отчёт", "готов: https://report.example")], "task-1"));
    const all = seen.at(-1)!.seenTexts.join("\n");
    expect(all).toContain("https://human.example");
    expect(all).toContain("https://report.example");
    expect(all).not.toContain("https://staff.example");
    expect(all).not.toContain("https://nudge.example");
  });

  it("служебное сообщение из prepareTurn хода тоже не делает ссылку законной", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service } = setup([watching(seen)], [], {
      agent: { prepareTurn: () => ({ notices: [{ kind: "app", name: "flow_event", title: "Событие: https://event.example" }] }) },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет https://human.example")));
    const all = seen[0]!.seenTexts.join("\n");
    expect(all).toContain("https://human.example");
    expect(all).not.toContain("https://event.example");
  });

  it("в checkReply то же правило: сотрудник и служебное — нет, человек — да", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service } = setup([watching(seen)], [saying("Принято."), saying("Хорошо.")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "моя страница https://human.example")));
    await service.deliverNotices(wake(chat.id, [staffReply("загляните на https://staff.example")], "staff-1"));
    seen.length = 0;
    await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "ответ" });
    const all = seen[0]!.seenTexts.join("\n");
    expect(all).toContain("https://human.example");
    expect(all).not.toContain("https://staff.example");
  });
});
