import type { ModelCallEvent, ToolCallEvent } from "@ykurilov/agent-chat-core";

let counter = 0;

/** Обращение к модели с понятными значениями; поля можно подменить. */
export function modelCallEvent(overrides: Partial<ModelCallEvent> = {}): ModelCallEvent {
  counter += 1;
  return {
    callId: `call-${counter}`,
    chatId: "chat-1",
    ownerId: "sandbox:admin-1",
    messageId: "answer-1",
    purpose: "answer",
    attempt: 1,
    modelId: "test-model",
    providerId: "test-provider",
    request: {
      instructions: "Ты помощник. Отвечай коротко.",
      messages: [{ role: "user", content: [{ type: "text", text: "Привет" }] }],
      tools: [{ name: "search", description: "Поиск", inputSchema: { type: "object", properties: { q: { type: "string" } } } }],
      settings: { temperature: 0.2 },
    },
    response: { text: "Здравствуйте", reasoning: "", toolCalls: [], finishReason: "stop" },
    usage: { inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10, reasoningTokens: 0 },
    costUsd: 0.001,
    startedAt: new Date("2026-10-01T10:00:00.000Z"),
    firstChunkMs: 120,
    durationMs: 900,
    status: "complete",
    error: null,
    ...overrides,
  };
}

export function toolCallEvent(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  counter += 1;
  return {
    chatId: "chat-1",
    ownerId: "sandbox:admin-1",
    messageId: "answer-1",
    toolCallId: `tool-${counter}`,
    toolName: "search",
    input: { q: "погода" },
    output: { items: ["солнечно"] },
    error: null,
    startedAt: new Date("2026-10-01T10:00:01.000Z"),
    durationMs: 50,
    ...overrides,
  };
}

/** Сообщение пользователя или ассистента для `request.messages`. */
export function textMessage(role: "user" | "assistant", text: string): unknown {
  return { role, content: [{ type: "text", text }] };
}
