import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { createChatService, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatService, ChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory } from "../src/create-long-term-memory";

// Срез «два чата» целиком: настоящая память пакета, настоящая служба чата ядра, модель — заглушка.

const usage = {
  inputTokens: { total: 100, noCache: 40, cacheRead: 60, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 },
};
const start: LanguageModelV4StreamPart = { type: "stream-start", warnings: [] };
const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
const reply = (text: string): LanguageModelV4StreamPart[] => [
  start,
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  finish("stop"),
];
const callsMemory = (input: object): LanguageModelV4StreamPart[] => [
  start,
  { type: "tool-call", toolCallId: "call-1", toolName: "manage_memory", input: JSON.stringify(input) },
  finish("tool-calls"),
];

const stream = (parts: LanguageModelV4StreamPart[]) =>
  new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(part));
      controller.close();
    },
  });

/** Модель по сценарию: каждый вызов берёт следующий заготовленный ответ; все запросы запоминает. */
function scriptedModel(scripts: LanguageModelV4StreamPart[][]) {
  const requests: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      requests.push(options);
      return { stream: stream(scripts[requests.length - 1] ?? reply("Готово")) };
    },
  });
  return { model, requests };
}

function setup(scripts: LanguageModelV4StreamPart[][], memoryOptions: { maxBlockChars?: number } = {}) {
  const storage = createInMemoryChatStorage();
  const memory = createLongTermMemory({ storage, ...memoryOptions });
  const { model, requests } = scriptedModel(scripts);
  const catalog = extendCatalog(standardCatalog, {
    addProviders: [
      {
        id: "mock",
        displayName: "mock",
        apiKeyEnv: "MOCK_API_KEY",
        createLanguageModel: () => model,
        requestOptions: () => ({}),
      },
    ],
    addModels: [
      {
        id: "mock-model",
        displayName: "Mock",
        contextWindowTokens: 100_000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { mock: "mock-v1" },
      },
    ],
  });
  const service = createChatService({
    storage,
    catalog,
    defaultChoice: { modelId: "mock-model", providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    memory,
    env: { MOCK_API_KEY: "не-настоящий" },
  });
  return { storage, memory, service, requests };
}

const say = async (service: ChatService, userId: string, chatId: string, id: string, text: string) => {
  const stream = await service.sendMessage(userId, chatId, { id, role: "user", parts: [{ type: "text", text }] });
  for await (const _chunk of stream) void _chunk;
};

/** Текст всех частей последнего сообщения человека в запросе. */
function lastUserText(request: LanguageModelV4CallOptions): string {
  const last = [...request.prompt].reverse().find((message) => message.role === "user");
  if (!last || typeof last.content === "string") return String(last?.content ?? "");
  return last.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** Хранилище без служебной части застывшего контекста: блок живёт только в ней. */
async function storedText(storage: ChatStorage, chatId: string): Promise<string> {
  const messages = await storage.listMessages(chatId);
  return JSON.stringify(messages.map((message) => ({ ...message, parts: message.parts.filter((part) => part.type !== "data-frozen-context") })));
}

describe("долгая память через службу чата", () => {
  const remember = { action: "create", notes: [{ categories: ["Правила"], content: "Отвечать на «ты»" }] };

  it("запомнил в чате A — виден блоком в чате B; в истории B блока нет", async () => {
    const { service, storage, requests } = setup([callsMemory(remember), reply("Запомнил."), reply("Привет, на «ты»!")]);
    const chatA = await service.createChat("anna");
    await say(service, "anna", chatA.id, "a1", "Отвечай мне на «ты», запомни");
    const chatB = await service.createChat("anna");
    await say(service, "anna", chatB.id, "b1", "Как дела?");

    const requestB = requests.at(-1)!;
    expect(lastUserText(requestB)).toContain("<agent_memory>");
    expect(lastUserText(requestB)).toContain("Отвечать на «ты»");
    expect(await storedText(storage, chatB.id)).not.toContain("agent_memory");
    expect(await storedText(storage, chatA.id)).not.toContain("agent_memory");
  });

  it("запись вытеснена лимитом блока: в идущем чате ни новой записи, ни строки про место; в новом чате — новая запись", async () => {
    const short = { action: "create", notes: [{ categories: ["Правила"], content: "Отвечать на «ты»" }] };
    const long = { action: "create", notes: [{ categories: ["Работа"], content: `Проект: ${"очень подробно ".repeat(14)}` }] };
    const { service, requests } = setup([callsMemory(short), reply("Запомнил."), callsMemory(long), reply("Запомнил."), reply("Ок"), reply("Ок")], { maxBlockChars: 600 });
    const chat = await service.createChat("anna");
    await say(service, "anna", chat.id, "u1", "запомни раз");
    await say(service, "anna", chat.id, "u2", "запомни два");
    await say(service, "anna", chat.id, "u3", "что помнишь?");
    const third = lastUserText(requests.at(-1)!);
    expect(third).not.toContain("очень подробно");
    expect(third).not.toContain("Больше не действует");
    expect(third).not.toContain("Не показано ради места");
    const fresh = await service.createChat("anna");
    await say(service, "anna", fresh.id, "f1", "что помнишь?");
    const inFresh = lastUserText(requests.at(-1)!);
    expect(inFresh).toContain("очень подробно");
    expect(inFresh).not.toContain("Отвечать на «ты»");
    expect(inFresh).not.toContain("Не показано ради места");
  });

  it("агент записал факт: в следующем ходе того же чата приписки про память нет", async () => {
    const { service, requests } = setup([reply("Привет."), callsMemory(remember), reply("Запомнил."), reply("Ок")]);
    const chat = await service.createChat("anna");
    await say(service, "anna", chat.id, "u1", "привет");
    await say(service, "anna", chat.id, "u2", "отвечай на «ты», запомни");
    await say(service, "anna", chat.id, "u3", "как дела?");
    expect(lastUserText(requests.at(-1)!)).toBe("как дела?");
  });

  it("в первом запросе чата A (память пуста) блока нет; инструмент у агента есть", async () => {
    const { service, requests } = setup([callsMemory(remember), reply("Запомнил.")]);
    const chatA = await service.createChat("anna");
    await say(service, "anna", chatA.id, "a1", "Запомни");
    expect(lastUserText(requests[0]!)).not.toContain("agent_memory");
    expect(requests[0]!.tools?.map((tool) => tool.name)).toContain("manage_memory");
  });

  it("блок текущего хода не меняется от записи, сделанной в этом же ходу", async () => {
    const { service, requests } = setup([callsMemory(remember), reply("Запомнил.")]);
    const chat = await service.createChat("anna");
    await say(service, "anna", chat.id, "a1", "Запомни");
    expect(requests).toHaveLength(2);
    expect(lastUserText(requests[1]!)).not.toContain("agent_memory");
  });

  it("второй человек не видит записи первого: ни блоком, ни поиском", async () => {
    const { service, requests, memory } = setup([callsMemory(remember), reply("Запомнил."), reply("Привет!")]);
    const anna = await service.createChat("anna");
    await say(service, "anna", anna.id, "a1", "Запомни");
    const boris = await service.createChat("boris");
    await say(service, "boris", boris.id, "b1", "Привет");
    expect(lastUserText(requests.at(-1)!)).not.toContain("agent_memory");
    expect(lastUserText(requests.at(-1)!)).not.toContain("«ты»");
    expect((await memory.list("boris")).notes).toEqual([]);
  });

  it("удаление чата память не трогает", async () => {
    const { service, requests } = setup([callsMemory(remember), reply("Запомнил."), reply("Привет!")]);
    const chatA = await service.createChat("anna");
    await say(service, "anna", chatA.id, "a1", "Запомни");
    await service.deleteChat("anna", chatA.id);
    const chatB = await service.createChat("anna");
    await say(service, "anna", chatB.id, "b1", "Привет");
    expect(lastUserText(requests.at(-1)!)).toContain("Отвечать на «ты»");
  });

  it("после «стереть всю память» следующий запрос без блока", async () => {
    const { service, requests, memory } = setup([callsMemory(remember), reply("Запомнил."), reply("Привет!")]);
    const chatA = await service.createChat("anna");
    await say(service, "anna", chatA.id, "a1", "Запомни");
    await memory.clear("anna");
    const chatB = await service.createChat("anna");
    await say(service, "anna", chatB.id, "b1", "Привет");
    expect(lastUserText(requests.at(-1)!)).not.toContain("agent_memory");
  });

  it("инструкция памяти в запросе один раз", async () => {
    const { service, requests, memory } = setup([reply("Ок")]);
    const chat = await service.createChat("anna");
    await say(service, "anna", chat.id, "a1", "Привет");
    const system = requests[0]!.prompt.find((message) => message.role === "system");
    const text = String(system?.content);
    expect(text.split(memory.instructions)).toHaveLength(2);
  });
});
