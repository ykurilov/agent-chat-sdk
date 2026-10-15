import { describe, expect, it } from "vitest";
import { createMcpServers, createMemoryMcpStore } from "../src/index";
import { chatServiceWithTools, say } from "./support/chat-service";
import { createFakeMcpServer, publicResolver } from "./support/fake-mcp-server";

const SECRET_KEY = "k".repeat(40);

function fakeWiki() {
  return createFakeMcpServer({
    tools: [
      { name: "read_wiki_structure", description: "Список тем", inputSchema: { type: "object", properties: { repoName: { type: "string" } }, required: ["repoName"] }, annotations: { readOnlyHint: true } },
      { name: "ask_question", description: "Отвечает на вопрос", inputSchema: { type: "object", properties: { repoName: { type: "string" }, question: { type: "string" } }, required: ["repoName", "question"] }, annotations: { readOnlyHint: true } },
    ],
  });
}

/** Часть запроса, которая должна совпадать байт в байт: инструменты и инструкции. */
const cachedPrefix = (request: { tools?: unknown; prompt: { role: string }[] }) =>
  JSON.stringify({ tools: request.tools, system: request.prompt.filter((message) => message.role === "system") });

describe("кэш модели: список инструментов из снимка", () => {
  it("запрос байт в байт одинаков в ходах подряд, в том числе когда сервер упал и после перезапуска", async () => {
    const fake = fakeWiki();
    const store = createMemoryMcpStore();
    const options = { store, secretKey: SECRET_KEY, isAdmin: () => false, fetch: fake.fetch, resolveHost: publicResolver };
    const mcp = await createMcpServers(options);
    const server = await mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    await mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    await mcp.admin.setTool(server.id, "read_wiki_structure", { enabled: true });

    const { service, requests } = chatServiceWithTools((model) => mcp.tools(model));
    const chat = await service.createChat("anna");
    await say(service, "anna", chat.id, "m1", "Привет");
    const requestsToServer = fake.requests.length;
    fake.down = true;
    // Сервер «на той стороне» поменял описания — без «Обновить список» это не видно.
    fake.tools = [{ name: "ask_question", description: "НОВОЕ описание", inputSchema: { type: "object" } }];
    await say(service, "anna", chat.id, "m2", "Ещё раз");

    // Перезапуск приложения: каталог читается из хранилища.
    const restarted = await createMcpServers(options);
    const afterRestart = chatServiceWithTools((model) => restarted.tools(model));
    const secondChat = await afterRestart.service.createChat("anna");
    await say(afterRestart.service, "anna", secondChat.id, "m3", "Привет");

    expect(requests).toHaveLength(2);
    expect(cachedPrefix(requests[1]!)).toBe(cachedPrefix(requests[0]!));
    expect(cachedPrefix(afterRestart.requests[0]!)).toBe(cachedPrefix(requests[0]!));
    // Построение запроса к серверу не ходит.
    expect(fake.requests.length).toBe(requestsToServer);
    const names = (requests[0]!.tools ?? []).map((tool) => tool.name);
    expect(names).toEqual(["deepwiki__ask_question", "deepwiki__read_wiki_structure"]);
  });

  it("«Обновить список» — единственное, что меняет описания в запросе", async () => {
    const fake = fakeWiki();
    const mcp = await createMcpServers({ store: createMemoryMcpStore(), secretKey: SECRET_KEY, isAdmin: () => false, fetch: fake.fetch, resolveHost: publicResolver });
    const server = await mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    await mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    const before = JSON.stringify(mcp.tools({ ownerId: "anna", chatId: "c", audience: "private" }).deepwiki__ask_question!.description);

    fake.tools = [{ name: "ask_question", description: "НОВОЕ описание", inputSchema: { type: "object" } }];
    const check = await mcp.admin.checkServer(server.id);
    expect(check).toMatchObject({ ok: true, toolCount: 1, matchesSnapshot: false });
    expect(JSON.stringify(mcp.tools({ ownerId: "anna", chatId: "c", audience: "private" }).deepwiki__ask_question!.description)).toBe(before);

    const refreshed = await mcp.admin.refreshTools(server.id);
    expect(refreshed.tools.map((tool) => [tool.name, tool.enabled])).toEqual([["ask_question", true]]);
    expect(mcp.tools({ ownerId: "anna", chatId: "c", audience: "private" }).deepwiki__ask_question!.description).toContain("НОВОЕ описание");
  });
});
