import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { jsonSchema, streamText, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import type { MessageAttachments } from "../../../src/attachments/message-attachments";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "../support/mock-model";

const instructions = "Ты помощник. Отвечай кратко.";

function makeTools() {
  return {
    zeta_lookup: tool({
      description: "Ищет по базе",
      inputSchema: jsonSchema<{ query: string }>({ type: "object", properties: { query: { type: "string" } } }),
      execute: async () => "нет данных",
    }),
    alpha_add: tool({
      description: "Складывает два числа",
      inputSchema: jsonSchema<{ a: number; b: number }>({
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
      }),
      execute: async ({ a, b }) => a + b,
    }),
  };
}

const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }];
const answeringModel = () => mockModel(() => streamOf(reasoningAndTextParts(["ок"])));

/** Запрос для стандартного каталога: ключ любого провайдера есть в окружении. */
function requestFor(providerId: string, chatId = "chat-42") {
  return buildModelRequest({
    catalog: standardCatalog,
    modelId: "deepseek-4.1-flash",
    providerId,
    chatId,
    instructions,
    tools: makeTools(),
    history,
    env: { DEEPSEEK_API_KEY: "k", FIREWORKS_API_KEY: "k", TOGETHER_API_KEY: "k" },
  });
}

async function sentToModel(): Promise<LanguageModelV4CallOptions> {
  const model = answeringModel();
  const request = await buildModelRequest({
    catalog: mockCatalog({ mock: model }),
    modelId: mockModelId,
    providerId: "mock",
    chatId: "chat-1",
    instructions,
    tools: makeTools(),
    history,
    env: mockEnv,
  });
  await streamText(request).consumeStream();
  const call = model.doStreamCalls[0];
  if (!call) throw new Error("модель не вызвана");
  return call;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildModelRequest", () => {
  it("инструкция идёт первой; она и инструменты побайтно те же при смене часов: даты и времени в них нет", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T08:00:00Z"));
    const morning = await sentToModel();
    vi.setSystemTime(new Date("2027-06-15T23:59:00Z"));
    const night = await sentToModel();
    expect(JSON.stringify(night.prompt[0])).toBe(JSON.stringify(morning.prompt[0]));
    expect(JSON.stringify(night.tools)).toBe(JSON.stringify(morning.tools));
    expect(morning.prompt[0]).toEqual({ role: "system", content: instructions });
  });

  it("инструменты отсортированы по имени", async () => {
    const request = await requestFor("deepseek");
    expect(Object.keys(request.tools ?? {})).toEqual(["alpha_add", "zeta_lookup"]);
    const sent = await sentToModel();
    expect(sent.tools?.map((sentTool) => sentTool.name)).toEqual(["alpha_add", "zeta_lookup"]);
  });

  it("для Fireworks задаёт ключ кэша, сохранение рассуждений и привязку к сессии", async () => {
    const request = await requestFor("fireworks");
    expect(request.providerOptions?.fireworks).toMatchObject({
      promptCacheKey: "chat-42",
      reasoningHistory: "preserved",
    });
    expect(request.headers).toMatchObject({ "x-session-affinity": "chat-42" });
  });

  it("для OpenRouter привязывает чат к одному серверу заголовком x-session-id", async () => {
    const request = await buildModelRequest({
      catalog: standardCatalog,
      modelId: "gemini-3.8-flash",
      providerId: "openrouter",
      chatId: "chat-42",
      instructions,
      history,
      env: { OPENROUTER_API_KEY: "k" },
    });
    expect(request.headers).toEqual({ "x-session-id": "chat-42" });
  });

  it("заголовок x-session-id реально уходит в HTTP-запрос к OpenRouter", async () => {
    const sentHeaders: Headers[] = [];
    const fetchSpy: typeof globalThis.fetch = async (_url, init) => {
      sentHeaders.push(new Headers(init?.headers));
      return new Response("{}", { status: 400 });
    };
    const request = await buildModelRequest({
      catalog: standardCatalog,
      modelId: "gemini-3.8-flash",
      providerId: "openrouter",
      chatId: "chat-42",
      instructions,
      history,
      env: { OPENROUTER_API_KEY: "k" },
      fetch: fetchSpy,
    });
    await streamText({ ...request, maxRetries: 0, onError: () => {} }).consumeStream();
    expect(sentHeaders[0]?.get("x-session-id")).toBe("chat-42");
  });

  it("заголовок x-session-id с кириллическим номером чата уходит в HTTP-запрос безопасным значением", async () => {
    const sentHeaders: Headers[] = [];
    const fetchSpy: typeof globalThis.fetch = async (_url, init) => {
      sentHeaders.push(new Headers(init?.headers));
      return new Response("{}", { status: 400 });
    };
    const request = await buildModelRequest({
      catalog: standardCatalog,
      modelId: "gemini-3.8-flash",
      providerId: "openrouter",
      chatId: "чат-42",
      instructions,
      history,
      env: { OPENROUTER_API_KEY: "k" },
      fetch: fetchSpy,
    });
    await streamText({ ...request, maxRetries: 0, onError: () => {} }).consumeStream();
    expect(sentHeaders[0]?.get("x-session-id")).toMatch(/^[\x21-\x7e]{1,128}$/);
  });

  it.each(["deepseek", "together"])("для %s полей кэша и привязки к сессии нет", async (providerId) => {
    const request = await requestFor(providerId);
    expect(request.providerOptions?.fireworks).toBeUndefined();
    expect(JSON.stringify(request.providerOptions ?? {})).not.toContain("chat-42");
    expect(request.headers?.["x-session-affinity"]).toBeUndefined();
  });

  it("не отправляет рассуждения другого провайдера из истории", async () => {
    const request = await buildModelRequest({
      catalog: mockCatalog({ mock: answeringModel() }),
      modelId: mockModelId,
      providerId: "mock",
      chatId: "chat-1",
      instructions,
      history: [
        ...history,
        {
          id: "a1",
          role: "assistant",
          metadata: { modelId: mockModelId, providerId: "fireworks", status: "complete" },
          parts: [
            { type: "reasoning", text: "чужое рассуждение", state: "done" },
            { type: "text", text: "Привет!", state: "done" },
          ],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "Как дела?" }] },
      ],
      env: mockEnv,
    });
    expect(JSON.stringify(request.messages)).not.toContain("чужое рассуждение");
    expect(JSON.stringify(request.messages)).toContain("Привет!");
  });
});

describe("buildModelRequest: уровень рассуждений", () => {
  const acme: ProviderDescription = {
    id: "acme",
    displayName: "Acme",
    apiKeyEnv: "ACME_API_KEY",
    createLanguageModel: () => answeringModel(),
    requestOptions: ({ chatId }) => ({ providerOptions: { acme: { cacheKey: chatId } } }),
    reasoningRequest: (level, { profile }) => ({
      reasoning: level === "off" ? "none" : "high",
      providerOptions: { acme: { level, encrypted: profile.reasoning.encrypted === true } },
    }),
  };
  const thinker: ModelProfile = {
    id: "thinker",
    displayName: "Thinker",
    contextWindowTokens: 1000,
    acceptsImages: false,
    reasoning: { replayPastTurns: true, levels: ["off", "low"], defaultLevel: "low", encrypted: true },
    providerModelIds: { acme: "thinker-1" },
    providerOptions: { acme: { profileOption: true } },
  };
  const plain: ModelProfile = { ...thinker, id: "plain", reasoning: { replayPastTurns: true } };
  const catalog = extendCatalog(standardCatalog, { addProviders: [acme], addModels: [thinker, plain] });
  const env = { ACME_API_KEY: "k" };

  const requestFor = (modelId: string, reasoning?: string) =>
    buildModelRequest({ catalog, modelId, providerId: "acme", chatId: "chat-7", instructions, history, env, reasoning });

  it("переводит выбранный уровень в запрос провайдера и сливает его с опциями профиля и провайдера", async () => {
    const request = await requestFor("thinker", "off");
    expect(request.reasoning).toBe("none");
    expect(request.providerOptions?.acme).toEqual({
      cacheKey: "chat-7",
      profileOption: true,
      level: "off",
      encrypted: true,
    });
  });

  it("без выбора берёт уровень по умолчанию профиля", async () => {
    const request = await requestFor("thinker");
    expect(request.reasoning).toBe("high");
    expect(request.providerOptions?.acme).toMatchObject({ level: "low" });
  });

  it("уровень, которого нет у модели, заменяется уровнем по умолчанию", async () => {
    const request = await requestFor("thinker", "max");
    expect(request.providerOptions?.acme).toMatchObject({ level: "low" });
  });

  it("у профиля без уровней полей рассуждений нет", async () => {
    const request = await requestFor("plain", "high");
    expect(request.reasoning).toBeUndefined();
    expect(request.providerOptions?.acme).not.toHaveProperty("level");
  });

  it("одинаковый выбор в двух ходах даёт побайтно одинаковые инструкцию, инструменты и опции", async () => {
    const [first, second] = await Promise.all([requestFor("thinker", "low"), requestFor("thinker", "low")]);
    expect(JSON.stringify([second.instructions, Object.keys(second.tools ?? {}), second.providerOptions, second.reasoning])).toBe(
      JSON.stringify([first.instructions, Object.keys(first.tools ?? {}), first.providerOptions, first.reasoning]),
    );
  });
});

describe("buildModelRequest: метка кэша на инструкции", () => {
  const withInstructionMark = (): ProviderDescription => ({
    id: "marked",
    displayName: "Marked",
    apiKeyEnv: "MARKED_KEY",
    createLanguageModel: () => answeringModel(),
    requestOptions: () => ({ instructionsProviderOptions: { marked: { cache: "on" } } }),
  });
  const profile: ModelProfile = {
    id: "marked-model",
    displayName: "Marked",
    contextWindowTokens: 1000,
    acceptsImages: false,
    reasoning: { replayPastTurns: true },
    providerModelIds: { marked: "m" },
  };

  it("провайдер просит метку — инструкция уходит сообщением system с providerOptions; текст тот же", async () => {
    const catalog = extendCatalog(standardCatalog, { addModels: [profile], addProviders: [withInstructionMark()] });
    const request = await buildModelRequest({
      catalog,
      modelId: "marked-model",
      providerId: "marked",
      chatId: "c",
      instructions,
      history,
      env: { MARKED_KEY: "k" },
    });
    expect(request.instructions).toEqual({ role: "system", content: instructions, providerOptions: { marked: { cache: "on" } } });
  });

  it("провайдер не просит метку — инструкция остаётся строкой", async () => {
    const request = await requestFor("deepseek");
    expect(request.instructions).toBe(instructions);
  });
});

describe("buildModelRequest: скользящая метка кэша на последнем сообщении", () => {
  const provider: ProviderDescription = {
    id: "sliding",
    displayName: "Sliding",
    apiKeyEnv: "SLIDING_KEY",
    createLanguageModel: () => answeringModel(),
    requestOptions: () => ({ lastMessageProviderOptions: { sliding: { cache: "on" } } }),
  };
  const profile: ModelProfile = {
    id: "sliding-model",
    displayName: "Sliding",
    contextWindowTokens: 1000,
    acceptsImages: false,
    reasoning: { replayPastTurns: true },
    providerModelIds: { sliding: "m" },
  };
  const conversation: AgentChatMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "Как дела?" }] },
  ];
  const catalog = extendCatalog(standardCatalog, { addModels: [profile], addProviders: [provider] });
  const build = (chatHistory: AgentChatMessage[], providerId = "sliding", modelId = "sliding-model") =>
    buildModelRequest({ catalog, modelId, providerId, chatId: "c", instructions, history: chatHistory, env: { SLIDING_KEY: "k", OPENROUTER_API_KEY: "k" } });

  it("метка стоит только на последнем сообщении: прежняя переписка остаётся без меток", async () => {
    const request = await build(conversation);
    expect(request.messages.map((message) => message.providerOptions)).toEqual([undefined, undefined, { sliding: { cache: "on" } }]);
  });

  it("на следующем ходе метка переезжает на новое последнее сообщение", async () => {
    const next: AgentChatMessage[] = [...conversation, { id: "a2", role: "assistant", parts: [{ type: "text", text: "Хорошо" }] }, { id: "u3", role: "user", parts: [{ type: "text", text: "А ты?" }] }];
    const request = await build(next);
    const marked = request.messages.flatMap((message, index) => (message.providerOptions ? [index] : []));
    expect(marked).toEqual([4]);
  });

  it("текст и порядок сообщений от метки не меняются", async () => {
    const plain = await buildModelRequest({ catalog: standardCatalog, modelId: "deepseek-4.1-flash", providerId: "deepseek", chatId: "c", instructions, history: conversation, env: { DEEPSEEK_API_KEY: "k" } });
    const marked = await build(conversation);
    expect(marked.messages.map(({ role, content }) => ({ role, content }))).toEqual(plain.messages.map(({ role, content }) => ({ role, content })));
  });

  it("пустая история — метки нет и ошибки нет", async () => {
    expect((await build([])).messages).toEqual([]);
  });

  it("провайдер не просит метку — сообщения без providerOptions", async () => {
    const request = await requestFor("deepseek");
    expect(request.messages.every((message) => message.providerOptions === undefined)).toBe(true);
  });

  it("OpenRouter метит последнее сообщение так же, как инструкцию", async () => {
    const request = await build(conversation, "openrouter", "gemini-3.8-flash");
    expect(request.messages.at(-1)?.providerOptions).toEqual({ openrouter: { cacheControl: { type: "ephemeral" } } });
    expect(request.messages.slice(0, -1).every((message) => message.providerOptions === undefined)).toBe(true);
  });
});

describe("вложения в запросе к модели", () => {
  const fileMessage: AgentChatMessage = {
    id: "u2",
    role: "user",
    parts: [
      { type: "file", url: "attachment:abc", mediaType: "image/png", filename: "cat.png" },
      { type: "text", text: "Что на картинке?" },
    ],
  };

  async function promptWith(attachments?: MessageAttachments) {
    const model = answeringModel();
    const request = await buildModelRequest({
      catalog: mockCatalog({ mock: model }),
      modelId: mockModelId,
      providerId: "mock",
      chatId: "chat-7",
      instructions,
      history: [fileMessage],
      env: mockEnv,
      ...(attachments && { attachments }),
    });
    await streamText(request).consumeStream();
    return model.doStreamCalls[0]!.prompt;
  }

  it("без расширения части file в запрос не попадают, текст остаётся", async () => {
    const prompt = await promptWith();
    expect(JSON.stringify(prompt)).not.toContain("attachment:abc");
    expect(JSON.stringify(prompt)).toContain("Что на картинке?");
  });

  it("с расширением история проходит через prepareHistory с чатом и профилем выбранной модели", async () => {
    const prepareHistory = vi.fn(async ({ history }: Parameters<MessageAttachments["prepareHistory"]>[0]) =>
      history.map((message) => ({ ...message, parts: [{ type: "text" as const, text: "<attachment name=\"cat.png\">кот</attachment>" }] })),
    );
    const prompt = await promptWith({ acceptUserParts: async () => [], confirmUserParts: async () => undefined, prepareHistory });
    expect(prepareHistory).toHaveBeenCalledOnce();
    const call = prepareHistory.mock.calls[0]![0];
    expect(call.chatId).toBe("chat-7");
    expect(call.history).toEqual([fileMessage]);
    expect(call.model.providerId).toBe("mock");
    expect(call.model.profile.id).toBe(mockModelId);
    expect(JSON.stringify(prompt)).toContain("<attachment name=");
  });
});
