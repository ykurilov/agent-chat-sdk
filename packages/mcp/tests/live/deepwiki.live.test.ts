// Живая проверка пакета MCP (078, SC-003): админ подключает публичный DeepWiki, включает инструменты, агент на
// DeepSeek 4.1 Flash сам зовёт инструмент по смыслу просьбы. Один ход агента — несколько обращений к модели.
// Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает. Запуск: `pnpm test:live deepwiki`.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createMcpServers, createMemoryMcpStore } from "../../src";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

describe("DeepWiki через пакет MCP на DeepSeek 4.1 Flash", () => {
  it("снимок списка с настоящего сервера, вызов инструмента агентом, журнал и строка в логе", async () => {
    const store = createMemoryMcpStore();
    const logLines: string[] = [];
    const mcp = await createMcpServers({ store, secretKey: "live-test-secret-key-0123456789abcdef", isAdmin: () => true, log: (line) => logLines.push(line) });

    const startedAt = Date.now();
    const server = await mcp.admin.addServer({ name: "DeepWiki", prefix: "deepwiki", url: "https://mcp.deepwiki.com/mcp", status: "everyone" });
    console.log(`Подключение и снимок: ${Date.now() - startedAt} мс; инструменты: ${server.tools.map((tool) => `${tool.modelName}${tool.readOnly ? " (чтение)" : ""}${tool.problem ? ` [${tool.problem}]` : ""}`).join(", ")}`);
    expect(server.tools.filter((tool) => !tool.problem).length).toBeGreaterThan(0);
    for (const tool of server.tools) {
      if (!tool.problem) await mcp.admin.setTool(server.id, tool.name, { enabled: true, needsApproval: false });
    }

    const check = await mcp.admin.checkServer(server.id);
    console.log(`Проверка связи: ${JSON.stringify(check)}`);
    expect(check).toMatchObject({ ok: true, matchesSnapshot: true });

    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
      agent: {
        instructions: "Ты помощник программиста. Отвечай по-русски, коротко. Про устройство открытых репозиториев GitHub узнавай инструментами DeepWiki.",
        tools: (model) => mcp.tools(model),
      },
      env: process.env,
    });
    const chat = await service.createChat("anna");
    await drain(
      await service.sendMessage("anna", chat.id, {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Как в репозитории vercel/ai устроен вызов инструментов моделью? Ответь в двух-трёх предложениях." }],
      }),
    );

    const { messages } = await service.getHistory("anna", chat.id);
    const answer = messages.findLast((message) => message.role === "assistant")!;
    const calls = answer.parts.filter((part) => part.type.startsWith("tool-deepwiki__"));
    const text = answer.parts.map((part) => (part.type === "text" ? (part as { text: string }).text : "")).join("");
    console.log(`Вызовы: ${calls.map((part) => `${part.type} → ${(part as { state?: string }).state}`).join(", ")}`);
    console.log(`Ответ: ${text.replace(/\s+/g, " ").slice(0, 400)}`);
    console.log(`Журнал сервера: ${logLines.join(" | ")}`);

    expect(calls.length).toBeGreaterThan(0);
    const journal = await mcp.admin.listCalls();
    expect(journal.length).toBe(calls.length);
    expect(journal.some((record) => record.ok)).toBe(true);
    expect(text.length).toBeGreaterThan(0);
    await mcp.close();
  });
});
