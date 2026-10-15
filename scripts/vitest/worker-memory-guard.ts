import { execFile } from "node:child_process";
import { writeSync } from "node:fs";
import { promisify } from "node:util";

/**
 * Сторож памяти воркеров тестов. Живёт в главном процессе vitest (globalSetup) и раз в полсекунды смотрит RSS каждого
 * воркера вместе с его потомками; переросший порог убивает с понятной строкой в stderr.
 *
 * Почему не таймер внутри воркера и не `--max-old-space-size`: 15.10 тест читал бесконечный поток — куски лежат вне
 * кучи V8 (её предел их не видит), а чтение идёт на микрозадачах, и таймеры воркера (в том числе `testTimeout`) не
 * срабатывают. Процесс дорос до 97 ГБ. Главный процесс этим циклом не занят — его сторож видит всё.
 */

export interface ProcessRow {
  pid: number;
  ppid: number;
  rssKb: number;
}

/** Строки `ps -A -o pid=,ppid=,rss=`. */
export function parseProcessTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const [pid, ppid, rssKb] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(rssKb)) rows.push({ pid: pid!, ppid: ppid!, rssKb: rssKb! });
  }
  return rows;
}

/** Воркеры (прямые потомки `rootPid`), чья память вместе с потомками больше `limitMb`. */
export function overgrownWorkers(table: ProcessRow[], rootPid: number, limitMb: number): Array<{ pid: number; rssMb: number; tree: number[] }> {
  const children = new Map<number, ProcessRow[]>();
  for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const subtree = (row: ProcessRow): ProcessRow[] => [row, ...(children.get(row.pid) ?? []).flatMap(subtree)];
  const overgrown = [];
  for (const worker of children.get(rootPid) ?? []) {
    const tree = subtree(worker);
    const rssMb = Math.round(tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024);
    if (rssMb > limitMb) overgrown.push({ pid: worker.pid, rssMb, tree: tree.map((row) => row.pid) });
  }
  return overgrown;
}

const run = promisify(execFile);

/** Запускает сторожа для процесса `rootPid`; возвращает остановку. На Windows (нет `ps`) — ничего не делает. */
export function startWorkerMemoryGuard(options: { rootPid: number; limitMb: number; intervalMs: number }): () => void {
  if (process.platform === "win32") return () => {};
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,rss="]);
      for (const worker of overgrownWorkers(parseProcessTable(stdout), options.rootPid, options.limitMb)) {
        for (const pid of worker.tree.reverse()) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // уже завершился
          }
        }
        writeSync(
          2,
          `\n[сторож памяти тестов] воркер pid ${worker.pid} занял ${worker.rssMb} МБ (порог ${options.limitMb} МБ) — убит.\n` +
            `  Его файл тестов упадёт с ошибкой о неожиданном завершении воркера. Ищите бесконечный поток, цикл или накопление в нём.\n` +
            `  Порог: переменная AGENT_CHAT_TEST_WORKER_RSS_MB.\n`,
        );
      }
    } catch {
      // ps не ответил — проверим в следующий раз
    } finally {
      checking = false;
    }
  }, options.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
