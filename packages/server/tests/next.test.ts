import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createNextRouteHandlers } from "../src/next";
import { fakeMemory } from "./support/fake-memory";
import { createGate } from "./support/mock-catalog";
import { readUntil, readAll } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

const address = "http://test.local/api/chat";
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

function routeFor(options: Parameters<typeof createTestChat>[0] = {}) {
  const chat = createTestChat(options);
  const routes = createNextRouteHandlers(chat.handler);
  const call = (method: (typeof methods)[number], path: string, init: { body?: unknown; user?: string | null } = {}) =>
    routes[method](
      new Request(`${address}${path}`, {
        method,
        headers: {
          ...(init.user !== null && { "x-user": init.user ?? "anna" }),
          ...(init.body !== undefined && { "content-type": "application/json" }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      }),
    );
  return { ...chat, routes, call };
}

describe("createNextRouteHandlers", () => {
  it("отдаёт все семь методов", () => {
    const { routes } = routeFor();
    expect(Object.keys(routes).sort()).toEqual([...methods].sort());
    for (const method of methods) expect(typeof routes[method]).toBe("function");
  });

  it("адреса /memory доходят до обработчика: создание, чтение, стирание", async () => {
    const { call } = routeFor({ memory: fakeMemory().memory });
    const created = await call("POST", "/memory", { body: { categories: ["О себе"], content: "Пишет на TypeScript" } });
    expect(created.status).toBe(201);
    expect(await (await call("GET", "/memory")).json()).toMatchObject({ counts: { total: 1 } });
    expect(await (await call("DELETE", "/memory")).json()).toEqual({ deleted: 1 });
    expect((await routeFor().call("GET", "/memory")).status).toBe(404);
  });

  it("создаёт чат и отдаёт историю", async () => {
    const { call } = routeFor();
    const created = await call("POST", "");
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const history = await call("GET", `/${id}`);
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ chat: { id }, messages: [], running: false });
  });

  it("ответ идёт по частям: первый кусок приходит, пока модель ещё ждёт", async () => {
    const gate = createGate();
    const { call, createChat, routes } = routeFor({ gate: gate.wait });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const reader = response.body!.getReader();
    const seen = await readUntil(reader, '"type":"start"');
    expect(seen).toContain('"type":"start"');
    gate.open();
    const parts = await readAll(reader, seen);
    expect(parts.map((part) => part.type)).toContain("finish");
    expect(routes.GET).toBeDefined();
  });

  it("остановка через POST …/stop прерывает ответ", async () => {
    const gate = createGate();
    const { call, createChat, history } = routeFor({ gate: gate.wait });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const reader = response.body!.getReader();
    await readUntil(reader, '"type":"start"');
    const stopped = await call("POST", `/${chatId}/stop`);
    expect(stopped.status).toBeLessThan(300);
    gate.open();
    await readAll(reader).catch(() => []);
    const { messages, running } = await history(chatId);
    expect(running).toBe(false);
    expect(messages.at(-1)).toMatchObject({ role: "assistant", metadata: { status: "stopped" } });
  });

  it("без пользователя — 401, чужой чат — 404", async () => {
    const { call, createChat } = routeFor();
    const chatId = await createChat();
    expect((await call("GET", `/${chatId}`, { user: null })).status).toBe(401);
    const foreign = await call("GET", `/${chatId}`, { user: "boris" });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: { kind: "not_found" } });
  });

  it("модуль не тянет next и hono", () => {
    const source = readFileSync(new URL("../src/next.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'](next|hono)(\/|["'])/);
  });
});
