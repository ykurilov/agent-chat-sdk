import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createChatService } from "../../../src/chat-service";
import type { ChatService, ChatServiceOptions } from "../../../src/chat-service";
import type { AgentHelper } from "../../../src/helpers/helper-types";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, mockUsage, readAll, streamOf, streamStart, textParts } from "./mock-model";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
/** Ответ помощника на один шаг: готовый итог или функция от запроса (например, бросить ошибку провайдера). */
export type HelperScript = GenerateResult | ((options: LanguageModelV4CallOptions) => GenerateResult | Promise<GenerateResult>);

/**
 * Модель для тестов помощников: основной агент идёт потоком (`doStream`), помощник — запросом без потока
 * (`doGenerate`), так что у каждого свой сценарий. После сценария основной агент пишет «Готово», помощник — «Итог помощника».
 */
export function helperChatModel(scripts: { stream?: LanguageModelV4StreamPart[][]; generate?: HelperScript[] } = {}) {
  let streamCall = 0;
  let generateCall = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf(scripts.stream?.[streamCall++] ?? answersDone()) }),
    doGenerate: async (options) => {
      const script = scripts.generate?.[generateCall++] ?? helperText("Итог помощника");
      return typeof script === "function" ? script(options) : script;
    },
  });
}

/** Шаг помощника: вызовы инструментов. */
export function helperCalls(...calls: Array<{ id: string; toolName: string; input: unknown }>): GenerateResult {
  return {
    content: calls.map((call) => ({ type: "tool-call" as const, toolCallId: call.id, toolName: call.toolName, input: JSON.stringify(call.input) })),
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: mockUsage,
    warnings: [],
  };
}

/** Шаг помощника: итоговый текст. */
export const helperText = (text: string): GenerateResult => generateResult(text) as GenerateResult;

/** Шаг основного агента: итоговый текст «Готово». */
export const answersDone = (): LanguageModelV4StreamPart[] => [streamStart, ...textParts(["Готово"]), finishPart()];

/** Шаг основного агента: вызов помощника `helper_<name>` с заданием. */
export function callsHelper(id: string, name: string, task: string): LanguageModelV4StreamPart[] {
  return [streamStart, { type: "tool-call", toolCallId: id, toolName: `helper_${name}`, input: JSON.stringify({ task }) }, finishPart("tool-calls")];
}

/** Инструмент поиска помощника: отвечает строкой с запросом. */
export const searchTool = (execute: (input: { query: string }) => Promise<unknown> = async ({ query }) => `найдено: ${query}`) =>
  tool({ description: "Поиск в интернете", inputSchema: z.object({ query: z.string() }), execute });

export function researchHelper(extra: Partial<AgentHelper> = {}): AgentHelper {
  return {
    description: "Ищет в интернете и пишет короткую сводку",
    instructions: "Ты исследователь. Найди и коротко перескажи.",
    model: { modelId: mockModelId, providerId: "mock" },
    tools: { search: searchTool() },
    ...extra,
  };
}

/** Служба с помощниками на модели-заглушке; `build` — новый экземпляр на том же хранилище. */
export function helperService(options: {
  model: MockLanguageModelV4;
  helpers: Record<string, AgentHelper>;
  tools?: ToolSet;
  storage?: ChatStorage;
  extra?: Partial<Omit<ChatServiceOptions, "agent">> & { agent?: Partial<ChatServiceOptions["agent"]> };
}) {
  const storage = options.storage ?? createInMemoryChatStorage();
  const { agent: agentExtra, ...extra } = options.extra ?? {};
  const build = (chatStorage: ChatStorage): ChatService =>
    createChatService({
      storage: chatStorage,
      catalog: mockCatalog({ mock: options.model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        ...(options.tools && { tools: options.tools }),
        helpers: options.helpers,
        ...agentExtra,
      },
      env: mockEnv,
      ...extra,
    });
  return { storage, service: build(storage), build };
}

export const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

/** Новый чат и сообщение человека; ход дочитан до конца. */
export async function askInNewChat(service: ChatService, text = "узнай погоду", messageId = "u1") {
  const chat = await service.createChat("anna");
  const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage(messageId, text)));
  return { chat, chunks };
}

export async function lastAnswer(service: ChatService, chatId: string) {
  const { messages } = await service.getHistory("anna", chatId);
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

/** Часть вызова помощника `helper_<name>` в ответе. */
export function helperPart(parts: ReadonlyArray<{ type: string }>, name = "research") {
  return parts.find((part) => part.type === `helper_${name}` || part.type === `tool-helper_${name}`) as
    | { type: string; state: string; toolCallId: string; output?: Record<string, any>; preliminary?: boolean }
    | undefined;
}
