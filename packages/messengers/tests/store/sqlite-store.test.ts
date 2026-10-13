import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteMessengerStore } from "../../src/sqlite";
import { describeMessengerStoreContract } from "./messenger-store-contract";

const folders: string[] = [];
async function freshFile(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "messengers-sqlite-"));
  folders.push(folder);
  return join(folder, "app.db");
}
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe("хранилище мессенджеров в SQLite", () => {
  describeMessengerStoreContract(async () => createSqliteMessengerStore({ filePath: await freshFile() }));

  it("данные переживают переоткрытие файла, миграции не повторяются", async () => {
    const filePath = await freshFile();
    const first = await createSqliteMessengerStore({ filePath });
    await first.claimUpdate("u1", new Date().toISOString());
    await first.close?.();
    const second = await createSqliteMessengerStore({ filePath });
    expect(await second.claimUpdate("u1", new Date().toISOString())).toBe(false);
    await second.close?.();
  });

  it("разговоры по чату агента ищутся по индексу, а не просмотром всей таблицы", async () => {
    const filePath = await freshFile();
    const store = await createSqliteMessengerStore({ filePath });
    await store.close();
    const db = new Database(filePath);
    try {
      const plan = db.prepare("explain query plan select * from messenger_conversations where current_chat_id = ?").all("chat-1") as Array<{ detail: string }>;
      expect(plan.map((step) => step.detail).join(" ")).toMatch(/USING INDEX messenger_conversations_current_chat_idx/);
    } finally {
      db.close();
    }
  });

  it("close() — обязательный у хранилища; повторный вызов не падает", async () => {
    const store = await createSqliteMessengerStore({ filePath: await freshFile() });
    const close: () => Promise<void> = store.close;
    await close();
    await expect(store.listLinks("anna")).rejects.toThrow();
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("создание упало после открытия файла (миграция не прошла) — файл закрыт", async () => {
    const filePath = await freshFile();
    // Чужая таблица с тем же именем: миграция мессенджеров на ней падает.
    const foreign = new Database(filePath);
    foreign.exec("create table messenger_links (id integer)");
    foreign.close();
    const close = vi.spyOn(Database.prototype, "close");
    try {
      await expect(createSqliteMessengerStore({ filePath })).rejects.toThrow();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
    }
  });
});
