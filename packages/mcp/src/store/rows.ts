import type { McpCallRecord, McpCheckResult, McpToolSetting, McpToolSnapshot, StoredMcpServer } from "../types";

/** Поля сервера, которые в базе лежат JSON-текстом. Времена переводит каждая база сама. */
export interface ServerTextColumns {
  headerNames: string;
  tools: string;
  toolSettings: string;
  lastCheck: string | null;
}

export function serverTextColumns(server: StoredMcpServer): ServerTextColumns {
  return {
    headerNames: JSON.stringify(server.headerNames),
    tools: JSON.stringify(server.tools),
    toolSettings: JSON.stringify(server.toolSettings),
    lastCheck: server.lastCheck ? JSON.stringify(server.lastCheck) : null,
  };
}

export function parsedServerColumns(row: ServerTextColumns): Pick<StoredMcpServer, "headerNames" | "tools" | "toolSettings" | "lastCheck"> {
  return {
    headerNames: JSON.parse(row.headerNames) as string[],
    tools: JSON.parse(row.tools) as McpToolSnapshot[],
    toolSettings: JSON.parse(row.toolSettings) as Record<string, McpToolSetting>,
    lastCheck: row.lastCheck ? (JSON.parse(row.lastCheck) as McpCheckResult) : null,
  };
}

/** Запись журнала без пустой ошибки: как её записали. */
export function callRecord(fields: Omit<McpCallRecord, "error"> & { error: string | null }): McpCallRecord {
  const { error, ...rest } = fields;
  return error === null ? rest : { ...rest, error };
}
