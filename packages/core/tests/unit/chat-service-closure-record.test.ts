import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ChatClosedError } from "../../src/index";
import type { AgentToolsModel, ChatEvent } from "../../src/index";
import { newStoredMessage } from "../../src/conversation/types";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { readAll } from "./support/mock-model";
import { callTool, lastUserTexts, noticeService, saying, scriptedModel, textsOf, userMessage } from "./support/notice-chat";

const CLOSURE = { code: "form_completed", message: "Заявка отправлена." };

const closingTools = (model: AgentToolsModel) => ({
  finish_form: tool({
    description: "Отправить заявку",
    inputSchema: z.object({}),
    execute: async () => {
      model.closeChat!(CLOSURE);
      return "отправлено";
    },
  }),
});

function setup(scripts: Parameters<typeof scriptedModel>[0] = [], extra: Parameters<typeof noticeService>[1] = {}) {
  const model = scriptedModel(scripts);
  const events: ChatEvent[] = [];
  const built = noticeService(model, { agent: { tools: closingTools }, ...extra });
  built.service.subscribeEvents((event) => events.push(event));
  return { ...built, model, events };
}

async function send(service: ReturnType<typeof setup>["service"], chatId: string, id: string, text = "Привет") {
  return readAll(await service.sendMessage("anna", chatId, userMessage(id, text)));
}

const stateParts = (parts: ReadonlyArray<{ type: string }>) => parts.filter((part) => part.type === "data-app-state");

describe("закрытие из кода — служебное сообщение на ветке", () => {
  it("closeChat пишет в конец ветки сообщение с $closed, reopenChat — с unset; в истории их нет, модели не уходят", async () => {
    const { service, storage, model } = setup([saying("Первый"), saying("Второй")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    const closing = (await storage.listMessages(chat.id)).at(-1)!;
    expect(closing).toMatchObject({ role: "user", parts: [{ type: "data-app-state", data: { set: { $closed: CLOSURE } } }] });
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.id)).not.toContain(closing.id);

    await service.reopenChat({ ownerId: "anna", chatId: chat.id });
    const reopening = (await storage.listMessages(chat.id)).at(-1)!;
    expect(reopening).toMatchObject({ role: "user", parentId: closing.id, parts: [{ type: "data-app-state", data: { unset: ["$closed"] } }] });

    await send(service, chat.id, "u2", "Ещё");
    const history = await service.getHistory("anna", chat.id);
    expect(history.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // Запрос второго хода — как без закрытия: вопрос, ответ, вопрос; пустых сообщений нет.
    const prompt = model.doStreamCalls[1]!.prompt.filter((message) => message.role !== "system");
    expect(prompt.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(lastUserTexts(model.doStreamCalls[1]!).join("")).toContain("Ещё");
  });

  it("открытый чат: reopenChat ничего не пишет", async () => {
    const { service, storage } = setup([saying("Первый")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    const before = (await storage.listMessages(chat.id)).length;
    await service.reopenChat({ ownerId: "anna", chatId: chat.id });
    expect(await storage.listMessages(chat.id)).toHaveLength(before);
  });

  it("«Повторить» на служебное сообщение не отвечает", async () => {
    const { service } = setup([saying("Первый")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await service.reopenChat({ ownerId: "anna", chatId: chat.id });
    await expect(service.retry("anna", chat.id)).rejects.toMatchObject({ name: "NothingToRetryError" });
  });

  it("колонка closed — копия для списка: закрытие и открытие её ведут", async () => {
    const { service, storage } = setup([saying("Первый")]);
    const chat = await service.createChat("anna");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE);
    expect((await service.listChats("anna"))[0]).toMatchObject({ closed: CLOSURE });
    await service.reopenChat({ ownerId: "anna", chatId: chat.id });
    expect((await storage.getChat(chat.id))!.closed).toBeUndefined();
  });
});

describe("закрытый чат: правка до точки закрытия откатывает закрытие", () => {
  it("правка — новая ветка открыта, событие chat-reopened; возврат на старую ветку — снова закрыт", async () => {
    const { service, storage, events } = setup([saying("Первый"), saying("После правки"), saying("Ещё")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await expect(send(service, chat.id, "u2")).rejects.toBeInstanceOf(ChatClosedError);

    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1-edit", "Привет иначе")));
    expect((await service.getHistory("anna", chat.id)).chat.closed).toBeUndefined();
    await vi.waitFor(() => expect(events.at(-1)?.type === "chat-reopened" || events.some((event) => event.type === "chat-reopened")).toBe(true));
    expect((await storage.getChat(chat.id))!.closed).toBeUndefined();
    await send(service, chat.id, "u3", "Ещё");

    await service.selectBranch("anna", chat.id, "u1");
    expect((await service.getHistory("anna", chat.id)).chat.closed).toEqual(CLOSURE);
    await vi.waitFor(async () => expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE));
    await expect(send(service, chat.id, "u4")).rejects.toBeInstanceOf(ChatClosedError);
  });

  it("закрытие из инструмента живёт в ответе: «Переделать» этот ответ открывает чат", async () => {
    const { service, storage } = setup([callTool("finish_form", "c1"), saying("Готово"), saying("Переделал")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "Отправь");
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(JSON.stringify(stateParts(answer.parts))).toContain("$closed");
    expect((await service.getHistory("anna", chat.id)).chat.closed).toEqual(CLOSURE);

    await readAll(await service.regenerate("anna", chat.id, answer.id));
    expect((await service.getHistory("anna", chat.id)).chat.closed).toBeUndefined();
    await send(service, chat.id, "u2", "Ещё");
  });

  it("в закрытом чате по-прежнему нельзя: отправка, «Повторить», подтверждение — ChatClosedError", async () => {
    const { service } = setup([saying("Первый")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await expect(send(service, chat.id, "u2")).rejects.toBeInstanceOf(ChatClosedError);
    await expect(service.retry("anna", chat.id)).rejects.toBeInstanceOf(ChatClosedError);
    await expect(service.assertTurnAllowed("anna", chat.id, "send", "Ещё")).rejects.toBeInstanceOf(ChatClosedError);
  });

  it("закрыть навсегда — правами приложения: chatCapabilities видит chat.closed", async () => {
    const { service } = setup([saying("Первый")], {
      chatCapabilities: ({ chat }) => (chat.closed ? { edit: false, regenerate: false, branches: false } : {}),
    });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await expect(service.editMessage("anna", chat.id, "u1", userMessage("u2", "Правка"))).rejects.toMatchObject({ name: "ActionForbiddenError" });
  });
});

describe("закрытие из кода посреди хода", () => {
  it("ждёт конца хода и ложится после ответа; до этого чат уже закрыт", async () => {
    let service!: ReturnType<typeof setup>["service"];
    let chatId = "";
    const lookup = tool({
      description: "Справка",
      inputSchema: z.object({}),
      execute: async () => {
        await service.closeChat({ ownerId: "anna", chatId, ...CLOSURE });
        expect((await service.peekHistory("anna", chatId)).chat.closed).toEqual(CLOSURE);
        return "готово";
      },
    });
    const built = setup([callTool("lookup", "c1"), saying("Ответ")], { agent: { tools: { lookup } } });
    service = built.service;
    const chat = await service.createChat("anna");
    chatId = chat.id;
    await send(service, chat.id, "u1");
    await vi.waitFor(async () => expect((await built.storage.listMessages(chat.id)).at(-1)!.role).toBe("user"));
    const [, answer, closing] = await built.storage.listMessages(chat.id);
    expect(answer!.status).toBe("complete");
    expect(closing).toMatchObject({ parentId: answer!.id, parts: [{ type: "data-app-state", data: { set: { $closed: CLOSURE } } }] });
    expect((await service.getHistory("anna", chat.id)).chat.closed).toEqual(CLOSURE);
  });

  it("после хода правка, «Переделать» и смена ветки уводят с точки закрытия; список чатов идёт за веткой", async () => {
    let service!: ReturnType<typeof setup>["service"];
    let chatId = "";
    const lookup = tool({
      description: "Справка",
      inputSchema: z.object({}),
      execute: async () => {
        await service.closeChat({ ownerId: "anna", chatId, ...CLOSURE });
        return "готово";
      },
    });
    const built = setup([callTool("lookup", "c1"), saying("Ответ"), saying("После правки"), saying("Переделал")], { agent: { tools: { lookup } } });
    service = built.service;
    const chat = await service.createChat("anna");
    chatId = chat.id;
    await send(service, chat.id, "u1");
    await service.flush();
    const listed = async () => (await service.listChats("anna")).find((entry) => entry.id === chat.id)!.closed;
    const answer = (await built.storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(await listed()).toEqual(CLOSURE);

    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1-edit", "Иначе")));
    await service.flush();
    expect((await service.getHistory("anna", chat.id)).chat.closed).toBeUndefined();
    expect(await listed()).toBeUndefined();

    await service.selectBranch("anna", chat.id, "u1");
    await service.flush();
    expect((await service.getHistory("anna", chat.id)).chat.closed).toEqual(CLOSURE);
    expect(await listed()).toEqual(CLOSURE);
    await expect(send(service, chat.id, "u2")).rejects.toBeInstanceOf(ChatClosedError);

    await readAll(await service.regenerate("anna", chat.id, answer.id));
    await service.flush();
    expect((await service.getHistory("anna", chat.id)).chat.closed).toBeUndefined();
    expect(await listed()).toBeUndefined();
  });
});

describe("сбой копии закрытия (setChatClosed)", () => {
  it("права и перезагрузка берут закрытие с ветки; чтение истории чинит копию для списка", async () => {
    const storage = createInMemoryChatStorage();
    const setChatClosed = storage.setChatClosed!.bind(storage);
    let failing = true;
    storage.setChatClosed = async (id, closed) => {
      if (failing) throw new Error("база недоступна");
      return setChatClosed(id, closed);
    };
    const logError = vi.fn();
    const { service, events } = setup([callTool("finish_form", "c1"), saying("Готово")], {
      storage,
      logError,
      chatCapabilities: ({ chat }) => (chat.closed ? { edit: false } : {}),
    });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "Отправь");
    await service.flush();
    expect(events.some((event) => event.type === "chat-closed")).toBe(true);
    expect((await storage.getChat(chat.id))!.closed).toBeUndefined();

    // Вкладка видит «закрыт» по событию; перезагрузка и права — тоже, хотя копия не записалась.
    await expect(service.editMessage("anna", chat.id, "u1", userMessage("u1-edit", "Иначе"))).rejects.toMatchObject({ name: "ActionForbiddenError" });
    const reloaded = await service.getHistory("anna", chat.id);
    expect(reloaded.chat.closed).toEqual(CLOSURE);
    expect(reloaded.capabilities.edit).toBe(false);

    failing = false;
    await service.getHistory("anna", chat.id);
    expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE);
    expect((await service.listChats("anna"))[0]).toMatchObject({ closed: CLOSURE });
  });
});

describe("перенос закрытия 0.27 (только колонка)", () => {
  async function legacyClosedChat() {
    const storage = createInMemoryChatStorage();
    const built = setup([saying("Первый"), saying("После правки")], { storage });
    const chat = await built.service.createChat("anna");
    await send(built.service, chat.id, "u1");
    await storage.setChatClosed!(chat.id, CLOSURE);
    return { ...built, chatId: chat.id };
  }

  it("флаг без записи — чат закрыт; отправка — ChatClosedError", async () => {
    const { service, chatId } = await legacyClosedChat();
    expect((await service.getHistory("anna", chatId)).chat.closed).toEqual(CLOSURE);
    await expect(send(service, chatId, "u2")).rejects.toBeInstanceOf(ChatClosedError);
  });

  it("правка переносит флаг в запись на старой ветке: новая ветка открыта, старая закрыта", async () => {
    const { service, storage, chatId } = await legacyClosedChat();
    await readAll(await service.editMessage("anna", chatId, "u1", userMessage("u1-edit", "Иначе")));
    const messages = await storage.listMessages(chatId);
    const record = messages.find((message) => JSON.stringify(message.parts).includes("$closed"));
    expect(record).toMatchObject({ role: "user", parts: [{ type: "data-app-state", data: { set: { $closed: CLOSURE } } }] });
    expect((await service.getHistory("anna", chatId)).chat.closed).toBeUndefined();
    await service.selectBranch("anna", chatId, "u1");
    expect((await service.getHistory("anna", chatId)).chat.closed).toEqual(CLOSURE);
  });

  it("список чатов: закрыт по флагу, правка открывает, возврат на старую ветку снова закрывает", async () => {
    const { service, chatId } = await legacyClosedChat();
    const listed = async () => (await service.listChats("anna")).find((entry) => entry.id === chatId)!.closed;
    expect(await listed()).toEqual(CLOSURE);
    await readAll(await service.editMessage("anna", chatId, "u1", userMessage("u1-edit", "Иначе")));
    await service.flush();
    expect(await listed()).toBeUndefined();
    await service.selectBranch("anna", chatId, "u1");
    await service.flush();
    expect(await listed()).toEqual(CLOSURE);
    await expect(send(service, chatId, "u2")).rejects.toBeInstanceOf(ChatClosedError);
  });

  it("reopenChat открывает чат 0.27", async () => {
    const { service, chatId } = await legacyClosedChat();
    await service.reopenChat({ ownerId: "anna", chatId });
    expect((await service.getHistory("anna", chatId)).chat.closed).toBeUndefined();
  });
});

describe("служебное сообщение состояния и модель", () => {
  it("сообщение человека из одной записи состояния модели не уходит: запрос без пустых сообщений", async () => {
    const { service, storage, model } = setup([saying("Первый"), saying("Второй")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    // Чужая запись состояния в сообщении человека: модели не уходит.
    const last = (await storage.listMessages(chat.id)).at(-1)!;
    await storage.insertMessage(
      newStoredMessage({ id: "s1", chatId: chat.id, parentId: last.id, role: "user", parts: [{ type: "data-app-state", data: { set: { "fields.a": 1 } } }] as never }),
    );
    await send(service, chat.id, "u2", "Ещё");
    const prompt = model.doStreamCalls[1]!.prompt.filter((message) => message.role !== "system");
    expect(prompt.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(prompt.every((message) => typeof message.content === "string" || message.content.length > 0)).toBe(true);
    expect(textsOf(prompt.at(-1)).join("")).toContain("Ещё");
  });
});
