import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../../src/chat-service";
import type { AgentSettings, ChatService, ChatServiceOptions } from "../../../src/chat-service";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import type { AgentWidgetSettings } from "../../../src/widgets/widget-types";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./mock-model";

export const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

export const CHOICE_INPUT = { question: "Какой тариф?", options: ["Базовый", "Про"] };

export const widgetCall = (toolCallId: string, toolName: string, input: unknown): LanguageModelV4StreamPart => ({
  type: "tool-call",
  toolCallId,
  toolName,
  input: JSON.stringify(input),
});

/** Шаг модели: вызовы и конец шага «tool-calls». */
export const step = (...calls: LanguageModelV4StreamPart[]): LanguageModelV4StreamPart[] => [streamStart, ...calls, finishPart("tool-calls")];

/** Модель: на каждый вызов берёт следующий сценарий (`Error` — запрос падает ею); после списка — короткий текст «Готово». */
export function scriptedModel(scripts: Array<LanguageModelV4StreamPart[] | Error>) {
  let call = 0;
  return mockModel(() => {
    const script = scripts[call++];
    if (script instanceof Error) throw script;
    return streamOf(script ?? [streamStart, ...textParts(["Готово"]), finishPart()]);
  });
}

export const removeTool = (execute = vi.fn(async ({ path }: { path: string }) => `удалено ${path}`)) =>
  tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute });

export interface WidgetChatSetup {
  widgets?: AgentWidgetSettings;
  agent?: Partial<AgentSettings>;
  storage?: ChatStorage;
  service?: Partial<ChatServiceOptions>;
}

export function widgetChat(scripts: Array<LanguageModelV4StreamPart[] | Error>, setup: WidgetChatSetup = {}) {
  const model = scriptedModel(scripts);
  const storage = setup.storage ?? createInMemoryChatStorage();
  const logError = vi.fn<(message: string) => void>();
  const build = (chatStorage: ChatStorage = storage, overrides: Partial<AgentSettings> = {}): ChatService =>
    createChatService({
      storage: chatStorage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", widgets: setup.widgets ?? { basic: true }, ...setup.agent, ...overrides },
      env: mockEnv,
      logError,
      ...setup.service,
    });
  return { model, storage, logError, build, service: build() };
}

export async function ask(service: ChatService, text = "помоги выбрать", id = "u1") {
  const chat = await service.createChat("anna");
  const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage(id, text)));
  return { chat, chunks };
}

export async function lastAnswer(service: ChatService, chatId: string) {
  const { messages } = await service.getHistory("anna", chatId);
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

export function toolPart(message: { parts: readonly unknown[] }, toolCallId: string) {
  return message.parts.find((part) => (part as { toolCallId?: string }).toolCallId === toolCallId) as
    | { type: string; state: string; input?: unknown; output?: unknown; errorText?: string }
    | undefined;
}

export const promptText = (model: ReturnType<typeof scriptedModel>, call: number) => JSON.stringify(model.doStreamCalls[call]!.prompt);

/** Ответ на виджет и чтение продолжения до конца. */
export async function answerAndFinish(service: ChatService, chatId: string, toolCallId: string, answer: unknown) {
  const result = await service.answerWidget({ chatId, ownerId: "anna", toolCallId, answer });
  if (result.resumed) await readAll((await service.subscribe("anna", chatId))!);
  return result;
}
