import type { McpCallRecord, McpStore, StoredMcpServer } from "../types";

/** Хранилище в памяти процесса: для тестов и стенда. Отдаёт копии, как настоящая база. */
export function createMemoryMcpStore(): McpStore {
  const servers = new Map<string, StoredMcpServer>();
  let calls: McpCallRecord[] = [];
  let revision = 0;
  const byTime = (a: StoredMcpServer, b: StoredMcpServer) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  return {
    async listServers() {
      return [...servers.values()].sort(byTime).map((server) => structuredClone(server));
    },
    async getServer(id) {
      const server = servers.get(id);
      return server ? structuredClone(server) : null;
    },
    async saveServer(server) {
      const clash = [...servers.values()].find((other) => other.prefix === server.prefix && other.id !== server.id);
      if (clash) throw new Error(`MCP: префикс «${server.prefix}» уже занят`);
      servers.set(server.id, structuredClone(server));
      revision += 1;
    },
    async deleteServer(id) {
      servers.delete(id);
      revision += 1;
      calls = calls.filter((call) => call.serverId !== id);
    },
    async revision() {
      return revision;
    },
    async recordCall(call) {
      calls.push(structuredClone(call));
    },
    async listCalls({ serverId, limit }) {
      return calls
        .filter((call) => serverId === undefined || call.serverId === serverId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map((call) => structuredClone(call));
    },
    async deleteCallsBefore(before) {
      const kept = calls.filter((call) => call.startedAt >= before);
      const removed = calls.length - kept.length;
      calls = kept;
      return removed;
    },
  };
}
