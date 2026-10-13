import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { createChatService } from "../../../src/chat-service";
import type { ChatService, ChatServiceOptions } from "../../../src/chat-service";
import type { AgentNotice } from "../../../src/notices/agent-notice";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./mock-model";

export const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

export const saying = (value: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([value]), finishPart()];

export const callTool = (name: string, id: string, input: object = {}): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) },
  finishPart("tool-calls"),
];

/** Модель по сценарию: шаг за шагом, после сценария — «ответ N». */
export function scriptedModel(scripts: LanguageModelV4StreamPart[][] = []) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf(scripts[call++] ?? saying(`ответ ${call}`)) }),
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
}

/** Служба на модели-заглушке; `options.agent` дописывает настройки агента. */
export function noticeService(
  model: MockLanguageModelV4,
  options: Partial<Omit<ChatServiceOptions, "agent">> & { agent?: Partial<ChatServiceOptions["agent"]>; storage?: ChatStorage } = {},
) {
  const { agent, storage: given, ...rest } = options;
  const storage = given ?? createInMemoryChatStorage();
  const service: ChatService = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...agent },
    env: mockEnv,
    logError: () => {},
    ...rest,
  });
  return { service, storage };
}

export const doneNotice = (title: string, result: string, taskId = "t1"): AgentNotice => ({ kind: "task_done", taskId, title, result });

/** Тексты сообщения запроса к модели. */
export function textsOf(message: LanguageModelV4CallOptions["prompt"][number] | undefined): string[] {
  if (!message || typeof message.content === "string") return message ? [message.content as string] : [];
  return (message.content as Array<{ type: string; text?: string }>).filter((part) => part.type === "text").map((part) => part.text ?? "");
}

/** Тексты последнего сообщения человека в запросе. */
export function lastUserTexts(call: LanguageModelV4CallOptions): string[] {
  return textsOf(call.prompt.findLast((message) => message.role === "user"));
}

/** Имена инструментов запроса по порядку. */
export const toolNamesOf = (call: LanguageModelV4CallOptions): string[] => (call.tools ?? []).map((tool) => tool.name);

/** Новый чат и сообщение человека, ход дочитан. */
export async function askInNewChat(service: ChatService, text = "привет", options?: Parameters<ChatService["sendMessage"]>[3]) {
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", text), options));
  return chat;
}

/** Ждёт, пока ход в чате закончится (поток прочитан до конца). */
export async function waitTurn(service: ChatService, chatId: string, userId = "anna"): Promise<void> {
  const stream = await service.subscribe(userId, chatId);
  if (stream) await readAll(stream);
}
