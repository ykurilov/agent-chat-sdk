import { parentPort, workerData } from "node:worker_threads";
import { createSqliteChatStorage } from "../../src/sqlite-storage";

/** Отдельный поток со своим подключением к файлу: правит свой ключ данных чата `rounds` раз подряд. */
const { filePath, chatId, key, rounds } = workerData as { filePath: string; chatId: string; key: string; rounds: number };
const storage = createSqliteChatStorage({ filePath });
for (let round = 1; round <= rounds; round++) {
  await storage.updateChatData!(chatId, { [key]: round }, { maxBytes: 16 * 1024 });
}
storage.close();
parentPort!.postMessage("done");
