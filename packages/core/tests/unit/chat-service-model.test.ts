import { describe, expect, it, vi } from "vitest";
import { ChatNotFoundError, InvalidModelChoiceError, createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { extendCatalog } from "../../src/models/catalog-changes";
import type { ModelProfile, ProviderDescription } from "../../src/models/model-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

/** Модель с уровнями рассуждений и провайдер, который кладёт уровень в providerOptions.acme. */
const leveledModel: ModelProfile = {
  id: "leveled",
  displayName: "Leveled",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true, levels: ["low", "high"], defaultLevel: "low" },
  providerModelIds: { acme: "leveled-v1" },
};

function setup(options: Partial<ChatServiceOptions> = {}) {
  const answering = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"], "думает первая")));
  const backup = mockModel(() => streamOf(reasoningAndTextParts(["Ответ запасного"], "думает запасная")));
  const acmeModel = mockModel(() => streamOf(reasoningAndTextParts(["Ответ acme"])));
  const acme: ProviderDescription = {
    id: "acme",
    displayName: "Acme",
    apiKeyEnv: "ACME_KEY",
    createLanguageModel: () => acmeModel,
    requestOptions: () => ({}),
    reasoningRequest: (level) => ({ providerOptions: { acme: { level } } }),
  };
  const catalog = extendCatalog(mockCatalog({ mock: answering, "mock-backup": backup }), {
    addModels: [leveledModel],
    addProviders: [acme],
  });
  const storage = createInMemoryChatStorage();
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog,
    agent: { instructions: "Ты помощник." },
    env: { ...mockEnv, ACME_KEY: "k" },
    logError,
    ...options,
  });
  return { service, storage, logError, acmeModel, answering, backup };
}

const answersOf = async (storage: ReturnType<typeof setup>["storage"], chatId: string) =>
  (await storage.listMessages(chatId)).filter((message) => message.role === "assistant");

describe("служба чата: выбор модели", () => {
  it("новый чат получает выбор по умолчанию из настроек, уровень — по умолчанию модели", async () => {
    const { service, storage } = setup({ defaultChoice: { modelId: "leveled", providerId: "acme" } });
    const chat = await service.createChat("anna");
    expect(await storage.getChat(chat.id)).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "low" });
  });

  it("выбор по умолчанию не задан: первая модель каталога у провайдера с ключом", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    expect(chat).toMatchObject({ modelId: mockModelId, providerId: "mock" });
  });

  it("выбор по умолчанию не подходит: запись в журнал и первая доступная модель", async () => {
    const { service, logError } = setup({ defaultChoice: { modelId: "нет-такой", providerId: "acme" } });
    const chat = await service.createChat("anna");
    expect(chat).toMatchObject({ modelId: mockModelId, providerId: "mock" });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("нет-такой"));
  });

  it("setModel записывает выбор в чат; следующий ответ идёт от новой модели и подписан ею", async () => {
    const { service, storage } = setup({ defaultChoice: { modelId: mockModelId, providerId: "mock" } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Раз")));
    const saved = await service.setModel("anna", chat.id, { modelId: mockModelId, providerId: "mock-backup" });
    expect(saved).toEqual({ modelId: mockModelId, providerId: "mock-backup" });
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Два")));

    const answers = await answersOf(storage, chat.id);
    expect(answers.map((answer) => answer.providerId)).toEqual(["mock", "mock-backup"]);
    expect(answers[1]?.parts.find((part) => part.type === "text")).toMatchObject({ text: "Ответ запасного" });
    expect((await service.getHistory("anna", chat.id)).chat.providerId).toBe("mock-backup");
  });

  it("выбранный уровень уходит в запрос модели; без уровня — уровень по умолчанию модели", async () => {
    const { service, acmeModel } = setup({ defaultChoice: { modelId: "leveled", providerId: "acme" } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Раз")));
    expect(await service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" })).toMatchObject({
      reasoning: "high",
    });
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Два")));

    const levels = acmeModel.doStreamCalls.map((call) => (call.providerOptions as { acme?: { level?: string } }).acme?.level);
    expect(levels).toEqual(["low", "high"]);
  });

  it("недопустимый выбор — InvalidModelChoiceError, в чате ничего не меняется", async () => {
    const { service, storage } = setup({ defaultChoice: { modelId: mockModelId, providerId: "mock" } });
    const chat = await service.createChat("anna");
    for (const choice of [
      { modelId: "нет-такой", providerId: "mock" },
      { modelId: mockModelId, providerId: "acme" },
      { modelId: "leveled", providerId: "acme", reasoning: "max" },
      { modelId: mockModelId, providerId: "mock", reasoning: "low" },
    ]) {
      await expect(service.setModel("anna", chat.id, choice)).rejects.toThrow(InvalidModelChoiceError);
    }
    expect(await storage.getChat(chat.id)).toMatchObject({ modelId: mockModelId, providerId: "mock" });
  });

  it("у провайдера нет ключа на сервере — выбор отклонён", async () => {
    const { service } = setup({ env: mockEnv });
    const chat = await service.createChat("anna");
    await expect(service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme" })).rejects.toThrow(
      InvalidModelChoiceError,
    );
  });

  it("чужой чат — ChatNotFoundError", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await expect(service.setModel("boris", chat.id, { modelId: mockModelId, providerId: "mock" })).rejects.toThrow(ChatNotFoundError);
  });

  it("сохранённый выбор недоступен: история и ответ идут на выборе по умолчанию, сообщения не меняются", async () => {
    const { service, storage } = setup({ defaultChoice: { modelId: mockModelId, providerId: "mock" } });
    await storage.createChat({ id: "old", ownerId: "anna", modelId: "убрана-из-каталога", providerId: "mock" });
    const history = await service.getHistory("anna", "old");
    expect(history.chat).toMatchObject({ modelId: mockModelId, providerId: "mock" });

    await readAll(await service.sendMessage("anna", "old", userMessage("u1", "Привет")));
    const [answer] = await answersOf(storage, "old");
    expect(answer).toMatchObject({ modelId: mockModelId, providerId: "mock" });
  });

  it("ключ выбранного провайдера пропал: ответ идёт на запасной модели, выбор пользователя в базе остаётся и возвращается вместе с ключом", async () => {
    const env: Record<string, string> = { ...mockEnv, ACME_KEY: "k" };
    const { service, storage, acmeModel } = setup({ env, defaultChoice: { modelId: mockModelId, providerId: "mock" } });
    const chat = await service.createChat("anna");
    await service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });

    delete env.ACME_KEY;
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    expect(await storage.getChat(chat.id)).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "high" });
    expect(acmeModel.doStreamCalls).toHaveLength(0);
    expect((await answersOf(storage, chat.id))[0]).toMatchObject({ modelId: mockModelId, providerId: "mock" });

    env.ACME_KEY = "k";
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Ещё")));
    expect(acmeModel.doStreamCalls).toHaveLength(1);
    expect((await answersOf(storage, chat.id))[1]).toMatchObject({ modelId: "leveled", providerId: "acme" });
  });

  it("getModelMenu: провайдеры с ключами, модели с уровнями и выбор по умолчанию; ключей в ответе нет", async () => {
    const { service } = setup({ defaultChoice: { modelId: "leveled", providerId: "acme" } });
    const menu = await service.getModelMenu();
    expect(menu.providers.map((provider) => provider.id)).toEqual(["mock", "mock-backup", "acme"]);
    expect(menu.providers.find((provider) => provider.id === "acme")?.models).toEqual([
      { id: "leveled", displayName: "Leveled", acceptsImages: false, reasoning: { levels: ["low", "high"], defaultLevel: "low" } },
    ]);
    expect(menu.defaultChoice).toEqual({ modelId: "leveled", providerId: "acme", reasoning: "low" });
    expect(JSON.stringify(menu)).not.toMatch(/не-настоящий-ключ|ACME_KEY|MOCK_API_KEY/);
  });

  it("смена модели посреди чата: каждой модели в запрос уходят только её рассуждения, в базе остаются все", async () => {
    const { service, storage, answering, backup } = setup({ defaultChoice: { modelId: mockModelId, providerId: "mock" } });
    const chat = await service.createChat("anna");
    const ask = async (id: string) => readAll(await service.sendMessage("anna", chat.id, userMessage(id, `Вопрос ${id}`)));
    await ask("u1");
    await service.setModel("anna", chat.id, { modelId: mockModelId, providerId: "mock-backup" });
    await ask("u2");
    await service.setModel("anna", chat.id, { modelId: mockModelId, providerId: "mock" });
    await ask("u3");

    const reasoningInPrompt = (call: { prompt: unknown }) =>
      (call.prompt as Array<{ role: string; content: unknown }>)
        .filter((message) => message.role === "assistant" && Array.isArray(message.content))
        .flatMap((message) => (message.content as Array<{ type: string; text?: string }>).filter((part) => part.type === "reasoning"))
        .map((part) => part.text);
    // Запасная модель: первый ответ чужой, рассуждения не уходят. Первая модель в третьем ходе: своё есть, чужого нет.
    expect(backup.doStreamCalls.map(reasoningInPrompt)).toEqual([[]]);
    expect(answering.doStreamCalls.map(reasoningInPrompt)).toEqual([[], ["думает первая"]]);

    const stored = await answersOf(storage, chat.id);
    expect(stored.map((answer) => answer.parts.find((part) => part.type === "reasoning"))).toEqual([
      expect.objectContaining({ text: "думает первая" }),
      expect.objectContaining({ text: "думает запасная" }),
      expect.objectContaining({ text: "думает первая" }),
    ]);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.filter((message) => message.role === "assistant").every((message) => message.parts.some((part) => part.type === "reasoning"))).toBe(true);
  });
});
