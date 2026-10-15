import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { createChatService, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { AgentToolsModel, ChatService, ChatStorage } from "@ykurilov/agent-chat-core";
import type { ToolSet } from "ai";

const usage = {
  inputTokens: { total: 100, noCache: 40, cacheRead: 60, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 },
};
const start: LanguageModelV4StreamPart = { type: "stream-start", warnings: [] };
const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });

export const reply = (text: string): LanguageModelV4StreamPart[] => [
  start,
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  finish("stop"),
];

export const callsTool = (toolName: string, input: object, toolCallId = "call-1"): LanguageModelV4StreamPart[] => [
  start,
  { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
  finish("tool-calls"),
];

const stream = (parts: LanguageModelV4StreamPart[]) =>
  new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(part));
      controller.close();
    },
  });

/** Служба чата ядра с моделью-заглушкой по сценарию: все запросы к модели запоминаются. */
export function chatServiceWithTools(tools: (model: AgentToolsModel) => ToolSet, scripts: LanguageModelV4StreamPart[][] = []) {
  const requests: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      requests.push(options);
      return { stream: stream(scripts[requests.length - 1] ?? reply("Готово")) };
    },
  });
  const storage: ChatStorage = createInMemoryChatStorage();
  const catalog = extendCatalog(standardCatalog, {
    addProviders: [{ id: "mock", displayName: "mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
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
    agent: { instructions: "Ты помощник.", tools },
    env: { MOCK_API_KEY: "не-настоящий" },
  });
  return { service, storage, requests };
}

/** Сообщение человека; поток ответа читается до конца. */
export async function say(service: ChatService, userId: string, chatId: string, id: string, text: string) {
  const answer = await service.sendMessage(userId, chatId, { id, role: "user", parts: [{ type: "text", text }] });
  const chunks: unknown[] = [];
  for await (const chunk of answer) chunks.push(chunk);
  return chunks;
}
