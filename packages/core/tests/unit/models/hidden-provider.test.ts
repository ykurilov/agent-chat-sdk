import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidModelChoiceError, createChatService } from "../../../src/chat-service";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelCatalog, ProviderDescription } from "../../../src/models/model-catalog";
import { createModelCatalog } from "../../../src/models/model-catalog";
import { createDeepSeekProvider } from "../../../src/models/providers/deepseek";
import { createFireworksProvider } from "../../../src/models/providers/fireworks";
import { createOpenRouterProvider } from "../../../src/models/providers/openrouter";
import { createTogetherProvider } from "../../../src/models/providers/together";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const answering = (text: string) => mockModel(() => streamOf([streamStart, ...textParts([text]), finishPart()]));
const failing = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({ message: "503", url: "https://x.test", requestBodyValues: {}, statusCode: 503, responseBody: "занято", responseHeaders: { "retry-after-ms": "1" } });
    },
  });

/** Каталог заглушек, где провайдер `hiddenId` скрыт из меню. */
function catalogWithHidden(hiddenId: "mock" | "mock-backup", models: Parameters<typeof mockCatalog>[0]): ModelCatalog {
  const base = mockCatalog(models);
  return extendCatalog(base, {
    addProviders: base.providers.filter((provider) => provider.id === hiddenId).map((provider) => ({ ...provider, hiddenFromMenu: true })),
  });
}

function service(catalog: ModelCatalog, extra: Partial<Parameters<typeof createChatService>[0]> = {}) {
  const storage = createInMemoryChatStorage();
  return {
    storage,
    service: createChatService({ storage, catalog, agent: { instructions: "Ты помощник." }, env: mockEnv, logError: () => {}, ...extra }),
  };
}

describe("скрытый провайдер: флаг hiddenFromMenu", () => {
  it("все фабрики провайдеров принимают флаг и кладут его в описание; без него поля нет", () => {
    for (const create of [createOpenRouterProvider, createDeepSeekProvider, createFireworksProvider, createTogetherProvider]) {
      expect(create({ hiddenFromMenu: true }).hiddenFromMenu).toBe(true);
      expect(create({ hiddenFromMenu: false }).hiddenFromMenu).toBeUndefined();
      expect(create().hiddenFromMenu).toBeUndefined();
    }
  });

  it("флаг проверяется при сборке каталога: не boolean — ошибка с именем провайдера", () => {
    const base = standardCatalog.providers[0]!;
    const broken = { ...base, id: "my-one", hiddenFromMenu: "да" } as unknown as ProviderDescription;
    expect(() => extendCatalog(standardCatalog, { addProviders: [broken] })).toThrow(/my-one: hiddenFromMenu/);
    expect(() => createOpenRouterProvider({ hiddenFromMenu: "да" as never })).toThrow(/OpenRouter: hiddenFromMenu/);
    expect(() => createModelCatalog({ models: [], providers: [broken] })).toThrow(/my-one: hiddenFromMenu/);
  });

  it("подключение через прокси (connectProviders) флаг не теряет", () => {
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [createOpenRouterProvider({ hiddenFromMenu: true })],
      connectProviders: { openrouter: { baseURL: "https://proxy.test/openrouter/api/v1" } },
    });
    const openrouter = catalog.providers.find((provider) => provider.id === "openrouter")!;
    expect(openrouter.hiddenFromMenu).toBe(true);
    expect(openrouter.connection?.baseURL).toBe("https://proxy.test/openrouter/api/v1");
  });
});

describe("скрытый провайдер: меню и выбор", () => {
  it("getModelMenu: скрытого провайдера и его моделей нет", async () => {
    const { service: chat } = service(catalogWithHidden("mock-backup", { mock: answering("a"), "mock-backup": answering("b") }));
    const menu = await chat.getModelMenu();
    expect(menu.providers.map((provider) => provider.id)).toEqual(["mock"]);
  });

  it("setModel на скрытого — отказ ровно как на неизвестного, в чате ничего не меняется", async () => {
    const { service: chat, storage } = service(catalogWithHidden("mock-backup", { mock: answering("a"), "mock-backup": answering("b") }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
    });
    const created = await chat.createChat("anna");
    const hidden = await chat.setModel("anna", created.id, { modelId: mockModelId, providerId: "mock-backup" }).catch((error: unknown) => error);
    const unknown = await chat.setModel("anna", created.id, { modelId: mockModelId, providerId: "mock-nope" }).catch((error: unknown) => error);
    expect(hidden).toBeInstanceOf(InvalidModelChoiceError);
    expect((hidden as Error).message).toBe((unknown as Error).message.replace("mock-nope", "mock-backup"));
    expect(await storage.getChat(created.id)).toMatchObject({ providerId: "mock" });
  });

  it("defaultChoice на скрытого работает: новый чат идёт на нём, ответ приходит от него", async () => {
    const hiddenModel = answering("ответ скрытого");
    const { service: chat, storage } = service(catalogWithHidden("mock-backup", { mock: answering("a"), "mock-backup": hiddenModel }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock-backup" },
    });
    const created = await chat.createChat("anna");
    expect(await storage.getChat(created.id)).toMatchObject({ providerId: "mock-backup" });
    await readAll(await chat.sendMessage("anna", created.id, userMessage("u1", "Привет")));
    expect(hiddenModel.doStreamCalls).toHaveLength(1);
    expect((await chat.getModelMenu()).defaultChoice).toMatchObject({ providerId: "mock-backup" });
  });

  it("скрытый провайдер — запасной в providerFallback.byModel: при сбое основного ответ идёт от него", async () => {
    const backup = answering("ответ запасного");
    const { service: chat, storage } = service(catalogWithHidden("mock-backup", { mock: failing(), "mock-backup": backup }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", providerFallback: { byModel: { [mockModelId]: ["mock-backup"] } } },
    });
    const created = await chat.createChat("anna");
    await readAll(await chat.sendMessage("anna", created.id, userMessage("u1", "Привет")));
    expect(backup.doStreamCalls).toHaveLength(1);
    const answer = (await storage.listMessages(created.id)).find((message) => message.role === "assistant");
    expect(answer).toMatchObject({ providerId: "mock-backup" });
  });

  it("чат с сохранённым скрытым провайдером: как при выборе вне меню — ход идёт на выборе по умолчанию, выбор в базе остаётся", async () => {
    const main = answering("основной");
    const hiddenModel = answering("скрытый");
    const { service: chat, storage } = service(catalogWithHidden("mock-backup", { mock: main, "mock-backup": hiddenModel }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
    });
    await storage.createChat({ id: "old", ownerId: "anna", modelId: mockModelId, providerId: "mock-backup" });
    expect((await chat.getHistory("anna", "old")).chat).toMatchObject({ providerId: "mock" });
    await readAll(await chat.sendMessage("anna", "old", userMessage("u1", "Привет")));
    expect(main.doStreamCalls).toHaveLength(1);
    expect(hiddenModel.doStreamCalls).toHaveLength(0);
    expect(await storage.getChat("old")).toMatchObject({ providerId: "mock-backup" });
  });

  it("выбор по умолчанию не задан: первым берётся видимый провайдер, а не скрытый", async () => {
    const base = mockCatalog({ mock: answering("a"), "mock-backup": answering("b") });
    const catalog = extendCatalog(base, {
      removeProviders: ["mock"],
      addProviders: [{ ...base.providers.find((provider) => provider.id === "mock")!, hiddenFromMenu: true }],
    });
    const { service: chat } = service(catalog);
    const created = await chat.createChat("anna");
    expect(created).toMatchObject({ providerId: "mock-backup" });
  });
});

describe("скрытый провайдер: запасной по умолчанию и молчание", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("запасной по умолчанию (без byModel): при сбое основного ответ идёт от скрытого", async () => {
    const backup = answering("ответ запасного");
    const { service: chat, storage } = service(catalogWithHidden("mock-backup", { mock: failing(), "mock-backup": backup }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
    });
    const created = await chat.createChat("anna");
    await readAll(await chat.sendMessage("anna", created.id, userMessage("u1", "Привет")));
    expect(backup.doStreamCalls).toHaveLength(1);
    expect((await storage.listMessages(created.id)).find((message) => message.role === "assistant")).toMatchObject({ providerId: "mock-backup" });
  });

  it("молчание основного: шаг начинается заново у скрытого провайдера", async () => {
    vi.useFakeTimers();
    const silent = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue(streamStart);
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          },
        }),
      }),
    });
    const backup = answering("ответ запасного");
    const { service: chat, storage } = service(catalogWithHidden("mock-backup", { mock: silent, "mock-backup": backup }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", modelSilenceTimeout: { firstChunkMs: 1_000, betweenChunksMs: 1_000 }, providerFallback: { onSilence: "restart-step-on-next" } },
    });
    const created = await chat.createChat("anna");
    const reading = readAll(await chat.sendMessage("anna", created.id, userMessage("u1", "Привет")));
    await vi.advanceTimersByTimeAsync(1_000);
    await reading;
    expect(backup.doStreamCalls).toHaveLength(1);
    expect((await storage.listMessages(created.id)).find((message) => message.role === "assistant")).toMatchObject({ providerId: "mock-backup" });
  });
});

describe("скрытый провайдер: одно правило «скрытый выбор в чате = выбор по умолчанию»", () => {
  const hiddenChoice = { modelId: mockModelId, providerId: "mock-backup" };
  const hiddenCatalog = () => catalogWithHidden("mock-backup", { mock: answering("a"), "mock-backup": answering("b") });
  const text = (value: string) => ({ type: "text" as const, text: value });

  it("importChat с моделью скрытого провайдера не падает: чат на выборе по умолчанию", async () => {
    const { service: chat, storage } = service(hiddenCatalog(), { defaultChoice: { modelId: mockModelId, providerId: "mock" } });
    const { chatId } = await chat.importChat({
      ownerId: "anna",
      chat: { model: hiddenChoice },
      messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [text("Привет")] }],
    });
    expect(await storage.getChat(chatId)).toMatchObject({ modelId: mockModelId, providerId: "mock" });
  });

  it("importChat с неизвестным провайдером по-прежнему отказывает", async () => {
    const { service: chat } = service(hiddenCatalog());
    await expect(
      chat.importChat({ ownerId: "anna", chat: { model: { modelId: mockModelId, providerId: "нет" } }, messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [text("Привет")] }] }),
    ).rejects.toThrow(InvalidModelChoiceError);
  });

  it("openSubjectChat: запомненный человеком скрытый выбор не попадает в новый чат — выбор по умолчанию", async () => {
    const { service: chat, storage } = service(hiddenCatalog(), { defaultChoice: { modelId: mockModelId, providerId: "mock" } });
    await storage.saveUserModelChoice!("anna", hiddenChoice);
    const { chat: opened } = await chat.openSubjectChat({ ownerId: "anna", key: "lesson:1" });
    expect(await storage.getChat(opened.id)).toMatchObject({ modelId: mockModelId, providerId: "mock" });
  });
});

describe("скрытый провайдер: выбор по умолчанию в меню", () => {
  it("defaultChoice скрытого остаётся в меню и несёт названия и уровни, чтобы экран показал текущую модель", async () => {
    const { service: chat } = service(catalogWithHidden("mock-backup", { mock: answering("a"), "mock-backup": answering("b") }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock-backup" },
    });
    const menu = await chat.getModelMenu();
    expect(menu.providers.map((provider) => provider.id)).toEqual(["mock"]);
    expect(menu.defaultChoice).toEqual({
      modelId: mockModelId,
      providerId: "mock-backup",
      reasoning: null,
      details: { providerName: "mock-backup", modelName: "Mock Model", acceptsImages: false, reasoning: { levels: [], defaultLevel: null } },
    });
  });

  it("defaultChoice видимого провайдера — без details", async () => {
    const { service: chat } = service(catalogWithHidden("mock-backup", { mock: answering("a"), "mock-backup": answering("b") }), {
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
    });
    expect((await chat.getModelMenu()).defaultChoice).toEqual({ modelId: mockModelId, providerId: "mock", reasoning: null });
  });
});
