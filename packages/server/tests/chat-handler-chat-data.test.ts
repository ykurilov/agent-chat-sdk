import { describe, expect, it, vi } from "vitest";
import { createChatServer } from "../src/chat-handler";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";
import { parseSse, readUntil } from "./support/sse";
import { createTestChat } from "./support/test-chat";

type NewChatData = NonNullable<ChatHandlerOptions["newChatData"]>;

describe("обработчик чата: данные нового чата (newChatData)", () => {
  it("POST {base} создаёт чат с данными, которые поставил сервер; в ответе и в истории данных нет", async () => {
    const newChatData = vi.fn<NewChatData>(async ({ request }) => ({ formId: new URL(request.url).searchParams.get("form") ?? "none", mode: "test" }));
    const { call, storage, history } = createTestChat({ newChatData });
    const response = await call("POST", "?form=f1");
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(Object.keys(body)).toEqual(["id"]);
    expect(newChatData).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "anna" }, request: expect.any(Request) }));
    expect((await storage.getChat(body.id))?.data).toEqual({ formId: "f1", mode: "test" });
    expect(JSON.stringify(await history(body.id))).not.toContain("formId");
  });

  it("newChatData на хранилище без updateChatData — понятная ошибка при создании обработчика, а не потерянные данные", () => {
    const { updateChatData: _unused, ...withoutUpdate } = createInMemoryChatStorage();
    expect(() => createTestChat({ newChatData: async () => ({ mode: "test" }), storage: withoutUpdate as never })).toThrow(/newChatData.*updateChatData/);
    expect(() => createTestChat({ storage: withoutUpdate as never })).not.toThrow();
  });

  it("данных из браузера не берёт: тело запроса игнорируется", async () => {
    const { call, storage } = createTestChat({ newChatData: async () => ({ mode: "test" }) });
    const { id } = (await (await call("POST", "", { body: { data: { mode: "live", hacked: true } } })).json()) as { id: string };
    expect((await storage.getChat(id))?.data).toEqual({ mode: "test" });
  });

  it("newChatData ничего не вернул — чат без данных; без newChatData — как раньше", async () => {
    const empty = createTestChat({ newChatData: async () => undefined });
    const { id } = (await (await empty.call("POST", "")).json()) as { id: string };
    expect(await empty.storage.getChat(id)).not.toHaveProperty("data");
    const plain = createTestChat();
    const { id: plainId } = (await (await plain.call("POST", "")).json()) as { id: string };
    expect(await plain.storage.getChat(plainId)).not.toHaveProperty("data");
  });

  it("newChatData вернул не объект — 500, запись в журнале, чат не создан", async () => {
    for (const answer of ["форма", 7, [], null]) {
      const logError = vi.fn();
      const { call, storage } = createTestChat({ newChatData: async () => answer as never, logError });
      const response = await call("POST", "");
      expect({ answer, status: response.status }).toEqual({ answer, status: 500 });
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("newChatData"));
      expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
    }
  });

  it("исключение в newChatData — 500, чат не создан", async () => {
    const logError = vi.fn();
    const { call, storage } = createTestChat({
      newChatData: async () => {
        throw new Error("сбой приложения");
      },
      logError,
    });
    expect((await call("POST", "")).status).toBe(500);
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
  });
});

describe("обработчик чата: событие chat-data-changed", () => {
  it("вкладке по watch оно не уходит: данные чата остаются на сервере", async () => {
    const storage = createInMemoryChatStorage();
    const server = createChatServer({
      basePath: "/api/chat",
      resolveUser: async (request) => ({ id: request.headers.get("x-user") ?? "anna" }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      catalog: mockCatalog(),
      agent: { instructions: "Ты помощник." },
      env: mockEnv,
      storage,
    });
    const send = (method: string, path: string) => server.handler.fetch(new Request(`http://test.local/api/chat${path}`, { method, headers: { "x-user": "anna" } }));
    const { id } = (await (await send("POST", "")).json()) as { id: string };
    const reader = (await send("GET", `/${id}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    await server.service.updateChatData("anna", id, { secret: "тайна" });
    await server.service.publishAppEvent({ ownerId: "anna", chatId: id, event: { type: "marker" } });
    const seen = await readUntil(reader, '"marker"');
    await reader.cancel();
    expect(parseSse(seen).map((event) => event.type)).toEqual(["app-event"]);
    expect(seen).not.toContain("chat-data-changed");
    expect(seen).not.toContain("тайна");
  });
});
