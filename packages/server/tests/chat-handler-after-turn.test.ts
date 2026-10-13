import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { AfterTurnHandler } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createChatServer } from "../src/chat-handler";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";
import { parseSse, readUntil } from "./support/sse";
import { message } from "./support/test-chat";

const base = "http://test.local/api/chat";

function createServer(options: Partial<ChatHandlerOptions> = {}) {
  const storage = options.storage ?? createInMemoryChatStorage();
  const server = createChatServer({
    basePath: "/api/chat",
    resolveUser: async (request) => ({ id: request.headers.get("x-user") ?? "anna" }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    catalog: mockCatalog(),
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    ...options,
    storage,
  });
  const call = (method: string, path: string, body?: unknown) =>
    server.handler.fetch(
      new Request(`${base}${path}`, {
        method,
        headers: { "x-user": "anna", ...(body !== undefined && { "content-type": "application/json" }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  const createChat = async () => ((await (await call("POST", "")).json()) as { id: string }).id;
  return { ...server, storage, call, createChat };
}

describe("обработчик чата: afterTurn и события приложения", () => {
  it("afterTurn из опций сервера: события хука в потоке до finish и в истории", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>(() => ({ events: [{ type: "lesson_passed", data: { lesson: 1 } }] }));
    const server = createServer({ afterTurn, afterTurnTimeoutMs: 1000, afterTurnAttempts: 1 });
    const chatId = await server.createChat();
    const chunks = parseSse(await (await server.call("POST", `/${chatId}/messages`, message("u1", "зачёт"))).text());
    const types = chunks.map((chunk) => chunk.type);
    expect(types).toContain("data-app-event");
    expect(types.indexOf("data-app-event")).toBeLessThan(types.indexOf("finish"));
    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "anna", chatId, trigger: "send", status: "complete" }));

    const history = (await (await server.call("GET", `/${chatId}`)).json()) as { messages: Array<{ role: string; parts: Array<{ type: string }> }> };
    const answer = history.messages.find((item) => item.role === "assistant")!;
    expect(answer.parts.at(-1)).toEqual({ type: "data-app-event", data: { type: "lesson_passed", data: { lesson: 1 } } });
  });

  it("publishAppEvent: открытый watch получает app-event без владельца", async () => {
    const server = createServer();
    const chatId = await server.createChat();
    const reader = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    await server.service.publishAppEvent({ ownerId: "anna", chatId, event: { type: "payment_done", data: { sum: 100 } } });
    const seen = await readUntil(reader, '"app-event"');
    await reader.cancel();
    expect(parseSse(seen)).toEqual([{ type: "app-event", chatId, event: { type: "payment_done", data: { sum: 100 } } }]);
  });
});
