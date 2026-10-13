import { describe, expect, it } from "vitest";
import { createNextRouteHandlers } from "../src/next";
import { createGate } from "./support/mock-catalog";
import { createTestChat, message } from "./support/test-chat";

const withList = () => createTestChat({ chatList: true });

describe("обработчик чата: список чатов включён", () => {
  it("GET {base} отдаёт чаты человека, самые недавние первыми, только id, название и времена", async () => {
    const { call, createChat } = withList();
    const first = await createChat();
    const second = await createChat();
    await createChat("boris");
    await (await call("POST", `/${first}/messages`, { body: message("u1", "Про Грецию") })).text();

    const response = await call("GET", "");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { chats: Array<Record<string, unknown>> };
    expect(body.chats.map((chat) => chat.id)).toEqual([first, second]);
    expect(body.chats[0]).toEqual({
      id: first,
      title: "Про Грецию",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(body.chats[1]).toMatchObject({ id: second, title: null });
  });

  it("новый человек — пустой список", async () => {
    const { call } = withList();
    expect(await (await call("GET", "", { user: "nobody" })).json()).toEqual({ chats: [] });
  });

  it("PATCH переименовывает: пробелы схлопываются, ответ — записанное; список это показывает", async () => {
    const { call, createChat } = withList();
    const chatId = await createChat();
    const response = await call("PATCH", `/${chatId}`, { body: { title: "  Отпуск \n в   Греции " } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: chatId, title: "Отпуск в Греции" });
    const list = (await (await call("GET", "")).json()) as { chats: Array<{ title: string }> };
    expect(list.chats[0]?.title).toBe("Отпуск в Греции");
  });

  it("PATCH с пустым, слишком длинным или не строковым названием и без тела — 400 invalid, название прежнее", async () => {
    const { call, createChat } = withList();
    const chatId = await createChat();
    await call("PATCH", `/${chatId}`, { body: { title: "Было" } });
    for (const body of [{ title: "   " }, { title: "я".repeat(101) }, { title: 42 }, {}, undefined, "текст"]) {
      const response = await call("PATCH", `/${chatId}`, { body });
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
      expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    }
    const list = (await (await call("GET", "")).json()) as { chats: Array<{ title: string }> };
    expect(list.chats[0]?.title).toBe("Было");
  });

  it("DELETE удаляет чат: 204, дальше чата нет ни в списке, ни по адресу; повтор — 404", async () => {
    const { call, createChat, storage } = withList();
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    const removed = await call("DELETE", `/${chatId}`);
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    expect(((await (await call("GET", "")).json()) as { chats: unknown[] }).chats).toEqual([]);
    expect((await call("GET", `/${chatId}`)).status).toBe(404);
    expect(await storage.listMessages(chatId)).toEqual([]);
    const again = await call("DELETE", `/${chatId}`);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: { kind: "not_found" } });
  });

  it("DELETE во время ответа останавливает его и удаляет чат", async () => {
    const gate = createGate();
    const { call, createChat, storage } = createTestChat({ chatList: true, gate: gate.wait });
    const chatId = await createChat();
    const answer = await call("POST", `/${chatId}/messages`, { body: message("u1", "Долгий вопрос") });
    expect(answer.status).toBe(200);
    const removed = call("DELETE", `/${chatId}`);
    gate.open();
    expect((await removed).status).toBe(204);
    await answer.text();
    expect(await storage.getChat(chatId)).toBeNull();
    expect(await storage.listMessages(chatId)).toEqual([]);
    expect(await storage.listStreamingMessageIds()).toEqual([]);
  });

  it("чужой и несуществующий чат: PATCH и DELETE — одинаковый 404, чужое не тронуто", async () => {
    const { call, createChat, storage } = withList();
    const chatId = await createChat();
    await call("PATCH", `/${chatId}`, { body: { title: "Моё" } });
    for (const method of ["PATCH", "DELETE"]) {
      const body = method === "PATCH" ? { title: "Взлом" } : undefined;
      const foreign = await call(method, `/${chatId}`, { user: "boris", body });
      const missing = await call(method, "/нет-такого", { user: "boris", body });
      expect(foreign.status).toBe(404);
      expect(foreign.status).toBe(missing.status);
      expect(await foreign.text()).toBe(await missing.text());
    }
    expect((await storage.getChat(chatId))?.title).toBe("Моё");
  });

  it("без человека все три адреса — 401", async () => {
    const { call, createChat } = withList();
    const chatId = await createChat();
    for (const [method, path] of [["GET", ""], ["PATCH", `/${chatId}`], ["DELETE", `/${chatId}`]] as const) {
      expect((await call(method, path, { user: null, body: method === "PATCH" ? { title: "x" } : undefined })).status).toBe(401);
    }
  });

  it("работает и через маршруты Next.js", async () => {
    const chat = withList();
    const routes = createNextRouteHandlers(chat.handler);
    const chatId = await chat.createChat();
    const url = `http://test.local/api/chat`;
    const headers = { "x-user": "anna", "content-type": "application/json" };
    expect((await routes.GET(new Request(url, { headers }))).status).toBe(200);
    expect((await routes.PATCH(new Request(`${url}/${chatId}`, { method: "PATCH", headers, body: JSON.stringify({ title: "Н" }) }))).status).toBe(200);
    expect((await routes.DELETE(new Request(`${url}/${chatId}`, { method: "DELETE", headers }))).status).toBe(204);
  });
});

describe("обработчик чата: список чатов не включён", () => {
  it("GET {base}, PATCH и DELETE — 404, как будто адресов нет; остальное работает по-старому", async () => {
    const { call, createChat, storage } = createTestChat();
    const chatId = await createChat();
    expect((await call("GET", "")).status).toBe(404);
    const renamed = await call("PATCH", `/${chatId}`, { body: { title: "Х" } });
    expect(renamed.status).toBe(404);
    expect((await call("DELETE", `/${chatId}`)).status).toBe(404);
    expect(await storage.getChat(chatId)).not.toBeNull();
    expect((await storage.getChat(chatId))?.title).toBeUndefined();
    expect((await call("GET", `/${chatId}`)).status).toBe(200);
    expect((await call("POST", "")).status).toBe(201);
  });
});
