import { describe, expect, it } from "vitest";
import { createMcpServers } from "../src/index";
import { createSecretBox } from "../src/secret-box";
import { publicResolver } from "./support/fake-mcp-server";
import { SECRET_KEY, setupMcp, turn } from "./support/setup";
import { storedServer } from "./store/mcp-store-contract";

const wiki = { name: "Wiki", prefix: "wiki", url: "https://mcp.example.com/mcp", status: "everyone" as const };

describe("имена инструментов не сталкиваются", () => {
  it("префикс с «_» на конце — отказ: «wiki_» + «__x» совпало бы с «wiki» + «_x»", async () => {
    const { mcp } = await setupMcp();
    await expect(mcp.admin.addServer({ ...wiki, prefix: "wiki_" })).rejects.toMatchObject({ kind: "bad_input", message: expect.stringMatching(/Префикс/) });
    const server = await mcp.admin.addServer(wiki);
    await expect(mcp.admin.updateServer(server.id, { prefix: "wiki_" })).rejects.toMatchObject({ kind: "bad_input" });
  });

  it("полное имя уже есть у другого сервера — ошибка админу, а не тихая подмена", async () => {
    // Запись от старой версии: префикс «wiki_» тогда ещё не запрещался.
    const setup = await setupMcp({ tools: [{ name: "_ask", inputSchema: { type: "object" } }] });
    await setup.store.saveServer(storedServer({ id: "old", prefix: "wiki_", secretUrl: createSecretBox(SECRET_KEY).seal("https://old.example.com/mcp"), tools: [{ name: "ask", description: "", inputSchema: { type: "object" } }], toolSettings: {} }));
    await setup.mcp.sync();
    await expect(setup.mcp.admin.addServer(wiki)).rejects.toMatchObject({ kind: "bad_input", message: expect.stringContaining("wiki___ask") });
    expect(setup.mcp.admin.listServers().map((server) => server.prefix)).toEqual(["wiki_"]);
  });
});

describe("гонка префикса между копиями", () => {
  it("две копии заняли один префикс — вторая получает понятный отказ (400), а не сбой", async () => {
    const first = await setupMcp({}, { syncIntervalMs: 0 });
    const second = await createMcpServers({ store: first.store, secretKey: SECRET_KEY, isAdmin: () => true, fetch: first.fake.fetch, resolveHost: publicResolver, log: () => {}, syncIntervalMs: 0 });
    await first.mcp.admin.addServer(wiki);
    // Вторая копия ещё не сверилась: в её каталоге префикс свободен.
    await expect(second.admin.addServer({ ...wiki, name: "Другая" })).rejects.toMatchObject({ kind: "bad_input", message: expect.stringMatching(/Префикс «wiki» уже занят/) });
    await second.close();
  });
});

describe("смена адреса — другой сервер", () => {
  it("новый адрес сбрасывает включение и подтверждение инструментов; новые заголовки — нет", async () => {
    const { mcp } = await setupMcp();
    const server = await mcp.admin.addServer(wiki);
    await mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    await mcp.admin.setTool(server.id, "delete_repo", { enabled: true, needsApproval: false });

    await mcp.admin.updateServer(server.id, { headers: { Authorization: "Bearer new" } });
    expect(Object.keys(mcp.tools(turn()))).toEqual(["wiki__ask_question", "wiki__delete_repo"]);

    const moved = await mcp.admin.updateServer(server.id, { url: "https://other.example.com/mcp" });
    expect(Object.keys(mcp.tools(turn()))).toEqual([]);
    expect(moved.tools.map((tool) => [tool.name, tool.enabled, tool.needsApproval])).toEqual([
      ["ask_question", false, false],
      ["delete_repo", false, true],
    ]);
  });

  it("тот же адрес ещё раз — настройки целы", async () => {
    const { mcp } = await setupMcp();
    const server = await mcp.admin.addServer(wiki);
    await mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    await mcp.admin.updateServer(server.id, { url: wiki.url });
    expect(Object.keys(mcp.tools(turn()))).toEqual(["wiki__ask_question"]);
  });
});
