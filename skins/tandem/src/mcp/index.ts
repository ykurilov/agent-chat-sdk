import type { McpSkin } from "@ykurilov/agent-chat-mcp/react";
import { TandemMcpAdminScreen } from "./mcp-admin-screen";

/** Скин экрана серверов MCP (договор скина MCP, версия 1): для `McpAdmin`. */
export const tandemMcpSkin: McpSkin = {
  McpAdminScreen: TandemMcpAdminScreen,
};

export { TandemMcpAdminScreen };
