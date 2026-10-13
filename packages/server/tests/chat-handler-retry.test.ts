import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { AgentChatMessage } from "@ykurilov/agent-chat-core";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { catalogWithModel, createGate, usage } from "./support/mock-catalog";
import { parseSse } from "./support/sse";
import { createTestChat, message, seedUnfinishedAnswer } from "./support/test-chat";

/** Что модель делает на очередном ходе. */
type Step = { text: string } | { fail: number } | { empty: true } | { held: string; gate: () => Promise<void> };

function streamFor(step: Step): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    async start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      if ("text" in step || "held" in step) {
        controller.enqueue({ type: "text-start", id: "t" });
        controller.enqueue({ type: "text-delta", id: "t", delta: "text" in step ? step.text : step.held });
        if ("gate" in step) await step.gate();
        controller.enqueue({ type: "text-end", id: "t" });
      }
      controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
      controller.close();
    },
  });
}

/** Модель, которая на каждом ходе делает следующий шаг сценария. */
function scriptedModel(steps: Step[]): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const step = steps[Math.min(call++, steps.length - 1)]!;
      if ("fail" in step) {
        throw new APICallError({
          message: "ключ не подходит",
          url: "https://provider.test",
          requestBodyValues: {},
          statusCode: step.fail,
          isRetryable: false,
        });
      }
      const stream = streamFor(step);
      abortSignal?.addEventListener("abort", () => void stream.cancel().catch(() => {}));
      return { stream };
    },
  });
}

const setup = (steps: Step[]) => createTestChat({ catalog: catalogWithModel(scriptedModel(steps)) });

const textOf = (message: AgentChatMessage | undefined) =>
  (message?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");

describe("обработчик чата: «повторить»", () => {
  it.each([
    ["ошибки", [{ fail: 401 }, { text: "Второй ответ" }]],
    ["пустого ответа", [{ empty: true }, { text: "Второй ответ" }]],
  ] as Array<[string, Step[]]>)("после %s — новое сообщение агента с тем же родителем, вопрос не копируется", async (_, steps) => {
    const { call, createChat, history, storage } = setup(steps);
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    const [, failed] = (await history(chatId)).messages;

    const response = await call("POST", `/${chatId}/retry`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const chunks = parseSse(await response.text());
    const start = chunks.find((chunk) => chunk.type === "start");
    expect(start?.messageId).toEqual(expect.any(String));
    expect(start?.messageId).not.toBe(failed?.id);
    expect(chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta)).toEqual(["Второй ответ"]);

    const after = await history(chatId);
    expect(after.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(after.messages[0]?.id).toBe("u1");
    expect(after.messages[1]?.id).toBe(start?.messageId);
    expect(textOf(after.messages[1])).toBe("Второй ответ");
    expect(after.messages[1]?.metadata?.status).toBe("complete");

    // Прежний ответ не удалён — это соседняя ветка того же вопроса.
    const stored = await storage.listMessages(chatId);
    expect(stored.filter((m) => m.role === "user")).toHaveLength(1);
    const answers = stored.filter((m) => m.role === "assistant");
    expect(answers).toHaveLength(2);
    expect(answers.every((answer) => answer.parentId === "u1")).toBe(true);
  });

  it("после «стоп» — повтор разрешён", async () => {
    const gate = createGate();
    const { call, createChat, history } = setup([{ held: "Нач", gate: gate.wait }, { text: "Заново" }]);
    const chatId = await createChat();
    const sending = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect((await call("POST", `/${chatId}/stop`)).status).toBe(202);
    await sending.text();
    gate.open();
    expect((await history(chatId)).messages[1]?.metadata?.status).toBe("stopped");

    const response = await call("POST", `/${chatId}/retry`);
    expect(response.status).toBe(200);
    await response.text();
    const after = await history(chatId);
    expect(after.messages).toHaveLength(2);
    expect(textOf(after.messages[1])).toBe("Заново");
  });

  it("после прерванного перезапуском ответа — повтор разрешён", async () => {
    const { call, createChat, history, handler, storage } = setup([{ text: "После перезапуска" }]);
    const chatId = await createChat();
    await seedUnfinishedAnswer(storage, chatId, "a-old", "Недописан");
    await handler.recoverInterruptedAnswers();
    expect((await history(chatId)).messages[1]?.metadata?.status).toBe("interrupted");

    const response = await call("POST", `/${chatId}/retry`);
    expect(response.status).toBe(200);
    await response.text();
    const after = await history(chatId);
    expect(after.messages.map((m) => m.id)[0]).toBe("u1");
    expect(after.messages[1]?.id).not.toBe("a-old");
    expect(textOf(after.messages[1])).toBe("После перезапуска");
  });

  it("после законченного непустого ответа — 409 invalid", async () => {
    const { call, createChat } = setup([{ text: "Готово" }]);
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    const response = await call("POST", `/${chatId}/retry`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
  });

  it("в пустом чате — 409 invalid", async () => {
    const { call, createChat } = setup([{ text: "Готово" }]);
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/retry`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
  });

  it("во время хода — 409 busy", async () => {
    const gate = createGate();
    const { call, createChat } = setup([{ held: "Пишу", gate: gate.wait }]);
    const chatId = await createChat();
    const sending = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const response = await call("POST", `/${chatId}/retry`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "busy" } });
    gate.open();
    await sending.text();
  });
});
