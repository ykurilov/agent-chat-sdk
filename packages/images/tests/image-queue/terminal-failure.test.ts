import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryImageJobStore } from "../../src/index";
import { fakeKie } from "../support/fake-kie";
import { deferred, fakeRunware } from "../support/fake-runware";
import type { ImageFailureEvent, ImageJob } from "../../src/index";
import { sqliteImageJobStore } from "../../src/sqlite";
import { flush, order, queueSetup, stopQueues } from "./queue-harness";

const releases: Array<() => void> = [];
const cleanups: Array<() => void | Promise<void>> = [];
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-25T00:00:00Z"), toFake: ["setTimeout", "clearTimeout", "Date"] }));
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await stopQueues();
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function providerFailure(status = 400, code = "providerBadRequest", message = "Request rejected by the safety system. safety_violations=[sexual].") {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ errors: [{ code, message }] }), { status }));
  return { fetch };
}
const setup = { model: "gpt-image-2", lateResultWindowMs: 0, failureRetryMs: 100, leaseMs: 100 };
async function placed(queue: ReturnType<typeof queueSetup>["queue"]): Promise<ImageJob> {
  const job = await queue.order(order);
  if (job.status === "refused") throw new Error(job.reason);
  await flush();
  return job;
}

describe("terminal image failure event", () => {
  it("content refusal persists before callback, is classified, and never resubmits even with attempts=3", async () => {
    const provider = providerFailure();
    const received: ImageFailureEvent[] = [];
    const { queue } = queueSetup(provider, { ...setup, attempts: 3, onFailed: async (event, context) => {
      expect(await context.isCurrent()).toBe(true);
      expect(await queue.get(event.job.id)).toMatchObject({ status: "failed", failure: { kind: "content" } });
      received.push(event);
    } });
    const job = await placed(queue);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ run: 1, job: { id: job.id, key: order.key, ownerId: order.ownerId }, failure: { kind: "content", providerCode: "providerBadRequest" } });
    expect(received[0]!.id).toContain(job.id);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("HTTP 200 provider content error also stops paid automatic attempts", async () => {
    const provider = providerFailure(200);
    const callback = vi.fn();
    const { queue } = queueSetup(provider, { ...setup, attempts: 3, onFailed: callback });
    const job = await placed(queue);
    expect(await queue.get(job.id)).toMatchObject({ status: "failed", failure: { kind: "content" } });
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each([
    [503, "serviceUnavailable", "temporary", "transient"],
    [402, "insufficientCredits", "no credit", "limits"],
    [401, "invalidApiKey", "bad key", "configuration"],
  ])("classifies HTTP %s terminal failures", async (status, code, message, kind) => {
    const received: ImageFailureEvent[] = [];
    const { queue } = queueSetup(providerFailure(status, code, message), { ...setup, onFailed: (event) => { received.push(event); } });
    await placed(queue);
    expect(received).toHaveLength(1);
    expect(received[0]!.failure.kind).toBe(kind);
  });

  it("callback failure survives SQLite close/reopen and reuses event id without another paid request", async () => {
    const folder = mkdtempSync(join(tmpdir(), "terminal-image-"));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const file = join(folder, "jobs.sqlite");
    const provider = providerFailure();
    const seen: string[] = [];
    const firstStore = sqliteImageJobStore(file);
    const { queue: first } = queueSetup(provider, { ...setup, store: firstStore, onFailed: (event) => {
      seen.push(event.id);
      throw new Error("outbox unavailable");
    } });
    const job = await placed(first);
    expect(seen).toHaveLength(1);
    expect((await firstStore.get(job.id))?.active).toBe(true);
    await first.stop();
    await firstStore.close?.();
    await vi.advanceTimersByTimeAsync(101);
    const secondStore = sqliteImageJobStore(file);
    cleanups.push(() => secondStore.close?.());
    const { queue: second } = queueSetup(provider, { ...setup, store: secondStore, onFailed: (event) => { seen.push(event.id); } });
    await second.start();
    await flush();
    expect(seen).toEqual([seen[0], seen[0]]);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(await secondStore.get(job.id)).toMatchObject({ status: "failed", active: false, failureNotification: { attempts: 2 } });
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(seen).toHaveLength(2);
  });

  it("notification pending is not pruned and disabling callback does not acknowledge it", async () => {
    const store = memoryImageJobStore();
    const provider = providerFailure();
    const callback = vi.fn(() => { throw new Error("offline"); });
    const { queue } = queueSetup(provider, { ...setup, store, onFailed: callback });
    const job = await placed(queue);
    expect(callback).toHaveBeenCalledTimes(1);
    await queue.stop();
    expect(await store.deleteFinishedBefore("2099-01-01T00:00:00Z")).toBe(0);
    await vi.advanceTimersByTimeAsync(101);
    const { queue: withoutHook } = queueSetup(provider, { ...setup, store });
    await withoutHook.start();
    await flush();
    expect(await store.get(job.id)).toMatchObject({ active: true });
    expect((await store.get(job.id))!.failureNotification!.deliveredAt).toBeUndefined();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("late result window is not a terminal event; callback appears only after it expires", async () => {
    const received: ImageFailureEvent[] = [];
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const { queue } = queueSetup(kie, { attemptTimeoutMs: 100, lateResultWindowMs: 100, pollIntervalMs: 20, latePollIntervalMs: 20, leaseMs: 1000, onFailed: (event) => { received.push(event); } });
    const job = await placed(queue);
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(await queue.get(job.id)).toMatchObject({ status: "failed", lateUntil: expect.any(String) });
    expect(received).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(101);
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]!.failure.kind).toBe("transient");
    expect(kie.tasks).toHaveLength(1);
  });

  it("second copy cannot deliver the event while first callback holds a renewed lease", async () => {
    const store = memoryImageJobStore();
    const provider = providerFailure();
    const hold = deferred<void>();
    releases.push(() => hold.resolve());
    const one = vi.fn(async () => hold.promise);
    const two = vi.fn();
    const { queue: first } = queueSetup(provider, { ...setup, store, onFailed: one });
    await placed(first);
    expect(one).toHaveBeenCalledTimes(1);
    const { queue: second } = queueSetup(provider, { ...setup, store, onFailed: two });
    await vi.advanceTimersByTimeAsync(350);
    await second.start();
    await flush();
    expect(two).not.toHaveBeenCalled();
    hold.resolve();
    await flush();
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("list exposes content classification and retry refuses the same prompt, including legacy reasons", async () => {
    const store = memoryImageJobStore();
    const provider = providerFailure();
    const { queue } = queueSetup(provider, { ...setup, store });
    const job = await placed(queue);
    expect((await queue.list({ ownerId: order.ownerId }))[0]).toMatchObject({ failure: { kind: "content" } });
    expect(await queue.retry({ ownerId: order.ownerId, key: order.key })).toMatchObject({ status: "refused" });
    const record = (await store.get(job.id))!;
    await store.update(job.id, { failure: undefined }, record.version);
    expect(await queue.get(job.id)).toMatchObject({ failure: { kind: "content" } });
    expect(await queue.retry({ ownerId: order.ownerId, key: order.key })).toMatchObject({ status: "refused" });
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("configuration removed across restart emits failure without resubmitting provider work", async () => {
    const store = memoryImageJobStore();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const { queue: first } = queueSetup(kie, { store, model: undefined, purposes: { plain: { model: "z-image" } } });
    const job = await first.order({ ...order, purpose: "plain" });
    await first.stop();
    const received: ImageFailureEvent[] = [];
    const { queue: second } = queueSetup(kie, { store, model: undefined, purposes: { other: { model: "z-image" } }, onFailed: e => { received.push(e); } });
    await second.start();
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]!.job.id).toBe("id" in job ? job.id : "unexpected refusal");
    expect(received[0]!.failure.kind).toBe("configuration");
    expect(kie.tasks).toHaveLength(1);
  });

  it("conditional retry refuses a different selected job or run, while a matching run retries once", async () => {
    const store = memoryImageJobStore();
    const provider = providerFailure(503, "busy", "temporary");
    const { queue } = queueSetup(provider, { ...setup, store });
    const job = await placed(queue);
    const input = { ownerId: order.ownerId, key: order.key, expectedJobId: job.id, expectedRun: 1 };
    expect(await queue.retry({ ...input, expectedJobId: "different" })).toBeNull();
    expect(await queue.retry({ ...input, expectedRun: 2 })).toBeNull();
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(await queue.retry(input)).toMatchObject({ id: job.id, status: "failed" });
    expect((await store.get(job.id))!.run).toBe(2);
    expect(await queue.retry(input)).toBeNull();
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("conditional retry never selects the newer job on the same key", async () => {
    const provider = providerFailure(503, "busy", "temporary");
    const { queue } = queueSetup(provider, setup);
    const old = await placed(queue);
    const newer = await placed(queue);
    expect(newer.id).not.toBe(old.id);
    expect(await queue.retry({ ownerId: order.ownerId, key: order.key, expectedJobId: old.id, expectedRun: 1 })).toBeNull();
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("conditional retry does not roll forward to another run after losing the CAS", async () => {
    const store = memoryImageJobStore();
    const provider = providerFailure(503, "busy", "temporary");
    const { queue } = queueSetup(provider, { ...setup, store });
    const job = await placed(queue);
    const entered = deferred<void>();
    const hold = deferred<void>();
    releases.push(() => hold.resolve());
    const original = store.update.bind(store);
    let armed = true;
    vi.spyOn(store, "update").mockImplementation(async (id, patch, version) => {
      if (armed && patch.status === "generating") { armed = false; entered.resolve(); await hold.promise; }
      return original(id, patch, version);
    });
    const pending = queue.retry({ ownerId: order.ownerId, key: order.key, expectedJobId: job.id, expectedRun: 1 });
    await entered.promise;
    const current = (await store.get(job.id))!;
    await original(job.id, { run: 2, status: "failed" }, current.version);
    hold.resolve();
    expect(await pending).toBeNull();
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect((await store.get(job.id))!.run).toBe(2);
  });

  it("conditional retry is not coalesced with an unrelated manual retry", async () => {
    const provider = providerFailure(503, "busy", "temporary");
    const { queue, limits } = queueSetup(provider, setup);
    const job = await placed(queue);
    const entered = deferred<void>();
    const hold = deferred<void>();
    releases.push(() => hold.resolve());
    limits.assertWithinLimit.mockImplementationOnce(async () => { entered.resolve(); await hold.promise; });
    const manual = queue.retry({ ownerId: order.ownerId, key: order.key });
    await entered.promise;
    const conditional = queue.retry({ ownerId: order.ownerId, key: order.key, expectedJobId: job.id, expectedRun: 1 });
    hold.resolve();
    expect(await manual).toMatchObject({ status: "failed" });
    expect(await conditional).toBeNull();
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("conditional retry requires both guard fields", async () => {
    const provider = providerFailure(503, "busy", "temporary");
    const { queue } = queueSetup(provider, setup);
    const job = await placed(queue);
    await expect(queue.retry({ ownerId: order.ownerId, key: order.key, expectedJobId: job.id })).rejects.toThrow(TypeError);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("expired callback lease is never acknowledged, including a skipped callback (checkContext=%s)", async (checkContext) => {
    const store = memoryImageJobStore();
    const provider = providerFailure();
    const ids: string[] = [];
    let current: boolean | undefined;
    const { queue: first } = queueSetup(provider, { ...setup, store, onFailed: async (event, context) => {
      ids.push(event.id);
      vi.setSystemTime(Date.now() + 1000); // Lease expires without running its heartbeat timer.
      if (checkContext) current = await context.isCurrent();
    } });
    const job = await placed(first);
    await flush();
    expect((await store.get(job.id))!.failureNotification!.deliveredAt).toBeUndefined();
    if (checkContext) expect(current).toBe(false);
    await first.stop();
    const { queue: second } = queueSetup(provider, { ...setup, store, onFailed: e => { ids.push(e.id); } });
    await second.start();
    await flush();
    expect(ids).toEqual([ids[0], ids[0]]);
    expect((await store.get(job.id))!.failureNotification!.deliveredAt).toEqual(expect.any(String));
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("no failure callback for successful or discarded result", async () => {
    const callback = vi.fn();
    const done = deferred<void>();
    const { queue } = queueSetup(fakeRunware(), { ...setup, onFailed: callback, deliver: () => { done.resolve(); return false; } });
    const job = await placed(queue);
    await done.promise;
    await flush();
    expect(await queue.get(job.id)).toMatchObject({ status: "discarded" });
    expect(callback).not.toHaveBeenCalled();
  });
});
