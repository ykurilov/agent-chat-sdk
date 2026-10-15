import { describe, expect, it } from "vitest";
import { overgrownWorkers, parseProcessTable } from "../vitest/worker-memory-guard";

const MB = 1024; // ps отдаёт RSS в КБ

describe("сторож памяти воркеров тестов", () => {
  it("читает таблицу ps: pid, родитель, RSS в КБ", () => {
    expect(parseProcessTable("  101     1  2048\n 102   101 4096\n\n")).toEqual([
      { pid: 101, ppid: 1, rssKb: 2048 },
      { pid: 102, ppid: 101, rssKb: 4096 },
    ]);
  });

  it("воркер считается вместе со своими потомками; ниже порога — никого", () => {
    const table = [
      { pid: 10, ppid: 1, rssKb: 500 * MB }, // сам vitest
      { pid: 11, ppid: 10, rssKb: 900 * MB }, // воркер
      { pid: 12, ppid: 11, rssKb: 900 * MB }, // процесс, который запустил тест
      { pid: 13, ppid: 10, rssKb: 300 * MB },
    ];
    expect(overgrownWorkers(table, 10, 2000)).toEqual([]);
    expect(overgrownWorkers(table, 10, 1500)).toEqual([{ pid: 11, rssMb: 1800, tree: [11, 12] }]);
  });

  it("чужие процессы и сам vitest не в счёт", () => {
    const table = [
      { pid: 10, ppid: 1, rssKb: 9000 * MB },
      { pid: 20, ppid: 1, rssKb: 9000 * MB },
      { pid: 11, ppid: 10, rssKb: 100 * MB },
    ];
    expect(overgrownWorkers(table, 10, 1000)).toEqual([]);
  });
});
