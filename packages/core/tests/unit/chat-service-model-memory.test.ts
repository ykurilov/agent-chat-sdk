import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import { extendCatalog } from "../../src/models/catalog-changes";
import type { ModelCatalog, ModelProfile, ProviderDescription } from "../../src/models/model-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "./support/mock-model";

const leveledModel: ModelProfile = {
  id: "leveled",
  displayName: "Leveled",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true, levels: ["low", "high"], defaultLevel: "low" },
  providerModelIds: { acme: "leveled-v1" },
};

const acme: ProviderDescription = {
  id: "acme",
  displayName: "Acme",
  apiKeyEnv: "ACME_KEY",
  createLanguageModel: () => mockModel(() => streamOf(reasoningAndTextParts(["Ответ acme"]))),
  requestOptions: () => ({}),
  reasoningRequest: (level) => ({ providerOptions: { acme: { level } } }),
};

function fullCatalog(): ModelCatalog {
  return extendCatalog(mockCatalog({ mock: mockModel(() => streamOf(reasoningAndTextParts(["Ответ"]))) }), {
    addModels: [leveledModel],
    addProviders: [acme],
  });
}

const env = { ...mockEnv, ACME_KEY: "k" };
const appDefault = { modelId: mockModelId, providerId: "mock" };

function setup(options: Partial<ChatServiceOptions> = {}) {
  const storage = options.storage ?? createInMemoryChatStorage();
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog: fullCatalog(),
    agent: { instructions: "Ты помощник." },
    env,
    defaultChoice: appDefault,
    logError,
    ...options,
  });
  return { service, storage, logError };
}

/** Хранилище старого образца: без методов запомненного выбора. */
function storageWithoutChoiceMemory(): ChatStorage {
  const { getUserModelChoice: _get, saveUserModelChoice: _save, ...rest } = createInMemoryChatStorage();
  return rest;
}

describe("служба чата: запомненный выбор человека", () => {
  it("новый чат берёт последний выбор человека: модель, провайдер и уровень", async () => {
    const { service } = setup();
    const first = await service.createChat("anna");
    await service.setModel("anna", first.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });

    const second = await service.createChat("anna");
    expect(second).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "high" });
  });

  it("выбор остаётся в хранилище: новая служба на той же базе (перезапуск сервера) тоже его берёт", async () => {
    const storage = createInMemoryChatStorage();
    const before = setup({ storage });
    const chat = await before.service.createChat("anna");
    await before.service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });

    const after = setup({ storage });
    expect(await after.service.createChat("anna")).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "high" });
  });

  it("выбор без уровня рассуждений запоминается без уровня", async () => {
    const { service } = setup({ defaultChoice: { modelId: "leveled", providerId: "acme" } });
    const chat = await service.createChat("anna");
    await service.setModel("anna", chat.id, appDefault);
    const next = await service.createChat("anna");
    expect(next).toMatchObject(appDefault);
    expect(next.reasoning).toBeUndefined();
  });

  it("последний выбор побеждает: запоминается тот, что сделан позже", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });
    await service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "low" });
    expect(await service.createChat("anna")).toMatchObject({ modelId: "leveled", reasoning: "low" });
  });

  it("человек ничего не выбирал: новый чат — на выборе по умолчанию из настроек", async () => {
    const { service } = setup({ defaultChoice: { modelId: "leveled", providerId: "acme" } });
    expect(await service.createChat("anna")).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "low" });
  });

  it("недопустимый выбор ничего не запоминает", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await expect(service.setModel("anna", chat.id, { modelId: "нет-такой", providerId: "mock" })).rejects.toThrow();
    expect(await service.createChat("anna")).toMatchObject(appDefault);
  });

  it("выбор в чужом чате ничего не запоминает", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await expect(service.setModel("boris", chat.id, { modelId: "leveled", providerId: "acme" })).rejects.toThrow();
    expect(await service.createChat("boris")).toMatchObject(appDefault);
  });

  it("выбор одного человека другой не видит", async () => {
    const { service } = setup();
    const annasChat = await service.createChat("anna");
    await service.setModel("anna", annasChat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });

    expect(await service.createChat("boris")).toMatchObject(appDefault);
    const borisChat = await service.createChat("boris");
    await service.setModel("boris", borisChat.id, { modelId: mockModelId, providerId: "mock" });
    expect(await service.createChat("anna")).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "high" });
  });

  it("старые чаты хранят свой выбор: новый выбор их не трогает", async () => {
    const { service, storage } = setup();
    const older = await service.createChat("anna");
    await storage.insertMessage(newStoredMessage({ id: "m1", chatId: older.id, parentId: null, role: "user", parts: [{ type: "text", text: "Привет" }] }));
    const newer = await service.createChat("anna");
    await service.setModel("anna", newer.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });

    expect(await storage.getChat(older.id)).toMatchObject(appDefault);
    expect((await service.getHistory("anna", older.id)).chat).toMatchObject(appDefault);
  });

  it("запомненная модель исчезла из каталога: новый чат — на выборе по умолчанию", async () => {
    const storage = createInMemoryChatStorage();
    const before = setup({ storage });
    const chat = await before.service.createChat("anna");
    await before.service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });

    const after = setup({ storage, catalog: mockCatalog({ mock: mockModel(() => streamOf(reasoningAndTextParts(["Ответ"]))) }) });
    expect(await after.service.createChat("anna")).toMatchObject(appDefault);
  });

  it("у запомненного провайдера пропал ключ: новый чат — на выборе по умолчанию, а с ключом снова на запомненном", async () => {
    const changing: Record<string, string> = { ...env };
    const { service } = setup({ env: changing });
    const chat = await service.createChat("anna");
    await service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });

    delete changing.ACME_KEY;
    expect(await service.createChat("anna")).toMatchObject(appDefault);
    changing.ACME_KEY = "k";
    expect(await service.createChat("anna")).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "high" });
  });

  it("у модели убрали запомненный уровень: та же модель на своём уровне по умолчанию", async () => {
    const storage = createInMemoryChatStorage();
    await storage.saveUserModelChoice?.("anna", { modelId: "leveled", providerId: "acme", reasoning: "extreme" });
    const { service } = setup({ storage });
    expect(await service.createChat("anna")).toMatchObject({ modelId: "leveled", providerId: "acme", reasoning: "low" });
  });

  it("у модели уровней не стало совсем: запомненный уровень отбрасывается", async () => {
    const storage = createInMemoryChatStorage();
    await storage.saveUserModelChoice?.("anna", { ...appDefault, reasoning: "high" });
    const { service } = setup({ storage });
    const chat = await service.createChat("anna");
    expect(chat).toMatchObject(appDefault);
    expect(chat.reasoning).toBeUndefined();
  });

  it("хранилище без методов запомненного выбора: поведение прежнее, смена модели работает", async () => {
    const { service, storage, logError } = setup({ storage: storageWithoutChoiceMemory() });
    const chat = await service.createChat("anna");
    await expect(service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" })).resolves.toMatchObject({
      modelId: "leveled",
    });
    expect(await storage.getChat(chat.id)).toMatchObject({ modelId: "leveled", providerId: "acme" });
    expect(await service.createChat("anna")).toMatchObject(appDefault);
    expect(logError).not.toHaveBeenCalled();
  });

  it("не удалось записать выбор: смена модели в чате всё равно проходит, сбой — в журнале", async () => {
    const storage = createInMemoryChatStorage();
    storage.saveUserModelChoice = async () => {
      throw new Error("диск полон");
    };
    const { service, logError } = setup({ storage });
    const chat = await service.createChat("anna");
    await expect(service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" })).resolves.toMatchObject({
      reasoning: "high",
    });
    expect((await service.getHistory("anna", chat.id)).chat).toMatchObject({ modelId: "leveled", providerId: "acme" });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("диск полон"));
  });

  it("не удалось прочитать выбор: чат создаётся на выборе по умолчанию, сбой — в журнале", async () => {
    const storage = createInMemoryChatStorage();
    storage.getUserModelChoice = async () => {
      throw new Error("база недоступна");
    };
    const { service, logError } = setup({ storage });
    expect(await service.createChat("anna")).toMatchObject(appDefault);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });

  it("меню моделей по-прежнему отдаёт выбор по умолчанию из настроек, а не запомненный", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await service.setModel("anna", chat.id, { modelId: "leveled", providerId: "acme", reasoning: "high" });
    expect((await service.getModelMenu()).defaultChoice).toEqual({ ...appDefault, reasoning: null });
  });
});

describe("служба чата: пустой чат, открытый как новый, берёт запомненный выбор", () => {
  const leveledHigh = { modelId: "leveled", providerId: "acme", reasoning: "high" };

  it("пустой чат на модели А; выбор сменили в другом чате на Б; при открытии пустой чат стал на Б и записал это у себя", async () => {
    const { service, storage } = setup();
    const empty = await service.createChat("anna");
    const other = await service.createChat("anna");
    await service.setModel("anna", other.id, leveledHigh);

    expect((await service.getHistory("anna", empty.id)).chat).toMatchObject(leveledHigh);
    // Записано в чате: ответ пойдёт от той же пары, что показана.
    expect(await storage.getChat(empty.id)).toMatchObject(leveledHigh);
  });

  it("чат с сообщениями при открытии не меняется, даже если запомненный выбор другой", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    await storage.insertMessage(newStoredMessage({ id: "m1", chatId: chat.id, parentId: null, role: "user", parts: [{ type: "text", text: "Привет" }] }));
    const other = await service.createChat("anna");
    await service.setModel("anna", other.id, leveledHigh);

    expect((await service.getHistory("anna", chat.id)).chat).toMatchObject(appDefault);
    expect(await storage.getChat(chat.id)).toMatchObject(appDefault);
  });

  it("выбор, сделанный в самом пустом чате до отправки, остаётся: он и есть последний", async () => {
    const { service } = setup();
    const empty = await service.createChat("anna");
    await service.setModel("anna", empty.id, leveledHigh);
    expect((await service.getHistory("anna", empty.id)).chat).toMatchObject(leveledHigh);
  });

  it("человек ничего не выбирал: пустой чат остаётся как был", async () => {
    const { service, storage } = setup();
    const empty = await service.createChat("anna");
    await service.getHistory("anna", empty.id);
    expect(await storage.getChat(empty.id)).toMatchObject(appDefault);
  });

  it("запомненная модель исчезла из каталога: пустой чат не трогаем", async () => {
    const storage = createInMemoryChatStorage();
    const before = setup({ storage });
    const empty = await before.service.createChat("anna");
    const other = await before.service.createChat("anna");
    await before.service.setModel("anna", other.id, leveledHigh);

    const after = setup({ storage, catalog: mockCatalog({ mock: mockModel(() => streamOf(reasoningAndTextParts(["Ответ"]))) }) });
    expect((await after.service.getHistory("anna", empty.id)).chat).toMatchObject(appDefault);
    expect(await storage.getChat(empty.id)).toMatchObject(appDefault);
  });

  it("чужой выбор пустой чат не меняет", async () => {
    const { service } = setup();
    const empty = await service.createChat("anna");
    const borisChat = await service.createChat("boris");
    await service.setModel("boris", borisChat.id, leveledHigh);
    expect((await service.getHistory("anna", empty.id)).chat).toMatchObject(appDefault);
  });

  it("хранилище без запомненного выбора: пустой чат остаётся как был", async () => {
    const { service } = setup({ storage: storageWithoutChoiceMemory() });
    const empty = await service.createChat("anna");
    const other = await service.createChat("anna");
    await service.setModel("anna", other.id, leveledHigh);
    expect((await service.getHistory("anna", empty.id)).chat).toMatchObject(appDefault);
  });

  it("не удалось прочитать выбор: чат открывается как был, сбой — в журнале", async () => {
    const base = createInMemoryChatStorage();
    const storage: ChatStorage = { ...base, getUserModelChoice: async () => { throw new Error("база недоступна"); } };
    const { service, logError } = setup({ storage });
    const empty = await service.createChat("anna");
    expect((await service.getHistory("anna", empty.id)).chat).toMatchObject(appDefault);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });
});
