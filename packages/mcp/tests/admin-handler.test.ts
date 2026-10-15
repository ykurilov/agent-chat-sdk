import { describe, expect, it } from "vitest";
import { createMcpAdminHandler } from "../src/index";
import { setupMcp } from "./support/setup";

const TOKEN = "tok-SECRET-91b2";
const URL_KEY = "url-key-7f3a9c";
const ORIGIN = "https://app.example.com";

async function setupHandler() {
  const setup = await setupMcp();
  const handler = createMcpAdminHandler({
    mcp: setup.mcp,
    // Кто спрашивает — из заголовка теста; так в приложении работает cookie сессии.
    resolveUser: async (request) => {
      const id = request.headers.get("x-user");
      return id ? { id } : null;
    },
  });
  const send = async (user: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: ORIGIN, host: "app.example.com" };
    if (user) headers["x-user"] = user;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await handler.fetch(new Request(`${ORIGIN}/api/mcp${path}`, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) }));
    const text = await response.text();
    return { status: response.status, text, json: text ? JSON.parse(text) : null, headers: response.headers };
  };
  return { ...setup, handler, send };
}

const newServer = { name: "DeepWiki", prefix: "deepwiki", url: `https://mcp.example.com/mcp?key=${URL_KEY}`, headers: { Authorization: `Bearer ${TOKEN}` }, status: "everyone" };

describe("адреса экрана админа", () => {
  it("тело больше предела — 400, читается не больше предела: бесконечный поток не держит запрос", async () => {
    const { handler } = await setupHandler();
    let pulled = 0;
    // «Бесконечный» для обработчика, но с потолком: если предел сломается, тест упадёт на `pulled`, а не съест всю память
    // (15.10 такой поток без потолка раздул процесс тестов до 97 ГБ).
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 1024 * 1024) return controller.close();
        pulled += 16 * 1024;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
    });
    const request = new Request(`${ORIGIN}/api/mcp/servers`, { method: "POST", headers: { origin: ORIGIN, "x-user": "boss", "content-type": "application/json" }, body: endless, duplex: "half" } as RequestInit);
    const response = await handler.fetch(request);
    expect(response.status).toBe(400);
    expect(pulled).toBeLessThanOrEqual(128 * 1024);

    const declared = new Request(`${ORIGIN}/api/mcp/servers`, { method: "POST", headers: { origin: ORIGIN, "x-user": "boss", "content-type": "application/json", "content-length": String(10 * 1024 * 1024) }, body: "{}" });
    expect((await handler.fetch(declared)).status).toBe(400);
  });

  it("многобайтные знаки считаются байтами, а не знаками", async () => {
    const { send } = await setupHandler();
    const answer = await send("boss", "POST", "/servers", { ...newServer, name: "я".repeat(40 * 1024) });
    expect(answer.status).toBe(400);
    expect(answer.json.error.message).toMatch(/Слишком большой/);
  });

  it("не-админ и не вошедший получают 404 на любом адресе — как будто экрана нет", async () => {
    const { send } = await setupHandler();
    for (const user of ["anna", null]) {
      expect((await send(user, "GET", "/servers")).status).toBe(404);
      expect((await send(user, "POST", "/servers", newServer)).status).toBe(404);
      expect((await send(user, "GET", "/calls")).status).toBe(404);
    }
  });

  it("админ: добавить, список, переключить инструмент, статус, проверить, обновить, журнал, удалить", async () => {
    const { send, fake } = await setupHandler();
    const added = await send("boss", "POST", "/servers", newServer);
    expect(added.status).toBe(201);
    const id = added.json.server.id as string;
    expect(added.json.server).toMatchObject({ name: "DeepWiki", displayUrl: "https://mcp.example.com/mcp", urlHasHiddenParts: true, headerNames: ["Authorization"] });

    const toggled = await send("boss", "PATCH", `/servers/${id}/tools/ask_question`, { enabled: true, needsApproval: true });
    expect(toggled.json.server.tools.find((tool: { name: string }) => tool.name === "ask_question")).toMatchObject({ enabled: true, needsApproval: true });

    expect((await send("boss", "PATCH", `/servers/${id}`, { status: "admins" })).json.server.status).toBe("admins");
    expect((await send("boss", "POST", `/servers/${id}/check`)).json.check).toMatchObject({ ok: true, matchesSnapshot: true });
    fake.tools = [...fake.tools, { name: "new_tool", inputSchema: { type: "object" } }];
    const refreshed = await send("boss", "POST", `/servers/${id}/refresh`);
    expect(refreshed.json.server.tools.map((tool: { name: string }) => tool.name)).toContain("new_tool");
    expect((await send("boss", "GET", "/servers")).json.servers).toHaveLength(1);
    expect((await send("boss", "GET", `/calls?serverId=${id}&limit=10`)).json.calls).toEqual([]);
    expect((await send("boss", "DELETE", `/servers/${id}`)).status).toBe(200);
    expect((await send("boss", "GET", "/servers")).json.servers).toEqual([]);
  });

  it("секретов нет ни в одном ответе; ответы не кэшируются", async () => {
    const { send } = await setupHandler();
    const added = await send("boss", "POST", "/servers", newServer);
    const id = added.json.server.id as string;
    const texts = [
      added.text,
      (await send("boss", "GET", "/servers")).text,
      (await send("boss", "GET", `/servers/${id}`)).text,
      (await send("boss", "PATCH", `/servers/${id}`, { headers: { Authorization: null } })).text,
      (await send("boss", "POST", `/servers/${id}/check`)).text,
    ];
    for (const text of texts) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(URL_KEY);
    }
    expect(added.headers.get("cache-control")).toBe("no-store");
  });

  it("ошибки: неверный ввод — 400 с текстом, нет сервера — 404, нет связи — 502", async () => {
    const { send, fake } = await setupHandler();
    const bad = await send("boss", "POST", "/servers", { ...newServer, prefix: "Плохой" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/Префикс/);
    expect((await send("boss", "POST", "/servers", { ...newServer, url: "http://127.0.0.1/mcp" })).status).toBe(400);
    expect((await send("boss", "PATCH", "/servers/nope", { status: "off" })).status).toBe(404);
    fake.down = true;
    const down = await send("boss", "POST", "/servers", newServer);
    expect(down.status).toBe(502);
    expect(down.text).not.toContain(URL_KEY);
    expect((await send("boss", "POST", "/servers", "не json")).status).toBe(400);
  });

  it("запрос с чужой страницы на запись — 403; чтение — можно", async () => {
    const { handler } = await setupHandler();
    const foreign = await handler.fetch(
      new Request(`${ORIGIN}/api/mcp/servers`, { method: "POST", headers: { origin: "https://evil.example.org", host: "app.example.com", "x-user": "boss", "content-type": "application/json" }, body: JSON.stringify(newServer) }),
    );
    expect(foreign.status).toBe(403);
    const read = await handler.fetch(new Request(`${ORIGIN}/api/mcp/servers`, { headers: { host: "app.example.com", "x-user": "boss" } }));
    expect(read.status).toBe(200);
  });
});
