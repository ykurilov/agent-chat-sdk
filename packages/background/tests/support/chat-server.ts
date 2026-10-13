import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_NOTICE_PART_TYPE, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { AgentChatMessage, AgentHelper, AgentNotice, ChatStorage } from "@ykurilov/agent-chat-core";
import { createChatServer } from "@ykurilov/agent-chat-server";
import type { ChatServerService } from "@ykurilov/agent-chat-server";
import { MockLanguageModelV4 } from "ai/test";
import { createBackgroundTasks } from "../../src/index";
import { sqliteTaskStore } from "../../src/sqlite";
import type { BackgroundToolDefinition, TaskStore } from "../../src/types";

/** Связка фона с настоящей службой чата: модель по сценарию, адреса сервера, хранилище задач на SQLite. */
export type StreamPart = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer Part> ? Part : never;
export type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type GenerateOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];

const MODEL_ID = "mock-model";
const base = "http://test.local/api/chat";
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const finish = (reason: "stop" | "tool-calls"): StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });

/** Шаг основного агента: текст. */
export const saying = (text: string): StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  finish("stop"),
];

/** Шаг основного агента: вызовы инструментов. */
export const calling = (...calls: Array<{ id: string; name: string; input: object }>): StreamPart[] => [
  { type: "stream-start", warnings: [] },
  ...calls.map((call): StreamPart => ({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: JSON.stringify(call.input) })),
  finish("tool-calls"),
];

/** Шаг помощника: вызов инструмента. */
export const helperCalls = (id: string, toolName: string, input: object): GenerateResult => ({
  content: [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage,
  warnings: [],
});

/** Шаг помощника: итог. */
export const helperText = (text: string): GenerateResult => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage,
  warnings: [],
});

/** Шаг помощника, который не кончается, пока запрос не отменят (сервер остановлен). */
export const helperHangs = (options: GenerateOptions): Promise<GenerateResult> =>
  new Promise((_, reject) => {
    const signal = options.abortSignal;
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

/**
 * Модель по сценарию. Основной агент идёт потоком: шаги по порядку, шаг-функция может ждать ворот; после сценария —
 * «ответ N». Помощник идёт запросом без потока: свой сценарий, после него — «Итог помощника».
 */
export function scriptedModel(
  scripts: {
    stream?: Array<StreamPart[] | (() => Promise<StreamPart[]>)>;
    generate?: Array<GenerateResult | ((options: GenerateOptions) => Promise<GenerateResult>)>;
  } = {},
) {
  let streamCall = 0;
  let generateCall = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = scripts.stream?.[streamCall++];
      const parts = typeof step === "function" ? await step() : (step ?? saying(`ответ ${streamCall}`));
      return { stream: new ReadableStream<StreamPart>({ start: (controller) => (parts.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
    doGenerate: async (options) => {
      const step = scripts.generate?.[generateCall++] ?? helperText("Итог помощника");
      return typeof step === "function" ? step(options) : step;
    },
  });
}

/** Ворота: шаг модели ждёт, пока тест их не откроет. */
export function createGate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, after: (parts: StreamPart[]) => async () => (await opened, parts) };
}

export interface ChatServerCopy {
  service: ChatServerService;
  model: MockLanguageModelV4;
  errors: string[];
  call(method: string, path: string, body?: unknown): Promise<Response>;
  /** Сообщение человека; ход дочитан до конца. */
  ask(chatId: string, id: string, text: string): Promise<void>;
  /** Сообщение человека; ход идёт, поток не дочитан. */
  askAndKeep(chatId: string, id: string, text: string): Promise<{ done: Promise<void> }>;
  history(chatId: string): Promise<AgentChatMessage[]>;
}

/** Копия сервера: своя служба чата и свой фон над общими хранилищами. Восстановление запущено, как при старте сервера. */
export async function openCopy(input: {
  storage: ChatStorage;
  store: TaskStore;
  model: MockLanguageModelV4;
  tools?: Record<string, BackgroundToolDefinition>;
  helpers?: Record<string, AgentHelper>;
  leaseMs?: number;
  maxRunningPerUser?: number;
}): Promise<ChatServerCopy> {
  const errors: string[] = [];
  const background = createBackgroundTasks({
    store: input.store,
    tools: input.tools ?? {},
    ...(input.leaseMs && { leaseMs: input.leaseMs }),
    ...(input.maxRunningPerUser && { maxRunningPerUser: input.maxRunningPerUser }),
  });
  const { handler, service } = createChatServer({
    basePath: "/api/chat",
    resolveUser: async () => ({ id: "anna" }),
    defaultChoice: { modelId: MODEL_ID, providerId: "mock" },
    catalog: catalogWithModel(input.model),
    agent: { instructions: "Ты помощник.", ...(input.helpers && { helpers: input.helpers }) },
    env: { MOCK_API_KEY: "не-настоящий-ключ" },
    storage: input.storage,
    chatList: true,
    background,
    logError: (message) => errors.push(message),
  });
  await service.recoverInterruptedAnswers();
  const call = (method: string, path: string, body?: unknown) =>
    handler.fetch(
      new Request(`${base}${path}`, {
        method,
        ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
  const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
  return {
    service,
    model: input.model,
    errors,
    call,
    async ask(chatId, id, text) {
      await readAll(await service.sendMessage("anna", chatId, userMessage(id, text)));
    },
    async askAndKeep(chatId, id, text) {
      const stream = await service.sendMessage("anna", chatId, userMessage(id, text));
      return { done: readAll(stream).then(() => undefined) };
    },
    async history(chatId) {
      return (await service.getHistory("anna", chatId)).messages;
    },
  };
}

/** Общие хранилища копий: чаты в памяти, задачи в файле SQLite (у каждой копии своё подключение). */
export function sharedStorage() {
  const folder = mkdtempSync(join(tmpdir(), "background-chat-server-"));
  const filePath = join(folder, "tasks.sqlite");
  const stores: TaskStore[] = [];
  return {
    storage: createInMemoryChatStorage(),
    openStore() {
      const store = sqliteTaskStore(filePath);
      stores.push(store);
      return store;
    },
    async close() {
      for (const store of stores) await store.close?.();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** Служебные сообщения в истории: по сообщению — уведомления. */
export function noticesIn(messages: AgentChatMessage[]): AgentNotice[][] {
  return messages.flatMap((message) =>
    message.parts.filter((part) => part.type === AGENT_NOTICE_PART_TYPE).map((part) => (part as unknown as { data: { notices: AgentNotice[] } }).data.notices),
  );
}

/** Роли сообщений, служебное — `notice`. */
export function rolesOf(messages: AgentChatMessage[]): string[] {
  return messages.map((message) => (message.parts.some((part) => part.type === AGENT_NOTICE_PART_TYPE) ? "notice" : message.role));
}

function catalogWithModel(model: MockLanguageModelV4) {
  return extendCatalog(standardCatalog, {
    addProviders: [{ id: "mock", displayName: "Mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
    addModels: [
      {
        id: MODEL_ID,
        displayName: "Mock Model",
        contextWindowTokens: 100_000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { mock: "mock-v1" },
      },
    ],
  });
}

async function readAll<T>(stream: ReadableStream<T>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}
