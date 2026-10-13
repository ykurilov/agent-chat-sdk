import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { TurnFinished } from "@ykurilov/agent-chat-core";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { catalogWithModel, createGate, mockModelId, usage } from "./support/mock-catalog";
import { parseSse } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

/** Модель, которая отвечает текстом или падает с ошибкой провайдера. */
function modelThat(step: { text: string } | { fail: number }): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      if ("fail" in step) {
        throw new APICallError({ message: "ключ не подходит", url: "https://provider.test", requestBodyValues: {}, statusCode: step.fail, isRetryable: false });
      }
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: step.text });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        },
      });
      return { stream };
    },
  });
}

/** Отправляет вопрос и читает поток до конца; возвращает id ответа из куска `start`. */
async function ask(call: ReturnType<typeof createTestChat>["call"], chatId: string): Promise<string> {
  const chunks = parseSse(await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text());
  return chunks.find((chunk) => chunk.type === "start")?.messageId as string;
}

describe("обработчик чата: onTurnFinished — ход закончен", () => {
  it("законченный ответ: один вызов с человеком, чатом, id ответа, итогом, моделью и провайдером", async () => {
    const onTurnFinished = vi.fn<(turn: TurnFinished) => void>();
    const { call, createChat } = createTestChat({ catalog: catalogWithModel(modelThat({ text: "Готово" })), onTurnFinished });
    const chatId = await createChat();
    const messageId = await ask(call, chatId);
    await vi.waitFor(() => expect(onTurnFinished).toHaveBeenCalledTimes(1));
    expect(onTurnFinished).toHaveBeenCalledWith({ userId: "anna", chatId, messageId, status: "complete", modelId: mockModelId, providerId: "mock" });
  });

  it("ответ с ошибкой провайдера: итог error", async () => {
    const onTurnFinished = vi.fn<(turn: TurnFinished) => void>();
    const { call, createChat } = createTestChat({ catalog: catalogWithModel(modelThat({ fail: 401 })), onTurnFinished });
    const chatId = await createChat();
    const messageId = await ask(call, chatId);
    await vi.waitFor(() => expect(onTurnFinished).toHaveBeenCalledTimes(1));
    expect(onTurnFinished.mock.calls[0]![0]).toMatchObject({ chatId, messageId, status: "error" });
  });

  it("остановленный ответ: итог stopped", async () => {
    const gate = createGate();
    const onTurnFinished = vi.fn<(turn: TurnFinished) => void>();
    const { call, createChat } = createTestChat({ gate: gate.wait, onTurnFinished });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const reader = response.body!.getReader();
    await reader.read();
    expect((await call("POST", `/${chatId}/stop`)).status).toBe(202);
    while (!(await reader.read()).done);
    await vi.waitFor(() => expect(onTurnFinished).toHaveBeenCalledTimes(1));
    expect(onTurnFinished.mock.calls[0]![0]).toMatchObject({ chatId, status: "stopped" });
  });

  it.each([
    ["бросает", () => {
      throw new Error("приложение упало");
    }],
    ["отклоняет обещание", () => Promise.reject(new Error("приложение упало"))],
  ])("обработчик %s: ход закончен как обычно, сбой — в журнал сервера", async (_, onTurnFinished) => {
    const logError = vi.fn();
    const { call, createChat, history } = createTestChat({ catalog: catalogWithModel(modelThat({ text: "Готово" })), onTurnFinished, logError });
    const chatId = await createChat();
    await ask(call, chatId);
    expect((await history(chatId)).messages.at(-1)?.metadata?.status).toBe("complete");
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("приложение упало")));
  });
});
