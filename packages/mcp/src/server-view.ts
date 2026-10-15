import { toolProblem, modelToolName } from "./model-tools";
import type { McpCheckResult, McpServerStatus, McpToolProblem, McpTransportKind, StoredMcpServer } from "./types";

/** Инструмент на экране админа. */
export interface McpToolView {
  name: string;
  /** Имя, под которым его видит модель. */
  modelName: string;
  title?: string;
  description?: string;
  readOnly: boolean;
  enabled: boolean;
  needsApproval: boolean;
  /** Почему нельзя включить. */
  problem?: McpToolProblem | "name_too_long";
}

/** Сервер на экране админа и в ответах API: ни адреса с параметрами, ни значений заголовков. */
export interface McpServerView {
  id: string;
  name: string;
  prefix: string;
  status: McpServerStatus;
  transport: McpTransportKind;
  viaProxy: boolean;
  timeoutMs: number;
  /** Адрес без параметров запроса и логина. */
  displayUrl: string;
  /** У адреса есть скрытые части: экран пишет «параметры скрыты». */
  urlHasHiddenParts: boolean;
  /** Имена заданных заголовков; значения не выдаются никогда — только «задан». */
  headerNames: string[];
  tools: McpToolView[];
  toolsUpdatedAt: string | null;
  lastCheck: McpCheckResult | null;
  createdAt: string;
  updatedAt: string;
}

export function serverView(server: StoredMcpServer): McpServerView {
  return {
    id: server.id,
    name: server.name,
    prefix: server.prefix,
    status: server.status,
    transport: server.transport,
    viaProxy: server.viaProxy,
    timeoutMs: server.timeoutMs,
    displayUrl: server.displayUrl,
    urlHasHiddenParts: server.urlHasHiddenParts,
    headerNames: [...server.headerNames],
    tools: server.tools.map((snapshot) => {
      const setting = server.toolSettings[snapshot.name];
      const problem = toolProblem(server.prefix, snapshot);
      return {
        name: snapshot.name,
        modelName: modelToolName(server.prefix, snapshot.name),
        ...(snapshot.title !== undefined && { title: snapshot.title }),
        ...(snapshot.description !== undefined && { description: snapshot.description }),
        readOnly: snapshot.readOnly === true,
        enabled: setting?.enabled === true && problem === undefined,
        needsApproval: setting?.needsApproval ?? snapshot.readOnly !== true,
        ...(problem !== undefined && { problem }),
      };
    }),
    toolsUpdatedAt: server.toolsUpdatedAt,
    lastCheck: server.lastCheck ? { ...server.lastCheck } : null,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}
