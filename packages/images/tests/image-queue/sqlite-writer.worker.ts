import { parentPort, workerData } from "node:worker_threads";
import { sqliteImageJobStore } from "../../src/sqlite";

/** Отдельный поток со своим подключением к файлу SQLite: прибавляет `attempt` условной записью, пока не наберёт `increments`. */
const { file, id, increments } = workerData as { file: string; id: string; increments: number };
const store = sqliteImageJobStore(file);
let done = 0;
let conflicts = 0;
while (done < increments) {
  const job = (await store.get(id))!;
  const next = await store.update(id, { attempt: job.attempt + 1 }, job.version);
  if (next) done++;
  else conflicts++;
}
await store.close?.();
parentPort!.postMessage({ done, conflicts });
