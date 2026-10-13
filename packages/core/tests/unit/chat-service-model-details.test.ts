import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { ActionForbiddenError, resolveChatCapabilities } from "../../src/index";
import type { AgentChatMessage, ChatCapabilities } from "../../src/index";
import type { ChatServiceOptions } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { StoredMessage } from "../../src/conversation/types";
import { controlledModel, finishPart, mockModelId, readAll, streamStart } from "./support/mock-model";
import { noticeService, scriptedModel, userMessage } from "./support/notice-chat";

/** Ответ с метаданными поставщика у текста: так OpenRouter везёт провайдера маршрута и расход. */
const PROVIDER_METADATA = { openrouter: { provider: "Anthropic", usage: { cost: 0.002 } } };
const answerWithProviderMetadata: LanguageModelV4StreamPart[] = [
  streamStart,
  { type: "text-start", id: "t0", providerMetadata: PROVIDER_METADATA },
  { type: "text-delta", id: "t0", delta: "Готово", providerMetadata: PROVIDER_METADATA },
  { type: "text-end", id: "t0", providerMetadata: PROVIDER_METADATA },
  finishPart(),
];

const HIDDEN: Partial<ChatCapabilities> = { modelDetails: false };

function setup(given: Partial<ChatCapabilities> | undefined, extra: Partial<ChatServiceOptions> = {}, scripts = [answerWithProviderMetadata, answerWithProviderMetadata]) {
  const rights = { value: given ?? {} };
  const { service, storage } = noticeService(scriptedModel(scripts), {
    ...(given && { chatCapabilities: () => rights.value }),
    ...extra,
  });
  return { service, storage, rights };
}

const MODEL_KEYS = ["modelId", "providerId", "usage"] as const;

function expectNoModelInChunks(chunks: UIMessageChunk[]) {
  for (const chunk of chunks) {
    const metadata = (chunk as { messageMetadata?: Record<string, unknown> }).messageMetadata;
    for (const key of MODEL_KEYS) expect(metadata ?? {}).not.toHaveProperty(key);
    expect(chunk).not.toHaveProperty("providerMetadata");
  }
  expect(JSON.stringify(chunks)).not.toContain(mockModelId);
  expect(JSON.stringify(chunks)).not.toContain("Anthropic");
  expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "Готово")).toBe(true);
}

function expectNoModelInMessages(messages: AgentChatMessage[]) {
  for (const message of messages) {
    for (const key of MODEL_KEYS) expect(message.metadata ?? {}).not.toHaveProperty(key);
    for (const part of message.parts) {
      expect(part).not.toHaveProperty("providerMetadata");
      expect(part).not.toHaveProperty("callProviderMetadata");
      expect(part).not.toHaveProperty("resultProviderMetadata");
    }
  }
  expect(JSON.stringify(messages)).not.toContain(mockModelId);
  expect(JSON.stringify(messages)).not.toContain("Anthropic");
}

describe("право modelDetails: модель, провайдер и расход не уходят зрителю", () => {
  it("по умолчанию всё как раньше: модель в потоке, истории и у чата", async () => {
    const { service } = setup(undefined);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    expect(chunks.find((chunk) => chunk.type === "start")).toMatchObject({ messageMetadata: { modelId: mockModelId, providerId: "mock" } });
    expect(chunks.some((chunk) => "providerMetadata" in chunk)).toBe(true);
    const history = await service.getHistory("anna", chat.id);
    expect(history.chat).toMatchObject({ ownerId: "anna", modelId: mockModelId, providerId: "mock" });
    expect(history.messages.at(-1)?.metadata).toMatchObject({ modelId: mockModelId, usage: expect.any(Object) });
    expect(history.capabilities.modelDetails).toBe(true);
    expect(history.modelAcceptsImages).toBe(false);
  });

  it("запрет: поток без модели, провайдера, расхода и метаданных поставщика", async () => {
    const { service } = setup(HIDDEN);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    expectNoModelInChunks(chunks);
    // Итог ответа экрану нужен.
    expect(chunks.some((chunk) => chunk.type === "message-metadata" && (chunk.messageMetadata as { status?: string }).status === "complete")).toBe(true);
  });

  it("запрет: история без выбора чата, владельца, модели у сообщений; хранилище держит всё", async () => {
    const { service, storage } = setup(HIDDEN);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    for (const history of [await service.getHistory("anna", chat.id), await service.peekHistory("anna", chat.id)]) {
      for (const key of ["ownerId", "modelId", "providerId", "reasoning"]) expect(history.chat).not.toHaveProperty(key);
      expectNoModelInMessages(history.messages);
      // Экрану — только видит ли модель картинки (для предупреждения у вложений).
      expect(history.modelAcceptsImages).toBe(false);
      expect(history.capabilities).toMatchObject({ modelDetails: false, modelChoice: false });
    }
    const stored = (await storage.listMessages(chat.id)).at(-1)!;
    expect(stored.modelId).toBe(mockModelId);
    expect(stored.usage).not.toBeNull();
  });

  it("переподключение посреди хода: повтор прошлых кусков и новые — без модели", async () => {
    const live = controlledModel();
    const { service } = noticeService(live.model, { chatCapabilities: () => HIDDEN });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    await live.opened;
    live.push(...answerWithProviderMetadata.slice(0, 3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const resumed = await service.subscribe("anna", chat.id);
    live.push(...answerWithProviderMetadata.slice(3));
    live.end();
    expectNoModelInChunks(await readAll(resumed!));
    expectNoModelInChunks(await reading);
  });

  it("смена ветки отдаёт историю без модели", async () => {
    const { service } = setup(HIDDEN);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    const first = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expectNoModelInChunks(await readAll(await service.regenerate("anna", chat.id, first.id)));
    const switched = await service.selectBranch("anna", chat.id, first.id);
    for (const key of ["ownerId", "modelId", "providerId"]) expect(switched.chat).not.toHaveProperty(key);
    expectNoModelInMessages(switched.messages);
  });

  it("история: у части инструмента поставщика нет resultProviderMetadata (провайдер маршрута)", async () => {
    const { service, storage } = setup(HIDDEN);
    const chat = await service.createChat("anna");
    await storage.insertMessage(newStoredMessage({ id: "u1", chatId: chat.id, parentId: null, role: "user", parts: [{ type: "text", text: "Найди" }] }));
    await storage.insertMessage(
      newStoredMessage({
        id: "a1",
        chatId: chat.id,
        parentId: "u1",
        role: "assistant",
        parts: [
          { type: "tool-web_search", toolCallId: "c1", state: "output-available", input: {}, output: "ок", providerExecuted: true, resultProviderMetadata: PROVIDER_METADATA },
        ] as StoredMessage["parts"],
      }),
    );
    expectNoModelInMessages((await service.getHistory("anna", chat.id)).messages);
  });

  it("запрет modelDetails выключает выбор модели: смена человеком — отказ modelChoice; приложение может", async () => {
    const { service } = setup(HIDDEN);
    const chat = await service.createChat("anna");
    await expect(service.setModel("anna", chat.id, { modelId: mockModelId, providerId: "mock-backup" })).rejects.toMatchObject({
      name: "ActionForbiddenError",
      action: "modelChoice",
    });
    await expect(service.setModel("anna", chat.id, { modelId: mockModelId, providerId: "mock-backup" }, { by: "app" })).resolves.toMatchObject({
      providerId: "mock-backup",
    });
  });

  it("меню моделей: modelMenu решает по человеку; без опции — всем", async () => {
    const open = setup(undefined);
    await expect(open.service.getModelMenu("anna")).resolves.toHaveProperty("defaultChoice");
    const { service } = setup(undefined, { modelMenu: ({ userId }) => userId !== "visitor" });
    await expect(service.getModelMenu("anna")).resolves.toHaveProperty("defaultChoice");
    const refused = service.getModelMenu("visitor");
    await expect(refused).rejects.toBeInstanceOf(ActionForbiddenError);
    await expect(refused).rejects.toMatchObject({ action: "modelDetails" });
  });

  it("права: modelDetails по умолчанию true; false выключает modelChoice", () => {
    expect(resolveChatCapabilities(undefined).modelDetails).toBe(true);
    expect(resolveChatCapabilities({ modelDetails: false })).toMatchObject({ modelDetails: false, modelChoice: false });
    expect(resolveChatCapabilities({ modelChoice: false })).toMatchObject({ modelDetails: true, modelChoice: false });
  });
});

