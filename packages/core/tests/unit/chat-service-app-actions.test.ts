import { describe, expect, it, vi } from "vitest";
import { ActionForbiddenError, ChatNotFoundError, InvalidMessageError } from "../../src/index";
import type { ChatService, ModelChosenHandler } from "../../src/index";
import { readAll } from "./support/mock-model";
import { noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

/*
 * Действия сервера приложения (`{ by: "app" }`) не проверяют права экрана: они для людей через HTTP. Выбор модели
 * человеком сообщается хуком `onModelChosen`. «Переделать» — только ответ на сообщение человека.
 */

const forbidden = (action: string) => ({ name: ActionForbiddenError.name, action });

function setup(extra: Parameters<typeof noticeService>[1] = {}, scripts: Parameters<typeof scriptedModel>[0] = []) {
  const model = scriptedModel(scripts);
  const logError = vi.fn();
  const { service, storage } = noticeService(model, { logError, ...extra });
  return { model, service, storage, logError };
}

async function answered(service: ChatService, chatId: string) {
  await readAll(await service.sendMessage("anna", chatId, userMessage("u1", "Привет")));
}

describe("служба чата: удаление чата сервером приложения", () => {
  it("без права chatList человек удалить не может, а сервер приложения с { by: 'app' } — может", async () => {
    const { service, storage } = setup({ chatCapabilities: () => ({ chatList: false }) });
    const chat = await service.createChat("anna");
    await expect(service.deleteChat("anna", chat.id)).rejects.toMatchObject(forbidden("chatList"));
    expect(await storage.getChat(chat.id)).toBeDefined();

    await service.deleteChat("anna", chat.id, { by: "app" });
    expect(await storage.getChat(chat.id)).toBeNull();
  });

  it("{ by: 'app' } не снимает проверку владения: чужой чат — ChatNotFoundError", async () => {
    const { service, storage } = setup({ chatCapabilities: () => ({ chatList: false }) });
    const chat = await service.createChat("anna");
    await expect(service.deleteChat("boris", chat.id, { by: "app" })).rejects.toBeInstanceOf(ChatNotFoundError);
    expect(await storage.getChat(chat.id)).toBeDefined();
  });
});

describe("служба чата: выбор модели человеком", () => {
  it("setModel человека зовёт onModelChosen с сохранённым выбором", async () => {
    const onModelChosen = vi.fn<ModelChosenHandler>();
    const { service } = setup({ onModelChosen });
    const chat = await service.createChat("anna");
    const { chat: shown } = await service.getHistory("anna", chat.id);
    const saved = await service.setModel("anna", chat.id, { modelId: shown.modelId, providerId: shown.providerId });
    expect(onModelChosen).toHaveBeenCalledTimes(1);
    expect(onModelChosen).toHaveBeenCalledWith({ userId: "anna", chatId: chat.id, choice: saved });
  });

  it("setModel с { by: 'app' }: без права modelChoice, без хука и без запоминания как выбора человека", async () => {
    const onModelChosen = vi.fn<ModelChosenHandler>();
    const { service, storage } = setup({ onModelChosen, chatCapabilities: () => ({ modelChoice: false }) });
    const chat = await service.createChat("anna");
    const { chat: shown } = await service.getHistory("anna", chat.id);
    const choice = { modelId: shown.modelId, providerId: shown.providerId };
    await expect(service.setModel("anna", chat.id, choice)).rejects.toMatchObject(forbidden("modelChoice"));

    await service.setModel("anna", chat.id, choice, { by: "app" });
    expect(onModelChosen).not.toHaveBeenCalled();
    expect(await storage.getUserModelChoice?.("anna")).toBeNull();
  });

  it("сбой хука — в журнал, выбор сохранён", async () => {
    const { service, storage, logError } = setup({ onModelChosen: () => Promise.reject(new Error("база приложения легла")) });
    const chat = await service.createChat("anna");
    const { chat: shown } = await service.getHistory("anna", chat.id);
    await service.setModel("anna", chat.id, { modelId: shown.modelId, providerId: shown.providerId });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база приложения легла"));
    expect(await storage.getUserModelChoice?.("anna")).toMatchObject({ modelId: shown.modelId });
  });
});

describe("служба чата: «Переделать» у ответа без сообщения человека", () => {
  it("приветствие текстом переделать нельзя: InvalidMessageError, ничего не записано", async () => {
    const { service, storage, model } = setup();
    const chat = await service.createChat("anna", { greeting: { text: "Здравствуйте! Чем помочь?" } });
    const [greeting] = await storage.listMessages(chat.id);
    await expect(service.regenerate("anna", chat.id, greeting!.id)).rejects.toBeInstanceOf(InvalidMessageError);
    expect(await storage.listMessages(chat.id)).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("приветствие по указанию (агент пишет первым) переделать нельзя", async () => {
    const { service, storage, model } = setup({}, [saying("Добрый день! Я помогу заполнить заявку.")]);
    const chat = await service.createChat("anna", { greeting: { instruction: "Поздоровайся и предложи помощь." } });
    await vi.waitFor(async () => expect((await storage.listMessages(chat.id)).at(-1)).toMatchObject({ role: "assistant", status: "complete" }));
    const greeting = (await storage.listMessages(chat.id)).at(-1)!;
    const calls = model.doStreamCalls.length;
    await expect(service.regenerate("anna", chat.id, greeting.id)).rejects.toThrow(/сообщение человека/);
    expect(model.doStreamCalls).toHaveLength(calls);
  });

  it("ответ на вопрос человека переделывается, как раньше", async () => {
    const { service } = setup({}, [saying("Первый"), saying("Второй")]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answerId = (await service.getHistory("anna", chat.id)).messages.at(-1)!.id;
    await readAll(await service.regenerate("anna", chat.id, answerId));
    expect((await service.getHistory("anna", chat.id)).messages.at(-1)).toMatchObject({ role: "assistant" });
    expect((await service.getHistory("anna", chat.id)).messages.at(-1)!.id).not.toBe(answerId);
  });
});
