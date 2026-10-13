import { CURRENT_FORMAT_VERSION, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { AgentChatMessage, ChatStorage } from "@ykurilov/agent-chat-core";
import { createChatHandler } from "../../src/chat-handler";
import type { ChatHandlerOptions } from "../../src/chat-handler";
import { mockCatalog, mockEnv, mockModelId } from "./mock-catalog";

const base = "http://test.local/api/chat";

export const message = (id: string, text: string) => ({ message: { id, role: "user", parts: [{ type: "text", text }] } });

/**
 * Обработчик чата на хранилище в памяти и модели-заглушке. Пользователь берётся из заголовка `x-user`
 * (`call` ставит `anna`, `user: null` — без заголовка). Любую настройку обработчика можно заменить.
 */
export function createTestChat(options: Partial<ChatHandlerOptions> & { gate?: () => Promise<void> } = {}) {
  const { gate, ...overrides } = options;
  const storage: ChatStorage = options.storage ?? createInMemoryChatStorage();
  const handler = createChatHandler({
    basePath: "/api/chat",
    resolveUser: async (request) => {
      const user = request.headers.get("x-user");
      return user ? { id: user } : null;
    },
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    catalog: mockCatalog(gate),
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    ...overrides,
    storage,
  });
  const call = (method: string, path: string, init: { body?: unknown; user?: string | null; signal?: AbortSignal } = {}) =>
    handler.fetch(
      new Request(`${base}${path}`, {
        method,
        headers: {
          ...(init.user !== null && { "x-user": init.user ?? "anna" }),
          ...(init.body !== undefined && { "content-type": "application/json" }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        ...(init.signal && { signal: init.signal }),
      }),
    );
  async function createChat(user = "anna"): Promise<string> {
    return ((await (await call("POST", "", { user })).json()) as { id: string }).id;
  }
  async function history(chatId: string) {
    return (await (await call("GET", `/${chatId}`)).json()) as { messages: AgentChatMessage[]; running: boolean };
  }
  return { handler, storage, call, createChat, history };
}

/** В базе вопрос `u1` и недописанный ответ: так остаётся ход, оборванный остановкой сервера. */
/**
 * Вопрос человека и недописанный ответ на него. `userParts` — части вопроса (например, отметка канала);
 * `afterNotice` — ответ идёт на служебное сообщение после вопроса, как ход, начатый итогом фона.
 */
export async function seedUnfinishedAnswer(
  storage: ChatStorage,
  chatId: string,
  answerId = "a1",
  text = "Начало ответа",
  seed: { userParts?: unknown[]; afterNotice?: boolean } = {},
) {
  const common = {
    chatId,
    formatVersion: CURRENT_FORMAT_VERSION,
    usage: null,
    reasoningDurationsMs: {},
    error: null,
    // Ответ прошлого запуска: знаков жизни нет уже минуту, восстановление считает его брошенным.
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  };
  await storage.insertMessage({
    ...common,
    id: "u1",
    parentId: null,
    role: "user",
    parts: [{ type: "text", text: "Привет" }, ...((seed.userParts ?? []) as never[])],
    status: "complete",
    modelId: null,
    providerId: null,
  });
  if (seed.afterNotice) {
    await storage.insertMessage({
      ...common,
      id: "n1",
      parentId: "u1",
      role: "user",
      parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "task_done", taskId: "t1", title: "Отчёт" }] } }],
      status: "complete",
      modelId: null,
      providerId: null,
    });
  }
  await storage.insertMessage({
    ...common,
    id: answerId,
    parentId: seed.afterNotice ? "n1" : "u1",
    role: "assistant",
    parts: [{ type: "text", text, state: "streaming" }],
    status: "streaming",
    modelId: mockModelId,
    providerId: "mock",
  });
}
