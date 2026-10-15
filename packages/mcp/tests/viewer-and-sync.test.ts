import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpAdminHandler, createMcpServers } from "../src/index";
import type { McpServers, McpToolsModel } from "../src/index";
import { createFakeMcpServer, publicResolver } from "./support/fake-mcp-server";
import { callTool, SECRET_KEY, setupMcp, wikiTools } from "./support/setup";

const model = (ownerId: string, viewer?: { isAdmin?: boolean }, audience: "private" | "group" = "private"): McpToolsModel => ({
  ownerId,
  chatId: "chat-1",
  turnId: "turn-1",
  audience,
  ...(viewer && { viewer }),
});

async function adminsOnlyWiki(setup: Awaited<ReturnType<typeof setupMcp>>) {
  const server = await setup.mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "admins" });
  await setup.mcp.admin.setTool(server.id, "ask_question", { enabled: true });
  return server;
}

afterEach(() => vi.useRealTimers());

describe("права в ходе — из viewer", () => {
  it("«только админы» видны по viewer.isAdmin; isAdmin приложения в ходе не зовётся; в группе не видны", async () => {
    const isAdmin = vi.fn(async () => true);
    const setup = await setupMcp({}, { isAdmin });
    await adminsOnlyWiki(setup);
    const names = (toolsModel: McpToolsModel) => Object.keys(setup.mcp.tools(toolsModel));
    expect(names(model("boss", { isAdmin: true }))).toEqual(["deepwiki__ask_question"]);
    expect(names(model("boss", { isAdmin: false }))).toEqual([]);
    expect(names(model("boss", { isAdmin: true }, "group"))).toEqual([]);
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("нет viewer — «только админы» не видны, в журнал одна подсказка", async () => {
    const setup = await setupMcp();
    await adminsOnlyWiki(setup);
    expect(Object.keys(setup.mcp.tools(model("boss")))).toEqual([]);
    setup.mcp.tools(model("boss"));
    expect(setup.logLines.filter((line) => line.includes("agent.viewer"))).toHaveLength(1);
  });

  it("при вызове права проверяются по viewer того же хода", async () => {
    const setup = await setupMcp();
    const server = await adminsOnlyWiki(setup);
    const tools = setup.mcp.tools(model("boss", { isAdmin: true }));
    await setup.mcp.admin.updateServer(server.id, { status: "off" });
    await expect(callTool(tools, "deepwiki__ask_question", {})).rejects.toThrow(/недоступен/);
  });

  it("адреса экрана ждут асинхронный isAdmin приложения", async () => {
    const setup = await setupMcp({}, { isAdmin: async (userId) => userId === "boss" });
    const handler = createMcpAdminHandler({ mcp: setup.mcp, resolveUser: async (request) => ({ id: request.headers.get("x-user")! }) });
    const get = (user: string) => handler.fetch(new Request("https://app.example.com/api/mcp/servers", { headers: { "x-user": user } }));
    expect((await get("boss")).status).toBe(200);
    expect((await get("anna")).status).toBe(404);
  });
});

describe("несколько копий приложения на одном хранилище", () => {
  async function twoCopies(syncIntervalMs: number) {
    const fake = createFakeMcpServer({ tools: wikiTools });
    const first = await setupMcp({ tools: wikiTools }, { syncIntervalMs });
    const options = { store: first.store, secretKey: SECRET_KEY, isAdmin: () => true, fetch: fake.fetch, resolveHost: publicResolver, log: () => {}, syncIntervalMs };
    const server = await first.mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    await first.mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    const second: McpServers = await createMcpServers({ ...options, fetch: first.fake.fetch });
    return { first, second, server, options };
  }
  const visible = (mcp: McpServers) => Object.keys(mcp.tools(model("anna")));

  it("правка админа на одной копии доходит до другой сама: сверка отметки версии раз в срок", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { first, second, server } = await twoCopies(15_000);
    expect(visible(second)).toEqual(["deepwiki__ask_question"]);
    const revision = vi.spyOn(first.store, "revision");

    await first.mcp.admin.updateServer(server.id, { status: "off" });
    expect(visible(second)).toEqual(["deepwiki__ask_question"]);

    revision.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() => expect(visible(second)).toEqual([]));
    // Сверка дешёвая: обе копии прочитали по одной отметке.
    expect(revision.mock.calls.length).toBeLessThanOrEqual(2);
    await first.mcp.close();
    await second.close();
  });

  it("без изменений сверка не перечитывает серверы", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { first, second } = await twoCopies(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const list = vi.spyOn(first.store, "listServers");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(list).not.toHaveBeenCalled();
    await first.mcp.close();
    await second.close();
  });

  it("экран другой копии видит правку сразу; удаление тоже доходит", async () => {
    const { first, second, server } = await twoCopies(0);
    const handler = createMcpAdminHandler({ mcp: second, resolveUser: async () => ({ id: "boss" }) });
    const servers = async () => (await (await handler.fetch(new Request("https://app.example.com/api/mcp/servers"))).json()).servers as { name: string }[];
    await first.mcp.admin.updateServer(server.id, { name: "Вики" });
    expect((await servers()).map((item) => item.name)).toEqual(["Вики"]);
    await first.mcp.admin.deleteServer(server.id);
    expect(await servers()).toEqual([]);
    expect(visible(second)).toEqual([]);
  });

  it("close останавливает сверку", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { first, second } = await twoCopies(5_000);
    await first.mcp.close();
    await second.close();
    const revision = vi.spyOn(first.store, "revision");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(revision).not.toHaveBeenCalled();
  });
});
