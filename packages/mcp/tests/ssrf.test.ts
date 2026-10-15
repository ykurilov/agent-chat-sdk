import { describe, expect, it } from "vitest";
import { callTool, setupMcp, turn } from "./support/setup";

describe("защита от запросов во внутреннюю сеть", () => {
  it.each([
    ["http://127.0.0.1:8080/mcp"],
    ["http://localhost/mcp"],
    ["http://169.254.169.254/latest/meta-data"],
    ["http://10.0.0.5/mcp"],
    ["http://[::1]/mcp"],
    ["http://intranet/mcp"],
    ["http://db.internal/mcp"],
    ["file:///etc/passwd"],
    ["https://user:pass@mcp.example.com/mcp"],
  ])("адрес %s не принимается, к нему не ходим", async (url) => {
    const setup = await setupMcp();
    await expect(setup.mcp.admin.addServer({ name: "X", prefix: "x", url, status: "everyone" })).rejects.toMatchObject({ kind: "bad_address" });
    expect(setup.fake.requests).toEqual([]);
  });

  it("имя, которое DNS разрешает в частный адрес, отклоняется", async () => {
    const setup = await setupMcp({}, { resolveHost: async () => ["192.168.1.10"] });
    await expect(setup.mcp.admin.addServer({ name: "X", prefix: "x", url: "https://evil.example.com/mcp", status: "everyone" })).rejects.toThrow(/локальный или частный/);
    expect(setup.fake.requests).toEqual([]);
  });

  it("имя проверяется при каждом запросе: подмена DNS после добавления не пускает во внутреннюю сеть", async () => {
    let addresses = ["93.184.216.34"];
    const setup = await setupMcp({}, { resolveHost: async () => addresses });
    const server = await setup.mcp.admin.addServer({ name: "X", prefix: "x", url: "https://rebind.example.com/mcp", status: "everyone" });
    await setup.mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    addresses = ["127.0.0.1"];
    await setup.mcp.admin.updateServer(server.id, { timeoutMs: 5000 });
    await expect(callTool(setup.mcp.tools(turn()), "x__ask_question", {})).rejects.toThrow(/локальный или частный/);
    expect(setup.fake.calls).toEqual([]);
  });

  it("переадресации запрещены: каждый запрос уходит с redirect: error", async () => {
    const setup = await setupMcp();
    await setup.mcp.admin.addServer({ name: "X", prefix: "x", url: "https://mcp.example.com/mcp", status: "everyone" });
    expect(setup.fake.seenInits.length).toBeGreaterThan(0);
    expect(setup.fake.seenInits.every((init) => init?.redirect === "error")).toBe(true);
  });

  it("приложение может явно разрешить внутреннюю сеть", async () => {
    const setup = await setupMcp({}, { allowPrivateNetwork: true });
    const server = await setup.mcp.admin.addServer({ name: "Local", prefix: "local", url: "http://127.0.0.1:3001/mcp", status: "everyone" });
    expect(server.tools.length).toBeGreaterThan(0);
  });
});
