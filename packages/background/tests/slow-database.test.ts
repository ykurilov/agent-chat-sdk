import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks, memoryTaskStore } from "../src/index";
import type { TaskStore } from "../src/types";
import { callTool, controlledTool, createFakePort, FAKE_TIMERS, settle, toolsModel } from "./support/fake-port";
import { taskRecord } from "./store/task-store-contract";

/**
 * Медленная база (сервер под нагрузкой): подбор брошенных задач идёт секундами. Задача всё равно выполняется
 * один раз — ни вторым обходом той же копии, ни другой копией, пока эта её ведёт.
 */
const START = new Date("2026-10-05T12:00:00.000Z");
const LEASE_MS = 3_000;

beforeEach(() => {
  vi.useFakeTimers({ ...FAKE_TIMERS, now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Хранилище копии поверх общего: взятие задачи и список брошенных идут с задержкой (поддельные часы). */
function slowStore(shared: TaskStore, delays: { claimMs?: number; listExpiredMs?: number }) {
  const pause = (ms = 0) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
  const afterClaim: Array<(taskId: string) => Promise<void>> = [];
  const store: TaskStore = {
    ...shared,
    async claim(taskId, leaseOwner, leaseUntil, now) {
      await pause(delays.claimMs);
      const claimed = await shared.claim(taskId, leaseOwner, leaseUntil, now);
      for (const hook of afterClaim) await hook(taskId);
      return claimed;
    },
    async listExpired(now) {
      await pause(delays.listExpiredMs);
      return shared.listExpired(now);
    },
  };
  return { store, afterClaim };
}

function copyOn(store: TaskStore) {
  const report = controlledTool({ rerunAfterRestart: true });
  const background = createBackgroundTasks({ store, tools: { build_report: report.definition }, maxRunningPerUser: 50, leaseMs: LEASE_MS });
  const port = createFakePort();
  background.attach(port);
  return { background, port, runs: report.runs };
}

/** Брошенные задачи пропавшей копии: аренда кончилась секунду назад. */
async function abandonedTasks(shared: TaskStore, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const record = taskRecord({
      input: { period: `p${n}` },
      status: n % 2 === 0 ? "queued" : "running",
      attempt: n % 2,
      leaseOwner: "dead-copy",
      leaseUntil: new Date(START.getTime() - 1_000).toISOString(),
    });
    ids.push(record.id);
    await shared.create(record);
  }
  return ids;
}

/** Сколько раз запускалась каждая задача (по входу), на всех копиях. */
function runsByPeriod(...copies: Array<{ runs: Array<{ input: unknown }> }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { runs } of copies) {
    for (const run of runs) {
      const period = (run.input as { period: string }).period;
      counts.set(period, (counts.get(period) ?? 0) + 1);
    }
  }
  return counts;
}

async function advance(ms: number, step = 250): Promise<void> {
  for (let passed = 0; passed < ms; passed += step) {
    await vi.advanceTimersByTimeAsync(step);
    await settle();
  }
}

describe("медленная база: брошенная задача выполняется один раз", () => {
  it("обход по таймеру начался, пока первый подбор ещё идёт, — та же копия не запускает задачу второй раз", async () => {
    const shared = memoryTaskStore();
    await abandonedTasks(shared, 6);
    const a = copyOn(slowStore(shared, { claimMs: 700 }).store);
    void a.background.recover();
    await advance(10_000);
    const counts = runsByPeriod(a);
    expect([...counts.keys()].sort()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect([...counts.values()]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(a.port.errors).toEqual([]);
    await a.background.flush();
  });

  it("задача взята в конце долгого обхода — аренда считается от взятия, другая копия её не перехватывает", async () => {
    const shared = memoryTaskStore();
    const ids = await abandonedTasks(shared, 6);
    const slow = slowStore(shared, { claimMs: 700 });
    const a = copyOn(slow.store);
    const b = copyOn(shared);
    // Вторая копия начинает подбирать брошенные задачи сразу, как первая взяла последнюю.
    slow.afterClaim.push(async (taskId) => {
      if (taskId === ids.at(-1)) await b.background.recover();
    });
    void a.background.recover();
    await advance(10_000);
    const counts = runsByPeriod(a, b);
    expect([...counts.keys()].sort()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect([...counts.values()]).toEqual([1, 1, 1, 1, 1, 1]);
    await a.background.flush();
    await b.background.flush();
  });

  it("долгий список брошенных задач не задерживает продление аренды идущей задачи", async () => {
    const shared = memoryTaskStore();
    const a = copyOn(slowStore(shared, { listExpiredMs: 6_000 }).store);
    const b = copyOn(shared);
    const { taskId } = await callTool(a.background.tools(toolsModel()), "build_report", { period: "март" });
    void a.background.recover();
    await b.background.recover();
    await advance(15_000);
    expect(runsByPeriod(a, b)).toEqual(new Map([["март", 1]]));
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "running", attempt: 1 });
    a.runs[0]!.resolve("готово");
    await advance(1_000);
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "done", result: "готово" });
    // Медленный список ещё идёт: закрытие копии его дожидается.
    const flushed = Promise.all([a.background.flush(), b.background.flush()]);
    await advance(6_000);
    await flushed;
  });
});
