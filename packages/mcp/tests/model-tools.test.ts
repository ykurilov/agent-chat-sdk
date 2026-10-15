import { describe, expect, it } from "vitest";
import { createMcpServers, createMemoryMcpStore } from "../src/index";
import type { McpServersOptions } from "../src/index";
import { createFakeMcpServer, publicResolver } from "./support/fake-mcp-server";

const SECRET_KEY = "k".repeat(40);

const fakeTools = [
  { name: "read_wiki_structure", description: "Список тем", inputSchema: { type: "object", properties: { repoName: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "ask_question", description: "Отвечает на вопрос", inputSchema: { type: "object", properties: { question: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "delete_repo", description: "Удаляет", inputSchema: { type: "object", properties: {} } },
];

async function setup(overrides: Partial<McpServersOptions> = {}) {
  const fake = createFakeMcpServer({ tools: fakeTools });
  const store = createMemoryMcpStore();
  const mcp = await createMcpServers({
    store,
    secretKey: SECRET_KEY,
    isAdmin: (userId) => userId === "boss",
    fetch: fake.fetch,
    resolveHost: publicResolver,
    ...overrides,
  });
  return { fake, store, mcp };
}

const model = (ownerId: string, audience: "private" | "group" = "private") => ({ ownerId, chatId: "chat-1", turnId: "turn-1", audience, viewer: { isAdmin: ownerId === "boss" } });

describe("инструменты сервера для модели", () => {
  it("новый сервер: список снят, инструменты выключены; включённый виден с префиксом и пометками", async () => {
    const { mcp } = await setup();
    const server = await mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    expect(server.tools.map((tool) => [tool.name, tool.enabled, tool.needsApproval])).toEqual([
      ["read_wiki_structure", false, false],
      ["ask_question", false, false],
      ["delete_repo", false, true],
    ]);
    expect(Object.keys(mcp.tools(model("anna")))).toEqual([]);

    await mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    await mcp.admin.setTool(server.id, "delete_repo", { enabled: true });
    const tools = mcp.tools(model("anna"));
    expect(Object.keys(tools)).toEqual(["deepwiki__ask_question", "deepwiki__delete_repo"]);
    const ask = tools.deepwiki__ask_question!;
    expect(ask.description).toContain("Отвечает на вопрос");
    expect(ask.description).toContain("внешний сервис «DeepWiki»");
    expect(ask.metadata).toEqual({ externalContent: true });
    expect(ask.needsApproval).toBe(false);
    expect(tools.deepwiki__delete_repo!.needsApproval).toBe(true);
  });

  it("видимость по статусу: выключен — никому, админы — только в личном чате админа, все — всем", async () => {
    const { mcp } = await setup();
    const server = await mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "off" });
    await mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    const sees = (ownerId: string, audience?: "private" | "group") => Object.keys(mcp.tools(model(ownerId, audience))).length > 0;

    expect([sees("boss"), sees("anna")]).toEqual([false, false]);

    await mcp.admin.updateServer(server.id, { status: "admins" });
    expect([sees("boss"), sees("boss", "group"), sees("anna")]).toEqual([true, false, false]);

    await mcp.admin.updateServer(server.id, { status: "everyone" });
    expect([sees("boss"), sees("anna"), sees("anna", "group")]).toEqual([true, true, true]);
  });

  it("инструмент с причиной (огромная схема) включить нельзя", async () => {
    const huge = { type: "object", properties: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`f${i}`, { type: "string" }])) };
    const fake = createFakeMcpServer({ tools: [{ name: "huge", inputSchema: huge }] });
    const { mcp } = await setup({ fetch: fake.fetch });
    const server = await mcp.admin.addServer({ name: "Big", prefix: "big", url: "https://big.example.com/mcp", status: "everyone" });
    await expect(mcp.admin.setTool(server.id, "huge", { enabled: true })).rejects.toThrow(/схема/i);
  });

  it("список с нескольких страниц собирается целиком", async () => {
    const fake = createFakeMcpServer({ tools: fakeTools, pageSize: 1 });
    const { mcp } = await setup({ fetch: fake.fetch });
    const server = await mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    expect(server.tools).toHaveLength(3);
  });

  it("префикс: латиница, уникален", async () => {
    const { mcp } = await setup();
    await expect(mcp.admin.addServer({ name: "X", prefix: "Вики", url: "https://mcp.example.com/mcp", status: "everyone" })).rejects.toThrow(/префикс/i);
    await mcp.admin.addServer({ name: "A", prefix: "wiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    await expect(mcp.admin.addServer({ name: "B", prefix: "wiki", url: "https://mcp.example.com/mcp", status: "everyone" })).rejects.toThrow(/префикс/i);
  });
});
