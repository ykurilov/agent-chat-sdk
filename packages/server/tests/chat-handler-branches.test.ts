import type { AgentChatMessage } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { catalogWithModel, createGate, usage } from "./support/mock-catalog";
import { parseSse } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

/** Модель отвечает «ответ N» по порядку вызовов. */
function numberedModel(gate?: () => Promise<void>): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1;
      const text = `ответ ${call}`;
      return {
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "t" });
            controller.enqueue({ type: "text-delta", id: "t", delta: text });
            if (gate) await gate();
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
            controller.close();
          },
        }),
      };
    },
  });
}

const textOf = (m: AgentChatMessage | undefined) => (m?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");

type Full = { messages: AgentChatMessage[]; forks: Array<{ messageId: string; siblingIds: string[] }> };

async function chatWithOneTurn(gate?: () => Promise<void>) {
  const context = createTestChat({ catalog: catalogWithModel(numberedModel(gate)) });
  const chatId = await context.createChat();
  await (await context.call("POST", `/${chatId}/messages`, { body: message("u1", "привет") })).text();
  const full = async () => (await (await context.call("GET", `/${chatId}`)).json()) as Full;
  return { ...context, chatId, full };
}

describe("обработчик чата: ветки", () => {
  it("POST /:chatId/regenerate — новый ответ-сосед, поток; forks в GET /:chatId и GET /:chatId/branches", async () => {
    const { call, chatId, full } = await chatWithOneTurn();
    const [, answer] = (await full()).messages;

    const response = await call("POST", `/${chatId}/regenerate`, { body: { messageId: answer!.id } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const chunks = parseSse(await response.text());
    const fresh = chunks.find((chunk) => chunk.type === "start")?.messageId as string;
    expect(fresh).not.toBe(answer!.id);

    const after = await full();
    expect(textOf(after.messages[1])).toBe("ответ 2");
    expect(after.forks).toEqual([{ messageId: fresh, siblingIds: [answer!.id, fresh] }]);
    const light = await (await call("GET", `/${chatId}/branches`)).json();
    expect(light).toEqual({ forks: after.forks });
  });

  it("POST /:chatId/branch — переключает и отдаёт историю новой ветки", async () => {
    const { call, chatId, full } = await chatWithOneTurn();
    const [, answer] = (await full()).messages;
    await (await call("POST", `/${chatId}/regenerate`, { body: { messageId: answer!.id } })).text();

    const response = await call("POST", `/${chatId}/branch`, { body: { messageId: answer!.id } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Full;
    expect(textOf(body.messages[1])).toBe("ответ 1");
    expect(body.forks[0]?.messageId).toBe(answer!.id);
    expect(textOf((await full()).messages[1])).toBe("ответ 1");
  });

  it("POST /:chatId/edit — новый вопрос рядом с прежним и ответ на него", async () => {
    const { call, chatId, full, storage } = await chatWithOneTurn();
    const response = await call("POST", `/${chatId}/edit`, {
      body: { editedMessageId: "u1", ...message("u1-v2", "здравствуй") },
    });
    expect(response.status).toBe(200);
    await response.text();

    const after = await full();
    expect(after.messages.map((m) => m.id)[0]).toBe("u1-v2");
    expect(textOf(after.messages[1])).toBe("ответ 2");
    expect(after.forks).toEqual([{ messageId: "u1-v2", siblingIds: ["u1", "u1-v2"] }]);
    expect(await storage.listMessages(chatId)).toHaveLength(4);
  });

  it("плохие тела и сообщения — 400 invalid; чужой чат — 404; идущий ответ — 409 busy", async () => {
    const gate = createGate();
    const { call, chatId, full } = await chatWithOneTurn();
    const [question] = (await full()).messages;
    expect((await call("POST", `/${chatId}/regenerate`, { body: {} })).status).toBe(400);
    expect((await call("POST", `/${chatId}/regenerate`, { body: { messageId: question!.id } })).status).toBe(400);
    expect((await call("POST", `/${chatId}/branch`, { body: { messageId: "нет-такого" } })).status).toBe(400);
    expect((await call("POST", `/${chatId}/edit`, { body: { message: message("x", "текст").message } })).status).toBe(400);
    expect((await call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("x", "  ") } })).status).toBe(400);
    expect((await call("POST", `/${chatId}/branch`, { user: "boris", body: { messageId: "u1" } })).status).toBe(404);
    expect((await call("GET", `/${chatId}/branches`, { user: "boris" })).status).toBe(404);

    const busy = createTestChat({ catalog: catalogWithModel(numberedModel(gate.wait)) });
    const busyId = await busy.createChat();
    const running = await busy.call("POST", `/${busyId}/messages`, { body: message("u1", "привет") });
    for (const [path, body] of [
      ["branch", { messageId: "u1" }],
      ["regenerate", { messageId: "u1" }],
      ["edit", { editedMessageId: "u1", ...message("u1-v2", "иначе") }],
    ] as const) {
      expect((await busy.call("POST", `/${busyId}/${path}`, { body })).status).toBe(409);
    }
    gate.open();
    await running.text();
  });
});
