import { describe, expect, it } from "vitest";
import { callTool, setupMcp, turn } from "./support/setup";

const URL_KEY = "url-key-7f3a9c";
const TOKEN = "tok-SECRET-91b2";
const PROXY_TOKEN = "proxy-SECRET-55";
const SECRETS = [URL_KEY, TOKEN, PROXY_TOKEN];

const leaks = (text: string) => SECRETS.filter((secret) => text.includes(secret));

describe("секреты сервера не утекают", () => {
  it("хранилище — только шифр; экран — адрес без параметров и имена заголовков", async () => {
    const setup = await setupMcp({}, { proxy: { origin: "https://mcp.example.com", headers: { "X-Proxy-Token": PROXY_TOKEN } } });
    const server = await setup.mcp.admin.addServer({
      name: "Wiki",
      prefix: "wiki",
      url: `https://mcp.example.com/mcp?key=${URL_KEY}`,
      headers: { Authorization: `Bearer ${TOKEN}` },
      viaProxy: true,
      status: "everyone",
    });
    expect(server.displayUrl).toBe("https://mcp.example.com/mcp");
    expect(server.urlHasHiddenParts).toBe(true);
    expect(server.headerNames).toEqual(["Authorization"]);
    expect(leaks(JSON.stringify(server))).toEqual([]);
    expect(leaks(JSON.stringify(setup.mcp.admin.listServers()))).toEqual([]);
    expect(leaks(JSON.stringify(await setup.store.listServers()))).toEqual([]);

    // Сервер получил всё, что нужно: адрес с ключом, заголовок и токен прокси.
    const seen = setup.fake.requests.find((request) => request.rpcMethod === "initialize")!;
    expect(seen.url).toContain(URL_KEY);
    expect(seen.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen.headers["x-proxy-token"]).toBe(PROXY_TOKEN);
  });

  it("ошибка сервера с адресом и токеном в тексте — секреты вычищены из ответа модели, журнала и строк", async () => {
    const setup = await setupMcp(
      {
        override: (method, request) =>
          method === "tools/call"
            ? new Response(`boom at ${request.url} auth=${request.headers.get("authorization")} proxy=${request.headers.get("x-proxy-token")}`, { status: 500 })
            : undefined,
      },
      { proxy: { origin: "https://mcp.example.com", headers: { "X-Proxy-Token": PROXY_TOKEN } } },
    );
    const server = await setup.mcp.admin.addServer({
      name: "Wiki",
      prefix: "wiki",
      url: `https://mcp.example.com/mcp?key=${URL_KEY}`,
      headers: { Authorization: `Bearer ${TOKEN}` },
      viaProxy: true,
      status: "everyone",
    });
    await setup.mcp.admin.setTool(server.id, "ask_question", { enabled: true });

    const error = await callTool(setup.mcp.tools(turn()), "wiki__ask_question", {}).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("boom at https://mcp.example.com/mcp");
    expect(leaks((error as Error).message)).toEqual([]);
    expect(leaks(JSON.stringify(await setup.mcp.admin.listCalls()))).toEqual([]);
    expect(leaks(setup.logLines.join("\n"))).toEqual([]);

    setup.fake.down = true;
    const check = await setup.mcp.admin.checkServer(server.id);
    expect(check.ok).toBe(false);
    expect(leaks(JSON.stringify(check))).toEqual([]);
  });

  it("правка: заголовок с null сохраняет прежнее значение, без заголовка — удаляется", async () => {
    const setup = await setupMcp();
    const server = await setup.mcp.admin.addServer({ name: "Wiki", prefix: "wiki", url: "https://mcp.example.com/mcp", headers: { Authorization: `Bearer ${TOKEN}`, "X-Team": "team-1234" }, status: "everyone" });
    await setup.mcp.admin.updateServer(server.id, { headers: { Authorization: null } });
    const last = setup.fake.requests.filter((request) => request.rpcMethod === "initialize").at(-1)!;
    expect(last.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(last.headers["x-team"]).toBeUndefined();
    expect(setup.mcp.admin.getServer(server.id)!.headerNames).toEqual(["Authorization"]);
  });
});
