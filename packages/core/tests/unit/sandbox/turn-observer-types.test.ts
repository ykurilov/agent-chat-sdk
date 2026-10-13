import { describe, expect, expectTypeOf, it } from "vitest";
import type { AnswerEdit, AnswerEditErrorKind, ModelCallEvent, ModelCallPurpose, ToolCallEvent, TurnObserver } from "../../../src/index";

// Типы проверяет `pnpm typecheck` (тесты входят в tsconfig пакета): рантайм здесь только подтверждает, что файл выполнился.
describe("типы ядра для журнала песочницы и правки ответа", () => {
  it("ModelCallPurpose — шесть назначений обращения к модели", () => {
    expectTypeOf<ModelCallPurpose>().toEqualTypeOf<"answer" | "compaction" | "memory" | "title" | "helper" | "other">();
    expect(true).toBe(true);
  });

  it("ModelCallEvent: запрос, ответ, расход и исход обращения", () => {
    expectTypeOf<ModelCallEvent["messageId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<ModelCallEvent["purpose"]>().toEqualTypeOf<ModelCallPurpose>();
    expectTypeOf<ModelCallEvent["request"]["tools"]>().toEqualTypeOf<Array<{ name: string; description?: string; inputSchema: unknown }>>();
    expectTypeOf<ModelCallEvent["request"]["settings"]>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<ModelCallEvent["response"]["toolCalls"]>().toEqualTypeOf<Array<{ toolCallId: string; toolName: string; input: unknown }>>();
    expectTypeOf<ModelCallEvent["response"]["finishReason"]>().toEqualTypeOf<string | null>();
    expectTypeOf<ModelCallEvent["usage"]>().toEqualTypeOf<{
      inputTokens: number;
      cachedInputTokens: number;
      cacheWriteTokens: number;
      outputTokens: number;
      reasoningTokens: number;
    } | null>();
    expectTypeOf<ModelCallEvent["status"]>().toEqualTypeOf<"complete" | "error" | "aborted">();
    expectTypeOf<ModelCallEvent["startedAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<ModelCallEvent["firstChunkMs"]>().toEqualTypeOf<number | null>();
    const event: ModelCallEvent = {
      callId: "call-1",
      chatId: "c1",
      ownerId: "u1",
      messageId: "m1",
      purpose: "answer",
      attempt: 1,
      modelId: "claude-sonnet-5-5",
      providerId: "anthropic",
      request: { instructions: "Ты помощник", messages: [], tools: [{ name: "search", inputSchema: {} }], settings: { temperature: 0 } },
      response: { text: "Привет", reasoning: "", toolCalls: [], finishReason: "stop" },
      usage: null,
      costUsd: null,
      startedAt: new Date(0),
      firstChunkMs: null,
      durationMs: 10,
      status: "complete",
      error: null,
    };
    expect(event.purpose).toBe("answer");
  });

  it("ToolCallEvent: вход и результат, который увидит модель", () => {
    expectTypeOf<ToolCallEvent["messageId"]>().toEqualTypeOf<string>();
    expectTypeOf<ToolCallEvent["output"]>().toEqualTypeOf<unknown>();
    expectTypeOf<ToolCallEvent["error"]>().toEqualTypeOf<string | null>();
    expect(true).toBe(true);
  });

  it("TurnObserver: два синхронных метода без ожидания", () => {
    expectTypeOf<TurnObserver["modelCall"]>().toEqualTypeOf<(event: ModelCallEvent) => void>();
    expectTypeOf<TurnObserver["toolCall"]>().toEqualTypeOf<(event: ToolCallEvent) => void>();
    expect(true).toBe(true);
  });

  it("AnswerEdit: весь текст обязателен, результаты инструментов — по желанию", () => {
    expectTypeOf<AnswerEdit["text"]>().toEqualTypeOf<string>();
    expectTypeOf<AnswerEdit["toolOutputs"]>().toEqualTypeOf<Record<string, unknown> | undefined>();
    const textOnly: AnswerEdit = { text: "Новый ответ" };
    expect(textOnly.toolOutputs).toBeUndefined();
  });

  it("AnswerEditErrorKind — восемь отказов правки ответа", () => {
    expectTypeOf<AnswerEditErrorKind>().toEqualTypeOf<
      | "chat_not_found"
      | "message_not_found"
      | "not_an_answer"
      | "answer_busy"
      | "not_on_current_branch"
      | "empty_text"
      | "invalid_tool_output"
      | "nothing_changed"
    >();
    expect(true).toBe(true);
  });
});
