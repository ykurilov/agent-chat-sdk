import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { describe, expect, it } from "vitest";
import { mountChat } from "../src/hono";
import { fakeMemory } from "./support/fake-memory";
import { createTestChat } from "./support/test-chat";

const handlerForAnna = () => createTestChat({ resolveUser: async () => ({ id: "anna" }) }).handler;

function appWithChat() {
  const app = new Hono();
  app.get("/health", (c) => c.text("ok"));
  mountChat(app, handlerForAnna());
  return app;
}

describe("mountChat", () => {
  it("передаёт обработчику сам basePath и всё под ним", async () => {
    const app = appWithChat();
    const created = await app.request("/api/chat", { method: "POST" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const history = await app.request(`/api/chat/${id}`);
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ chat: { id }, messages: [], running: false });
  });

  it("сохраняет заголовки и cookie, выставленные промежуточным обработчиком приложения до чата", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      setCookie(c, "session", "renewed", { path: "/" });
      c.header("X-Request-Id", "42");
      await next();
    });
    mountChat(app, handlerForAnna());

    const created = await app.request("/api/chat", { method: "POST" });
    expect(created.status).toBe(201);
    expect(created.headers.get("set-cookie")).toBe("session=renewed; Path=/");
    expect(created.headers.get("x-request-id")).toBe("42");
    expect(created.headers.get("content-type")).toContain("application/json");
    expect(await created.json()).toMatchObject({ id: expect.any(String) });
  });

  it("не трогает чужие адреса приложения", async () => {
    const app = appWithChat();
    expect(await (await app.request("/health")).text()).toBe("ok");
    expect((await app.request("/api/other")).status).toBe(404);
  });

  it("адреса /memory доходят до обработчика; без memory их нет", async () => {
    const withMemory = new Hono();
    mountChat(withMemory, createTestChat({ resolveUser: async () => ({ id: "anna" }), memory: fakeMemory().memory }).handler);
    const created = await withMemory.request("/api/chat/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categories: ["О себе"], content: "Пишет на TypeScript" }),
    });
    expect(created.status).toBe(201);
    expect(await (await withMemory.request("/api/chat/memory")).json()).toMatchObject({ counts: { total: 1 } });
    expect((await appWithChat().request("/api/chat/memory")).status).toBe(404);
  });
});
