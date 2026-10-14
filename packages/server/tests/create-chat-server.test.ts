import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ModelCallEvent } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createChatServer } from "../src/index";
import type { ChatHandlerOptions } from "../src/index";
import { catalogWithModel, mockEnv, mockModelId, usage } from "./support/mock-catalog";

const base = "http://test.local/api/chat";

function answeringModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "ответ" });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        },
      }),
    }),
  });
}

function server(extra: Partial<ChatHandlerOptions> = {}) {
  const model = answeringModel();
  const created = createChatServer({
    basePath: "/api/chat",
    storage: createInMemoryChatStorage(),
    resolveUser: async () => ({ id: "anna" }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    catalog: catalogWithModel(model),
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    logError: () => {},
    ...extra,
  });
  const send = async (chatId: string) =>
    (
      await created.handler.fetch(
        new Request(`${base}/${chatId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: { id: "u1", role: "user", parts: [{ type: "text", text: "привет" }] } }),
        }),
      )
    ).text();
  return { ...created, model, send };
}

describe("createChatServer: обработчик и служба вместе", () => {
  it("служба та же, что у обработчика: чат, созданный службой, отвечает через HTTP", async () => {
    const { handler, service, send } = server();
    const chat = await service.createChat("anna");
    await send(chat.id);
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(handler.basePath).toBe("/api/chat");
  });

  it("turnObserver и chatInstructions доходят до службы", async () => {
    const events: ModelCallEvent[] = [];
    const { service, model, send } = server({
      turnObserver: { modelCall: (event) => events.push(event), toolCall: () => {} },
      chatInstructions: async () => "Песочная инструкция.",
    });
    const chat = await service.createChat("anna");
    await send(chat.id);
    expect(model.doStreamCalls[0]!.prompt[0]).toEqual({ role: "system", content: "Песочная инструкция." });
    expect(events).toEqual([expect.objectContaining({ chatId: chat.id, purpose: "answer", status: "complete" })]);
  });

  it("replyChecks и now доходят до службы (061 этап 7)", async () => {
    const seenNow: Date[] = [];
    const fixed = new Date("2026-03-02T06:00:00.000Z");
    const { service, send } = server({
      agent: { instructions: "Ты помощник.", prepareTurn: (context) => void seenNow.push(context.now) },
      replyChecks: [async ({ text }) => ({ text: text.replace("ответ", "исправлено") })],
      now: () => fixed,
    });
    expect(service.checksReplies).toBe(true);
    const chat = await service.createChat("anna");
    await send(chat.id);
    expect(seenNow).toEqual([fixed]);
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual(["исправлено"]);
  });

  it("без replyChecks служба не проверяет ответы", () => {
    expect(server().service.checksReplies).toBe(false);
  });
});
