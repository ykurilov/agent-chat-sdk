import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../../../storage-sqlite/src/sqlite-storage";
import { createSqliteMcpStore } from "../../src/sqlite";
import { describeMcpStoreContract, storedServer } from "./mcp-store-contract";

const folders: string[] = [];
function freshFile(): string {
  const folder = mkdtempSync(join(tmpdir(), "mcp-store-"));
  folders.push(folder);
  return join(folder, "app.sqlite");
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("MCP в SQLite", () => {
  describeMcpStoreContract(async () => {
    const filePath = freshFile();
    const opened = [createSqliteMcpStore({ filePath })];
    return {
      store: opened[0]!,
      reopen: async () => {
        const again = createSqliteMcpStore({ filePath });
        opened.push(again);
        return again;
      },
      close: async () => {
        for (const store of opened) store.close();
      },
    };
  });

  it("живёт в одном файле с хранилищем чатов: миграции не мешают друг другу", async () => {
    const filePath = freshFile();
    const chats = createSqliteChatStorage({ filePath });
    const store = createSqliteMcpStore({ filePath });
    await store.saveServer(storedServer());
    store.close();
    const again = createSqliteMcpStore({ filePath });
    expect((await again.listServers()).map((server) => server.id)).toEqual(["srv-1"]);
    again.close();
    chats.close();
  });
});
