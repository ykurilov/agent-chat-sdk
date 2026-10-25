import { describe, expect, it } from "vitest";
import { ImageJobKeyTakenError } from "../../src/image-queue/image-job-store";
import type { ImageJobRecord, ImageJobStore } from "../../src/image-queue/image-job-store";

export function jobRecord(overrides: Partial<ImageJobRecord> = {}): ImageJobRecord {
  return {
    id: "job-1",
    key: "app-1/img/hero.webp",
    ownerId: "anna",
    chatId: "chat-1",
    turnId: "answer-1",
    group: "app-1",
    purpose: "plain",
    prompt: "Красное яблоко",
    aspectRatio: "1:1",
    data: { path: "img/hero.webp", size: 512 },
    status: "generating",
    active: true,
    run: 1,
    attempt: 1,
    attemptDeadline: "2026-10-05T10:01:30.000Z",
    steps: [{ task: { usageId: "u-1", modelId: "z-image", providerId: "kie", priceUsd: 0.005, sentAt: "2026-10-05T10:00:00.000Z", taskId: "task-1" }, charges: [] }],
    leaseOwner: "copy-a",
    leaseUntil: "2026-10-05T10:00:30.000Z",
    version: 1,
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    ...overrides,
  };
}

/** Один договор для памяти, SQLite и PostgreSQL. `open` — новое хранилище на той же базе (как после перезапуска). */
export function describeImageJobStoreContract(name: string, fresh: () => Promise<{ store: ImageJobStore; reopen(): Promise<ImageJobStore> }>) {
  describe(`хранилище задач картинок: ${name}`, () => {
    it("вставка и чтение: запись возвращается как была, вместе с данными приложения и шагами", async () => {
      const { store } = await fresh();
      const job = jobRecord();
      await store.insert(job);
      expect(await store.get("job-1")).toEqual(job);
      expect(await store.get("нет")).toBeNull();
      await store.close?.();
    });

    it("непринятое событие сбоя сохраняется после reopen, не удаляется чисткой, ack допускает чистку", async () => {
      const { store, reopen } = await fresh();
      const failure = { kind: "content" as const, reason: "safety_violations=[sexual]", providerCode: "providerBadRequest" };
      const failureNotification = { id: "image-failed:job-1:1", attempts: 1, nextAttemptAt: "2026-10-05T10:05:00.000Z" };
      await store.insert(jobRecord({ status: "failed", active: true, failure, failureNotification, leaseOwner: undefined, leaseUntil: undefined, finishedAt: "2026-10-05T10:00:00.000Z" }));
      const next = await reopen();
      try {
        expect(await next.get("job-1")).toMatchObject({ failure, failureNotification });
        expect((await next.listResumable("2026-10-05T10:06:00.000Z")).map((job) => job.id)).toEqual(["job-1"]);
        expect(await next.deleteFinishedBefore("2099-01-01T00:00:00.000Z")).toBe(0);
        await next.update("job-1", { active: false, failureNotification: { ...failureNotification, deliveredAt: "2026-10-05T10:06:00.000Z" } }, 1);
        expect(await next.deleteFinishedBefore("2099-01-01T00:00:00.000Z")).toBe(1);
      } finally { await next.close?.(); await store.close?.(); }
    });

    it("пустые необязательные поля не появляются как null", async () => {
      const { store } = await fresh();
      const { turnId: _turn, group: _group, data: _data, leaseOwner: _owner, leaseUntil: _until, ...bare } = jobRecord();
      await store.insert(bare);
      expect(await store.get("job-1")).toEqual(bare);
      await store.close?.();
    });

    it("условная запись: та же версия — правка и версия +1; старая версия — null и запись прежняя; undefined стирает поле", async () => {
      const { store } = await fresh();
      await store.insert(jobRecord());
      const updated = await store.update("job-1", { attempt: 2, leaseOwner: undefined, reason: "не успела" }, 1);
      expect(updated).toMatchObject({ attempt: 2, reason: "не успела", version: 2 });
      expect(updated).not.toHaveProperty("leaseOwner");
      expect(await store.update("job-1", { attempt: 3 }, 1)).toBeNull();
      expect(await store.get("job-1")).toMatchObject({ attempt: 2, version: 2 });
      expect(await store.update("нет", { attempt: 3 }, 1)).toBeNull();
      await store.close?.();
    });

    it("две правки с одной версией: проходит ровно одна", async () => {
      const { store } = await fresh();
      await store.insert(jobRecord());
      const results = await Promise.all([store.update("job-1", { run: 2 }, 1), store.update("job-1", { run: 3 }, 1)]);
      expect(results.filter((result) => result !== null)).toHaveLength(1);
      await store.close?.();
    });

    it("список по владельцу, ключу, группе и чату — по порядку создания", async () => {
      const { store } = await fresh();
      await store.insert(jobRecord({ id: "b", createdAt: "2026-10-05T10:00:02.000Z" }));
      await store.insert(jobRecord({ id: "a", createdAt: "2026-10-05T10:00:01.000Z", status: "superseded", active: false }));
      await store.insert(jobRecord({ id: "c", ownerId: "boris", group: "app-2", key: "app-2/x.webp", chatId: "chat-2" }));
      expect((await store.list({ ownerId: "anna" })).map((job) => job.id)).toEqual(["a", "b"]);
      expect((await store.list({ ownerId: "anna", key: "app-1/img/hero.webp" })).map((job) => job.id)).toEqual(["a", "b"]);
      expect((await store.list({ group: "app-2" })).map((job) => job.id)).toEqual(["c"]);
      expect((await store.list({ chatId: "chat-2" })).map((job) => job.id)).toEqual(["c"]);
      await store.close?.();
    });

    it("listResumable: задачи с работой и свободной или истёкшей арендой; законченные и чужие живые — нет", async () => {
      const { store } = await fresh();
      await store.insert(jobRecord({ id: "expired", key: "a.webp", leaseUntil: "2026-10-05T10:00:30.000Z" }));
      await store.insert(jobRecord({ id: "free", key: "b.webp", leaseOwner: undefined, leaseUntil: undefined }));
      await store.insert(jobRecord({ id: "alive", key: "c.webp", leaseUntil: "2026-10-05T10:05:00.000Z" }));
      await store.insert(jobRecord({ id: "done", status: "ready", active: false, leaseOwner: undefined, leaseUntil: undefined }));
      const ids = (await store.listResumable("2026-10-05T10:01:00.000Z")).map((job) => job.id).sort();
      expect(ids).toEqual(["expired", "free"]);
      await store.close?.();
    });

    it("deleteFinishedBefore: удаляет только законченные без работы раньше срока", async () => {
      const { store } = await fresh();
      await store.insert(jobRecord({ id: "old", status: "ready", active: false, finishedAt: "2026-10-04T10:00:00.000Z" }));
      await store.insert(jobRecord({ id: "fresh", status: "ready", active: false, finishedAt: "2026-10-05T10:00:00.000Z" }));
      await store.insert(jobRecord({ id: "late", status: "failed", active: true, finishedAt: "2026-10-04T10:00:00.000Z" }));
      await store.insert(jobRecord({ id: "working" }));
      expect(await store.deleteFinishedBefore("2026-10-05T00:00:00.000Z")).toBe(1);
      expect((await store.list({})).map((job) => job.id).sort()).toEqual(["fresh", "late", "working"]);
      await store.close?.();
    });

    it("одна открытая задача на место: вторая открытая на того же владельца и ключ — ImageJobKeyTakenError", async () => {
      const { store } = await fresh();
      await store.insert(jobRecord({ id: "first" }));
      await expect(store.insert(jobRecord({ id: "second" }))).rejects.toBeInstanceOf(ImageJobKeyTakenError);
      // Позднее окно — тоже открыта: задача у провайдера ещё опрашивается.
      await store.update("first", { status: "failed", lateUntil: "2026-10-05T10:10:00.000Z" }, 1);
      await expect(store.insert(jobRecord({ id: "second" }))).rejects.toBeInstanceOf(ImageJobKeyTakenError);
      // У другого владельца, другое место или закрытая — можно.
      await store.insert(jobRecord({ id: "boris", ownerId: "boris" }));
      await store.insert(jobRecord({ id: "other", key: "app-1/img/other.webp" }));
      await store.insert(jobRecord({ id: "done", status: "ready", active: false }));
      expect((await store.list({ ownerId: "anna", key: "app-1/img/hero.webp" })).map((job) => job.id).sort()).toEqual(["done", "first"]);
      await store.close?.();
    });

    it("после закрытия прежней новая открытая вставляется; открыть закрытую снова при открытой — ImageJobKeyTakenError", async () => {
      const { store } = await fresh();
      await store.insert(jobRecord({ id: "first" }));
      await store.update("first", { status: "superseded", active: false }, 1);
      await store.insert(jobRecord({ id: "second" }));
      await expect(store.update("first", { status: "generating", active: true }, 2)).rejects.toBeInstanceOf(ImageJobKeyTakenError);
      expect(await store.get("first")).toMatchObject({ status: "superseded", version: 2 });
      await store.update("second", { status: "failed" }, 1);
      expect(await store.update("first", { status: "generating" }, 2)).toMatchObject({ status: "generating", version: 3 });
      await store.close?.();
    });

    it("новое хранилище на той же базе видит записанное (перезапуск сервера)", async () => {
      const { store, reopen } = await fresh();
      await store.insert(jobRecord());
      await store.update("job-1", { attempt: 2 }, 1);
      await store.close?.();
      const again = await reopen();
      expect(await again.get("job-1")).toMatchObject({ attempt: 2, version: 2, data: { path: "img/hero.webp", size: 512 } });
      await again.close?.();
    });
  });
}
