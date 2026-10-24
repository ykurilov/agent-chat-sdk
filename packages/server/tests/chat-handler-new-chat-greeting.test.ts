import { expect, it, vi } from "vitest";
import { createChatServer } from "../src/chat-handler";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { createTestChat } from "./support/test-chat";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";

it("HTTP creation uses server data, greets once, and GET/reload do not greet again", async () => {
  const afterTurn = vi.fn();
  const greeting = vi.fn(async ({ userId, chatData }: { userId: string; chatData: Record<string, unknown> | undefined }) => ({ instruction: `${userId}: ${chatData?.mode}` }));
  const server = createChatServer({
    basePath: "/api/chat", storage: createInMemoryChatStorage(), resolveUser: async () => ({ id: "anna" }),
    catalog: mockCatalog(), defaultChoice: { modelId: mockModelId, providerId: "mock" }, env: mockEnv,
    agent: { instructions: "Помощник" }, afterTurn,
    newChatData: async () => ({ mode: "interview" }), newChatGreeting: greeting,
  });
  const response = await server.handler.fetch(new Request("http://test/api/chat", { method: "POST", body: JSON.stringify({ greeting: { instruction: "forged" } }) }));
  expect(response.status).toBe(201);
  const { id } = await response.json();
  await vi.waitFor(() => expect(afterTurn).toHaveBeenCalledTimes(1));
  expect(greeting).toHaveBeenCalledExactlyOnceWith({ userId: "anna", chatData: { mode: "interview" } });
  for (let n = 0; n < 2; n++) {
    const history = await server.handler.fetch(new Request(`http://test/api/chat/${id}`));
    expect(history.status).toBe(200);
  }
  expect(greeting).toHaveBeenCalledTimes(1);
  expect(afterTurn).toHaveBeenCalledTimes(1);
  const history = await server.service.getHistory("anna", id);
  expect(history.messages.filter(m => m.role === "assistant")).toHaveLength(1);
  expect(JSON.stringify(history)).not.toContain("forged");
});

it("null opts out; resolver failures/invalid greetings and denied access do not create chats", async () => {
  for (const result of [null, undefined, false, [], { instruction: "" }, { instruction: 42 }, "invalid"]) {
    const { call, storage } = createTestChat({ newChatGreeting: async () => result as never });
    expect((await call("POST", "")).status).toBe(result === null ? 201 : 500);
    expect(await storage.listChats("anna")).toHaveLength(result === null ? 1 : 0);
  }
  const failing = createTestChat({ newChatGreeting: async () => { throw new Error("resolver"); } });
  expect((await failing.call("POST", "")).status).toBe(500);
  expect(await failing.storage.listChats("anna")).toEqual([]);
  const resolver = vi.fn(async () => ({ instruction: "Hi" }));
  const denied = createTestChat({ newChatGreeting: resolver });
  expect((await denied.call("POST", "", { user: null })).status).toBe(401);
  expect(resolver).not.toHaveBeenCalled();
});


it("a post-creation wake failure keeps the created chat and GET never retries the greeting", async () => {
  const logError = vi.fn();
  const beforeTurn = vi.fn(async () => { throw new Error("wake-refused"); });
  const resolve = vi.fn(async ({ chatData }: { chatData: Record<string, unknown> | undefined }) => {
    chatData!.mode = "changed-copy";
    return { instruction: "Hi" };
  });
  const { call, storage } = createTestChat({
    newChatData: async () => ({ mode: "interview" }), newChatGreeting: resolve,
    beforeTurn, logError,
  });
  const response = await call("POST", "");
  expect(response.status).toBe(201);
  const { id } = await response.json();
  expect((await storage.getChat(id))?.data).toEqual({ mode: "interview" });
  await call("GET", `/${id}`);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(beforeTurn).toHaveBeenCalledTimes(1);
  expect(logError).toHaveBeenCalled();
});
