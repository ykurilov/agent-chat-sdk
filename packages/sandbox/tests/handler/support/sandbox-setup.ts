import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createChatServer } from "@ykurilov/agent-chat-server";
import type { ChatHandlerOptions } from "@ykurilov/agent-chat-server";
import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ModelCatalog } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";
import { createMemorySandboxJournal, createSandboxHandler } from "../../../src/index";
import type { SandboxHandlerOptions, SandboxJournal } from "../../../src/index";

export const origin = "http://test.local";
export const sandboxBase = `${origin}/api/sandbox`;
export const chatBase = `${origin}/api/chat`;
export const mockModelId = "mock-model";
export const appInstructions = "Ты помощник.";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/** Шаг модели-заглушки: текст ответа или вызов инструмента. */
export type ModelStep = { text: string } | { toolCall: { id: string; name: string; input: unknown } };

/** Модель отвечает шагами по очереди; шаги кончились — «ответ». */
export function scriptedModel(steps: ModelStep[] = []) {
  const queue = [...steps];
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = queue.shift() ?? { text: "ответ" };
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            if ("text" in step) {
              controller.enqueue({ type: "text-start", id: "t" });
              controller.enqueue({ type: "text-delta", id: "t", delta: step.text });
              controller.enqueue({ type: "text-end", id: "t" });
              controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
            } else {
              const { id, name, input } = step.toolCall;
              controller.enqueue({ type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) });
              controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage });
            }
            controller.close();
          },
        }),
      };
    },
  });
}

export function catalogWithModel(model: MockLanguageModelV4): ModelCatalog {
  return extendCatalog(standardCatalog, {
    addProviders: [{ id: "mock", displayName: "Mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
    addModels: [
      {
        id: mockModelId,
        displayName: "Mock Model",
        contextWindowTokens: 100_000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { mock: "mock-v1" },
      },
    ],
  });
}

export interface SetupOptions {
  steps?: ModelStep[];
  chat?: Partial<ChatHandlerOptions>;
  sandbox?: Partial<Omit<SandboxHandlerOptions, "chat">>;
  storage?: ChatStorage;
}

/**
 * Песочница и боевой чат на одном хранилище. Вход — заголовок `x-user`; админы — `admins` (можно менять на ходу).
 * Боевой обработчик получает те же настройки чата, что и песочница.
 */
export function setupSandbox(options: SetupOptions = {}) {
  const storage = options.storage ?? createInMemoryChatStorage();
  const model = scriptedModel(options.steps);
  const admins = new Set(["anna", "boris"]);
  const isAdminCalls: string[] = [];
  const resolveUserCalls: string[] = [];
  const errors: string[] = [];
  const journal: SandboxJournal = options.sandbox?.journal ?? createMemorySandboxJournal({ env: {}, logError: (message) => errors.push(message) });
  const chat: ChatHandlerOptions = {
    basePath: "/api/chat",
    storage,
    resolveUser: async (request) => {
      const id = request.headers.get("x-user");
      resolveUserCalls.push(id ?? "");
      return id ? { id } : null;
    },
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    catalog: catalogWithModel(model),
    agent: { instructions: appInstructions },
    env: { MOCK_API_KEY: "не-настоящий-ключ" },
    chatList: true,
    logError: (message) => errors.push(message),
    ...options.chat,
  };
  const sandbox = createSandboxHandler({
    chat,
    journal,
    isAdmin: (user) => {
      isAdminCalls.push(user.id);
      return admins.has(user.id);
    },
    ...options.sandbox,
  });
  const battle = createChatServer(chat);

  async function request(base: string, method: string, path: string, init: { user?: string | null; body?: unknown; origin?: string } = {}) {
    const headers: Record<string, string> = {};
    if (init.user !== null) headers["x-user"] = init.user ?? "anna";
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.origin) headers.origin = init.origin;
    const handler = base === sandboxBase ? sandbox : battle.handler;
    return handler.fetch(new Request(`${base}${path}`, { method, headers, ...(init.body !== undefined && { body: JSON.stringify(init.body) }) }));
  }

  const call = (method: string, path: string, init?: Parameters<typeof request>[3]) => request(sandboxBase, method, path, init);
  const callBattle = (method: string, path: string, init?: Parameters<typeof request>[3]) => request(chatBase, method, path, init);

  /** Новый песочный чат админа; отдаёт id. */
  async function createChat(user = "anna"): Promise<string> {
    const response = await call("POST", "", { user, body: {} });
    if (response.status !== 201) throw new Error(`чат не создан: ${response.status} ${await response.text()}`);
    return ((await response.json()) as { id: string }).id;
  }

  /** Ход в песочном чате: дочитывает поток до конца. */
  async function send(chatId: string, text = "привет", user = "anna"): Promise<void> {
    const response = await call("POST", `/${chatId}/messages`, {
      user,
      body: { message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] } },
    });
    if (response.status !== 200) throw new Error(`ход не принят: ${response.status} ${await response.text()}`);
    await response.text();
    await sandbox.flush();
  }

  return { storage, model, admins, isAdminCalls, resolveUserCalls, errors, journal, chat, sandbox, battle, call, callBattle, createChat, send };
}
