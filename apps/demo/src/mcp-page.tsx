import { McpAdmin } from "@ykurilov/agent-chat-mcp/react";
import { tandemMcpSkin } from "@ykurilov/agent-chat-skin-tandem/mcp";

const mcpApi = "/api/mcp";

/** Страница «Серверы MCP» админа. Не админу адреса отвечают 404 — экран пишет «не найдено». Грузится лениво. */
export default function McpPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <McpAdmin skin={tandemMcpSkin} url={mcpApi} />
    </div>
  );
}
