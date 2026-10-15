import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { createMcpServers, createMemoryMcpStore } from "../../src/index";
import type { McpServersOptions } from "../../src/index";
import { createFakeMcpServer, publicResolver } from "./fake-mcp-server";
import type { FakeServerOptions } from "./fake-mcp-server";

export const SECRET_KEY = "k".repeat(40);

export const wikiTools = [
  { name: "ask_question", description: "Отвечает на вопрос", inputSchema: { type: "object", properties: { question: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "delete_repo", description: "Удаляет", inputSchema: { type: "object", properties: { repo: { type: "string" } } } },
];

/** Пакет с поддельным сервером, журналом строк и записью расходов; часы двигаются руками. */
export async function setupMcp(fakeOptions: FakeServerOptions = {}, overrides: Partial<McpServersOptions> = {}) {
  const fake = createFakeMcpServer({ tools: wikiTools, ...fakeOptions });
  const store = createMemoryMcpStore();
  const logLines: string[] = [];
  const usage: UsageRecord[] = [];
  const chatStorage = createInMemoryChatStorage();
  const clock = { now: Date.parse("2026-10-15T10:00:00.000Z") };
  const mcp = await createMcpServers({
    store,
    secretKey: SECRET_KEY,
    isAdmin: (userId) => userId === "boss",
    fetch: fake.fetch,
    resolveHost: publicResolver,
    log: (line) => logLines.push(line),
    now: () => clock.now,
    spending: {
      storage: {
        insertUsageRecord: async (record) => {
          usage.push(record);
          await chatStorage.insertUsageRecord(record);
        },
      },
    },
    ...overrides,
  });
  return { fake, store, mcp, logLines, usage, clock };
}

/** Модель хода; права — как их дала бы `agent.viewer` приложения: админ — `boss`. */
export const turn = (ownerId = "anna", turnId = "turn-1", audience: "private" | "group" = "private") => ({ ownerId, chatId: "chat-1", turnId, audience, viewer: { isAdmin: ownerId === "boss" } });

/** Вызов инструмента так, как его делает AI SDK. */
export async function callTool(tools: Record<string, { execute?: (...args: never[]) => unknown }>, name: string, input: object, toolCallId = "call-1") {
  const execute = tools[name]?.execute as ((input: object, options: { toolCallId: string; messages: unknown[] }) => Promise<string>) | undefined;
  if (!execute) throw new Error(`нет инструмента ${name}`);
  return execute(input, { toolCallId, messages: [] });
}
