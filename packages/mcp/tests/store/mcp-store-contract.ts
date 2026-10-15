import { describe, expect, it } from "vitest";
import type { McpCallRecord, McpStore, StoredMcpServer } from "../../src/types";

export interface StoreHandle {
  store: McpStore;
  /** Второе подключение к той же базе: видит записи первого. */
  reopen?: () => Promise<McpStore>;
  close(): Promise<void>;
}

export function storedServer(overrides: Partial<StoredMcpServer> = {}): StoredMcpServer {
  return {
    id: "srv-1",
    name: "DeepWiki",
    prefix: "deepwiki",
    status: "everyone",
    transport: "http",
    viaProxy: false,
    timeoutMs: 30_000,
    secretUrl: "v1.шифр",
    displayUrl: "https://mcp.deepwiki.com/mcp",
    urlHasHiddenParts: false,
    secretHeaders: null,
    headerNames: [],
    // Порядок ключей схемы важен: из снимка строится запрос к модели, байт в байт.
    tools: [
      {
        name: "ask_question",
        description: "Спросить",
        inputSchema: { type: "object", properties: { repoName: { type: "string" }, question: { type: "string" } }, required: ["repoName", "question"] },
        readOnly: true,
      },
    ],
    toolsUpdatedAt: "2026-10-15T10:00:00.000Z",
    toolSettings: { ask_question: { enabled: true, needsApproval: false } },
    lastCheck: null,
    createdAt: "2026-10-15T10:00:00.000Z",
    updatedAt: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

const call = (overrides: Partial<McpCallRecord> = {}): McpCallRecord => ({
  id: crypto.randomUUID(),
  serverId: "srv-1",
  toolName: "ask_question",
  ownerId: "anna",
  chatId: "chat-1",
  startedAt: "2026-10-15T10:00:00.000Z",
  durationMs: 120,
  ok: true,
  ...overrides,
});

/** Общий договор хранилища: одни и те же проверки для памяти, SQLite и PostgreSQL. */
export function describeMcpStoreContract(open: () => Promise<StoreHandle>) {
  describe("договор хранилища MCP", () => {
    it("сервер записывается и читается без потерь, порядок ключей схемы сохранён", async () => {
      const handle = await open();
      try {
        const server = storedServer({
          secretHeaders: "v1.заголовки",
          headerNames: ["Authorization"],
          urlHasHiddenParts: true,
          lastCheck: { at: "2026-10-15T10:05:00.000Z", ok: false, error: "нет связи" },
        });
        await handle.store.saveServer(server);
        const read = await handle.store.getServer("srv-1");
        expect(read).toEqual(server);
        expect(JSON.stringify(read!.tools)).toBe(JSON.stringify(server.tools));
        if (handle.reopen) {
          const again = await (await handle.reopen()).getServer("srv-1");
          expect(JSON.stringify(again)).toBe(JSON.stringify(read));
        }
      } finally {
        await handle.close();
      }
    });

    it("запись заменяет прежнюю; список — по времени добавления; удаление убирает и журнал", async () => {
      const handle = await open();
      try {
        await handle.store.saveServer(storedServer({ id: "b", prefix: "b", createdAt: "2026-10-15T11:00:00.000Z" }));
        await handle.store.saveServer(storedServer({ id: "a", prefix: "a", createdAt: "2026-10-15T10:00:00.000Z" }));
        await handle.store.saveServer(storedServer({ id: "b", prefix: "b", name: "Новое имя", createdAt: "2026-10-15T11:00:00.000Z" }));
        const list = await handle.store.listServers();
        expect(list.map((server) => [server.id, server.name])).toEqual([
          ["a", "DeepWiki"],
          ["b", "Новое имя"],
        ]);

        await handle.store.recordCall(call({ serverId: "b" }));
        await handle.store.recordCall(call({ serverId: "a" }));
        await handle.store.deleteServer("b");
        expect(await handle.store.getServer("b")).toBeNull();
        expect((await handle.store.listCalls({ limit: 10 })).map((record) => record.serverId)).toEqual(["a"]);
        await handle.store.deleteServer("нет-такого");
      } finally {
        await handle.close();
      }
    });

    it("журнал: новые первыми, фильтр по серверу, предел, ошибка сохраняется, старые удаляются", async () => {
      const handle = await open();
      try {
        await handle.store.recordCall(call({ id: "1", startedAt: "2026-10-01T10:00:00.000Z" }));
        await handle.store.recordCall(call({ id: "2", startedAt: "2026-10-15T10:00:00.000Z", ok: false, error: "срок вышел" }));
        await handle.store.recordCall(call({ id: "3", startedAt: "2026-10-15T11:00:00.000Z", serverId: "other" }));

        const all = await handle.store.listCalls({ limit: 10 });
        expect(all.map((record) => record.id)).toEqual(["3", "2", "1"]);
        expect(all[1]).toEqual(call({ id: "2", startedAt: "2026-10-15T10:00:00.000Z", ok: false, error: "срок вышел" }));
        expect(all[0]!.error).toBeUndefined();
        expect((await handle.store.listCalls({ serverId: "srv-1", limit: 1 })).map((record) => record.id)).toEqual(["2"]);

        expect(await handle.store.deleteCallsBefore("2026-10-10T00:00:00.000Z")).toBe(1);
        expect((await handle.store.listCalls({ limit: 10 })).map((record) => record.id)).toEqual(["3", "2"]);
      } finally {
        await handle.close();
      }
    });

    it("префикс уникален: второй сервер с тем же префиксом не записывается", async () => {
      const handle = await open();
      try {
        await handle.store.saveServer(storedServer({ id: "a", prefix: "same" }));
        await expect(handle.store.saveServer(storedServer({ id: "b", prefix: "same" }))).rejects.toThrow();
        expect((await handle.store.listServers()).map((server) => server.id)).toEqual(["a"]);
      } finally {
        await handle.close();
      }
    });

    it("отметка версии меняется при каждой записи и удалении сервера, журнал её не трогает; второе подключение видит ту же", async () => {
      const handle = await open();
      try {
        const marks = [await handle.store.revision()];
        await handle.store.saveServer(storedServer());
        marks.push(await handle.store.revision());
        await handle.store.saveServer(storedServer({ lastCheck: { at: "2026-10-15T10:05:00.000Z", ok: true } }));
        marks.push(await handle.store.revision());
        await handle.store.recordCall(call());
        expect(await handle.store.revision()).toBe(marks.at(-1));
        await handle.store.deleteServer("srv-1");
        marks.push(await handle.store.revision());
        expect(new Set(marks).size).toBe(4);
        if (handle.reopen) expect(await (await handle.reopen()).revision()).toBe(marks.at(-1));
      } finally {
        await handle.close();
      }
    });

    it("прочитанный сервер — копия: правка объекта не меняет хранилище", async () => {
      const handle = await open();
      try {
        await handle.store.saveServer(storedServer());
        const read = (await handle.store.getServer("srv-1"))!;
        read.toolSettings.ask_question!.enabled = false;
        read.tools.pop();
        const again = (await handle.store.getServer("srv-1"))!;
        expect(again.toolSettings.ask_question!.enabled).toBe(true);
        expect(again.tools).toHaveLength(1);
      } finally {
        await handle.close();
      }
    });
  });
}
