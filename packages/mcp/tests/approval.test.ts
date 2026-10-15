import { describe, expect, it } from "vitest";
import { chatServiceWithTools, callsTool, say } from "./support/chat-service";
import { setupMcp } from "./support/setup";

describe("подтверждение человеком", () => {
  it("инструмент с подтверждением: ход ждёт решения, к серверу не ходим; «Разрешить» — один вызов", async () => {
    const setup = await setupMcp();
    const server = await setup.mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    // У delete_repo нет пометки «только чтение»: подтверждение включено по умолчанию.
    await setup.mcp.admin.setTool(server.id, "delete_repo", { enabled: true });
    const { service } = chatServiceWithTools((model) => setup.mcp.tools(model), [callsTool("deepwiki__delete_repo", { repo: "a/b" })]);
    const chat = await service.createChat("anna");
    const chunks = (await say(service, "anna", chat.id, "u1", "удали a/b")) as { type: string }[];
    expect(chunks.some((chunk) => chunk.type === "tool-approval-request")).toBe(true);
    expect(setup.fake.calls).toEqual([]);

    const { messages } = await service.getHistory("anna", chat.id);
    const part = messages.at(-1)!.parts.find((item) => item.type === "tool-deepwiki__delete_repo") as { approval: { id: string } };
    await service.answerApproval("anna", chat.id, part.approval.id, "allow");
    for await (const _chunk of (await service.subscribe("anna", chat.id))!) void _chunk;
    expect(setup.fake.calls).toEqual([{ name: "delete_repo", args: { repo: "a/b" } }]);
  });

  it("админ снял подтверждение — вызов идёт без вопроса", async () => {
    const setup = await setupMcp();
    const server = await setup.mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.example.com/mcp", status: "everyone" });
    await setup.mcp.admin.setTool(server.id, "delete_repo", { enabled: true, needsApproval: false });
    const { service } = chatServiceWithTools((model) => setup.mcp.tools(model), [callsTool("deepwiki__delete_repo", { repo: "a/b" })]);
    const chat = await service.createChat("anna");
    const chunks = (await say(service, "anna", chat.id, "u1", "удали")) as { type: string }[];
    expect(chunks.some((chunk) => chunk.type === "tool-approval-request")).toBe(false);
    expect(setup.fake.calls).toHaveLength(1);
  });
});
