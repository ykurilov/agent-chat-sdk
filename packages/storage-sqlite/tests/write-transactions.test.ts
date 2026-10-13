import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { MemoryOptimizationRules } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../src/sqlite-storage";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function temporaryFilePath(): string {
  const folder = mkdtempSync(join(tmpdir(), "agent-chat-write-tx-"));
  folders.push(folder);
  return join(folder, "chat.sqlite");
}

describe("SQLite: «прочитал, потом записал» берёт запись базы сразу", () => {
  it("другая копия пишет в файл между чтением и записью взятия запуска памяти — взятие не падает с SQLITE_BUSY", async () => {
    const filePath = temporaryFilePath();
    const storage = createSqliteChatStorage({ filePath });
    const earlier = await storage.claimMemoryOptimizationRun!("anna", { minIntervalMs: 0, retryAfterFailureMs: 0, leaseMs: 60_000 }, "2026-01-01T00:00:00.000Z");
    await storage.finishMemoryOptimizationRun!("anna", earlier!.id, { status: "no_changes", finishedAt: "2026-01-01T00:00:01.000Z" });

    // Другая копия сервера: своё соединение, без ожидания замка.
    const other = new Database(filePath);
    other.pragma("busy_timeout = 0");
    let otherWrote: boolean | undefined;
    // Правила читаются после чтения прежних запусков, до вставки нового: в этот миг пишет другая копия.
    const rules: MemoryOptimizationRules = {
      minIntervalMs: 0,
      retryAfterFailureMs: 0,
      get leaseMs() {
        if (otherWrote === undefined) {
          try {
            other.prepare("insert into voice_choices (owner_id, voice_id, updated_at) values ('boris', 'v', '2026-01-01')").run();
            otherWrote = true;
          } catch {
            otherWrote = false;
          }
        }
        return 60_000;
      },
    };
    const claimed = await storage.claimMemoryOptimizationRun!("anna", rules, "2026-01-02T00:00:00.000Z");
    expect(claimed).toMatchObject({ status: "running" });
    // Запись базы была за взятием: другая копия ждала своей очереди.
    expect(otherWrote).toBe(false);
    other.close();
    storage.close();
  });
});
