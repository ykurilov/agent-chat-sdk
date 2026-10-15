import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import { setupMcp, turn } from "./support/setup";

describe("инструменты приложения и MCP с одним именем", () => {
  it("побеждает инструмент приложения; в журнал одно предупреждение на имя", async () => {
    const setup = await setupMcp();
    const server = await setup.mcp.admin.addServer({ name: "Wiki", prefix: "wiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    await setup.mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    await setup.mcp.admin.setTool(server.id, "delete_repo", { enabled: true });
    const appTools = { wiki__ask_question: tool({ description: "Свой инструмент приложения", inputSchema: jsonSchema({ type: "object" }), execute: async () => "своё" }) };

    const first = setup.mcp.tools(turn(), appTools);
    expect(Object.keys(first)).toEqual(["wiki__delete_repo"]);
    const merged = { ...first, ...appTools };
    expect(merged.wiki__ask_question).toBe(appTools.wiki__ask_question);

    setup.mcp.tools(turn(), appTools);
    expect(setup.logLines.filter((line) => line.includes("wiki__ask_question"))).toHaveLength(1);
  });

  it("без набора приложения — все инструменты MCP, как раньше", async () => {
    const setup = await setupMcp();
    const server = await setup.mcp.admin.addServer({ name: "Wiki", prefix: "wiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    await setup.mcp.admin.setTool(server.id, "ask_question", { enabled: true });
    expect(Object.keys(setup.mcp.tools(turn()))).toEqual(["wiki__ask_question"]);
  });
});
