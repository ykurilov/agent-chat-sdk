import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../src/sqlite-storage";

/** Поток с TypeScript: загрузчик tsx — из зависимостей пакета. */
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function writer(workerData: { filePath: string; chatId: string; key: string; rounds: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./support/chat-data-writer.worker.ts", import.meta.url), {
      // Пакеты репозитория внутри потока берутся из исходников, как в тестах.
      execArgv: ["--conditions=@ykurilov/agent-chat-source", "--import", TSX_LOADER],
      workerData,
    });
    worker.once("message", () => resolve());
    worker.once("error", reject);
    worker.once("exit", (code) => code !== 0 && reject(new Error(`поток записи вышел с кодом ${code}`)));
  });
}

describe("SQLite: updateChatData на нескольких подключениях к одному файлу", () => {
  it("три потока правят каждый свой ключ одного чата одновременно: ни одна правка не потеряна, ошибок «база занята» нет", async () => {
    const folder = mkdtempSync(join(tmpdir(), "chat-data-"));
    folders.push(folder);
    const filePath = join(folder, "chat.sqlite");
    const first = createSqliteChatStorage({ filePath });
    await first.createChat({ id: "c1", ownerId: "anna", modelId: "m", providerId: "p", data: { start: true } });

    const rounds = 40;
    await Promise.all(["a", "b", "c"].map((key) => writer({ filePath, chatId: "c1", key, rounds })));

    expect((await first.getChat("c1"))?.data).toEqual({ start: true, a: rounds, b: rounds, c: rounds });
    first.close();
  }, 60_000);
});
