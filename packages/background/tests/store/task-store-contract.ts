import { describe, expect, it } from "vitest";
import type { TaskRecord, TaskStore } from "../../src/types";

/** Две ручки на одну базу: так копии сервера видят одни задачи. У памяти — одно и то же хранилище. */
export interface SharedTaskStores {
  first: TaskStore;
  second: TaskStore;
  close(): Promise<void>;
}

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, seconds)).toISOString();

let counter = 0;
export function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  counter += 1;
  return {
    id: `task-${counter}`,
    ownerId: "anna",
    chatId: "chat-1",
    messageId: "message-1",
    toolCallId: `call-${counter}`,
    channel: "web",
    kind: "tool",
    name: "build_report",
    input: { period: "март" },
    title: "Отчёт за март",
    status: "queued",
    attempt: 0,
    createdAt: at(counter % 50),
    ...overrides,
  };
}

/** Общий контракт `TaskStore`: память, SQLite и Postgres ведут себя одинаково. */
export function describeTaskStoreContract(open: () => Promise<SharedTaskStores>): void {
  async function withStores(check: (stores: SharedTaskStores) => Promise<void>): Promise<void> {
    const stores = await open();
    try {
      await check(stores);
    } finally {
      await stores.close();
    }
  }

  describe("контракт TaskStore", () => {
    it("задача пишется и читается целиком: json-поля, шаги помощника, времена до миллисекунд", () =>
      withStores(async ({ first }) => {
        const task = taskRecord({
          kind: "helper",
          name: "researcher",
          input: { task: "найди «цены»", nested: [1, { deep: true }] },
          helperMessages: [
            { role: "user", content: "найди цены" },
            { role: "assistant", content: [{ type: "text", text: "ищу" }] },
          ],
          progress: { task: "найди цены", steps: [{ type: "text", text: "ищу" }], text: "ищу", status: "running" },
          leaseOwner: "copy-a",
          leaseUntil: "2026-10-05T12:00:30.123Z",
          createdAt: "2026-10-05T12:00:00.007Z",
          channel: "telegram",
        });
        await first.create(task);
        expect(await first.get("anna", task.id)).toEqual(task);
      }),
    );

    it("чужой человек задачу не видит и не меняет", () =>
      withStores(async ({ first }) => {
        const task = taskRecord();
        await first.create(task);
        expect(await first.get("boris", task.id)).toBeNull();
        expect(await first.update("boris", task.id, { status: "canceled" })).toBeNull();
        expect((await first.get("anna", task.id))?.status).toBe("queued");
        expect(await first.listForChat("boris", task.chatId)).toEqual([]);
      }),
    );

    it("update меняет только переданные поля; undefined стирает поле", () =>
      withStores(async ({ first }) => {
        const task = taskRecord({ leaseOwner: "copy-a", leaseUntil: at(30), error: "старое" });
        await first.create(task);
        const updated = await first.update("anna", task.id, {
          status: "done",
          result: { rows: 3, text: "готово" },
          finishedAt: at(40),
          error: undefined,
          leaseOwner: undefined,
          leaseUntil: undefined,
        });
        const expected: TaskRecord = { ...task, status: "done", result: { rows: 3, text: "готово" }, finishedAt: at(40) };
        delete expected.error;
        delete expected.leaseOwner;
        delete expected.leaseUntil;
        expect(updated).toEqual(expected);
        expect(await first.get("anna", task.id)).toEqual(expected);
        expect(await first.update("anna", "нет-такой", { status: "done" })).toBeNull();
      }),
    );

    it("update с условием: пишет, только если аренда у этой копии и статус из списка; иначе null и запись прежняя", () =>
      withStores(async ({ first, second }) => {
        const task = taskRecord({ status: "running", leaseOwner: "copy-a", leaseUntil: at(30) });
        await first.create(task);
        expect(await second.update("anna", task.id, { status: "done" }, { leaseOwner: "copy-b" })).toBeNull();
        expect(await second.update("anna", task.id, { status: "canceled" }, { statuses: ["queued", "awaiting_approval"] })).toBeNull();
        expect(await second.update("anna", task.id, { status: "done" }, { leaseOwner: "copy-a", statuses: ["queued"] })).toBeNull();
        expect(await first.get("anna", task.id)).toEqual(task);
        expect(await second.update("boris", task.id, { status: "done" }, { leaseOwner: "copy-a" })).toBeNull();
        expect(await second.update("anna", task.id, { status: "done" }, { leaseOwner: "copy-a", statuses: ["running"] })).toMatchObject({ status: "done" });
        expect(await first.update("anna", task.id, { error: "x" }, { statuses: ["queued", "running"] })).toBeNull();
        expect((await first.get("anna", task.id))?.status).toBe("done");
        // Задача без аренды под условие аренды не подходит.
        const free = taskRecord();
        await first.create(free);
        expect(await first.update("anna", free.id, { status: "done" }, { leaseOwner: "copy-a" })).toBeNull();
      }),
    );

    it("update с условием по вопросу: пишет, только если задача ждёт ответа на этот же вопрос", () =>
      withStores(async ({ first, second }) => {
        const pendingApproval = { approvalId: "approval-2", toolName: "send_email", input: { to: "boss@example.com" } };
        const task = taskRecord({ status: "awaiting_approval", progress: { task: "Найди цены", steps: [], text: "", status: "awaiting_approval", pendingApproval } });
        await first.create(task);
        expect(await second.update("anna", task.id, { status: "running" }, { statuses: ["awaiting_approval"], pendingApprovalId: "approval-1" })).toBeNull();
        expect(await first.get("anna", task.id)).toEqual(task);
        expect(await second.update("anna", task.id, {}, { pendingApprovalId: "approval-1" })).toBeNull();
        expect(await second.update("anna", task.id, { status: "running" }, { statuses: ["awaiting_approval"], pendingApprovalId: "approval-2" })).toMatchObject({ status: "running" });
        // Задача без вопроса под условие вопроса не подходит.
        const plain = taskRecord();
        await first.create(plain);
        expect(await first.update("anna", plain.id, { status: "done" }, { pendingApprovalId: "approval-2" })).toBeNull();
      }),
    );

    it("ключ доставки хранится и стирается как обычное поле", () =>
      withStores(async ({ first, second }) => {
        const task = taskRecord({ status: "done" });
        await first.create(task);
        expect(await first.update("anna", task.id, { deliveryKey: `task:${task.id}+task:other` })).toMatchObject({ deliveryKey: `task:${task.id}+task:other` });
        expect((await second.listUndelivered("anna", task.chatId))[0]?.deliveryKey).toBe(`task:${task.id}+task:other`);
        expect(await second.update("anna", task.id, { deliveryKey: undefined })).not.toHaveProperty("deliveryKey");
      }),
    );

    it("результат-строка хранится строкой; нет результата — нет поля", () =>
      withStores(async ({ first }) => {
        const text = taskRecord({ status: "done", result: "просто строка" });
        const nothing = taskRecord({ status: "done" });
        await first.create(text);
        await first.create(nothing);
        expect((await first.get("anna", text.id))?.result).toBe("просто строка");
        expect(await first.get("anna", nothing.id)).not.toHaveProperty("result");
      }),
    );

    it("listForChat — задачи одного чата человека по времени создания", () =>
      withStores(async ({ first }) => {
        const later = taskRecord({ createdAt: at(20), chatId: "chat-list" });
        const earlier = taskRecord({ createdAt: at(10), chatId: "chat-list" });
        await first.create(later);
        await first.create(earlier);
        await first.create(taskRecord({ chatId: "chat-other" }));
        await first.create(taskRecord({ chatId: "chat-list", ownerId: "boris" }));
        expect((await first.listForChat("anna", "chat-list")).map((task) => task.id)).toEqual([earlier.id, later.id]);
      }),
    );

    it("countActive считает только ждущие и идущие задачи человека; пауза ради подтверждения не в счёт", () =>
      withStores(async ({ first }) => {
        for (const status of ["queued", "running", "running", "awaiting_approval", "done", "failed", "canceled", "interrupted", "timed_out"] as const) {
          await first.create(taskRecord({ ownerId: "count-owner", status }));
        }
        await first.create(taskRecord({ ownerId: "someone-else", status: "running" }));
        expect(await first.countActive("count-owner")).toBe(3);
      }),
    );

    describe("аренда", () => {
      it("claim берёт свободную задачу: running, попытка +1, время запуска, хозяин аренды", () =>
        withStores(async ({ first }) => {
          const task = taskRecord();
          await first.create(task);
          const claimed = await first.claim(task.id, "copy-a", at(30), at(1));
          expect(claimed).toEqual({ ...task, status: "running", attempt: 1, startedAt: at(1), leaseOwner: "copy-a", leaseUntil: at(30) });
          expect(await first.get("anna", task.id)).toEqual(claimed);
        }),
      );

      it("задачу под чужой живой арендой не взять; создатель берёт свою сразу", () =>
        withStores(async ({ first, second }) => {
          const task = taskRecord({ leaseOwner: "copy-a", leaseUntil: at(30) });
          await first.create(task);
          expect(await second.claim(task.id, "copy-b", at(60), at(1))).toBeNull();
          expect((await first.claim(task.id, "copy-a", at(31), at(1)))?.leaseOwner).toBe("copy-a");
          expect(await second.claim(task.id, "copy-b", at(60), at(5))).toBeNull();
        }),
      );

      it("две копии берут одну задачу одновременно — достаётся одной", () =>
        withStores(async ({ first, second }) => {
          const tasks = Array.from({ length: 10 }, () => taskRecord());
          for (const task of tasks) await first.create(task);
          const results = await Promise.all(
            tasks.flatMap((task) => [first.claim(task.id, "copy-a", at(30), at(1)), second.claim(task.id, "copy-b", at(30), at(1))]),
          );
          for (let index = 0; index < tasks.length; index += 1) {
            const pair = results.slice(index * 2, index * 2 + 2).filter(Boolean);
            expect(pair, tasks[index]!.id).toHaveLength(1);
          }
        }),
      );

      it("после истечения аренды задачу забирает другая копия, старый хозяин продлить уже не может", () =>
        withStores(async ({ first, second }) => {
          const task = taskRecord();
          await first.create(task);
          await first.claim(task.id, "copy-a", at(30), at(1));
          expect(await second.claim(task.id, "copy-b", at(60), at(30))).toBeNull();
          const taken = await second.claim(task.id, "copy-b", at(61), at(31));
          expect(taken).toMatchObject({ status: "running", attempt: 2, leaseOwner: "copy-b", leaseUntil: at(61), startedAt: at(1) });
          expect(await first.renewLease(task.id, "copy-a", at(45))).toBe(false);
          expect(await second.renewLease(task.id, "copy-b", at(55))).toBe(true);
          expect((await first.get("anna", task.id))?.leaseUntil).toBe(at(55));
        }),
      );

      it("законченную недоставленную задачу claim отдаёт без смены статуса и попытки; доставленную — нет", () =>
        withStores(async ({ first, second }) => {
          const finished = taskRecord({ status: "done", attempt: 1, result: "ok", finishedAt: at(5), leaseOwner: "copy-a", leaseUntil: at(10) });
          const paused = taskRecord({ status: "awaiting_approval", attempt: 1, leaseOwner: "copy-a", leaseUntil: at(10) });
          const delivered = taskRecord({ status: "done", attempt: 1, deliveredAt: at(6) });
          for (const task of [finished, paused, delivered]) await first.create(task);
          expect(await second.claim(finished.id, "copy-b", at(60), at(11))).toEqual({ ...finished, leaseOwner: "copy-b", leaseUntil: at(60) });
          expect(await second.claim(paused.id, "copy-b", at(60), at(11))).toEqual({ ...paused, leaseOwner: "copy-b", leaseUntil: at(60) });
          expect(await second.claim(delivered.id, "copy-b", at(60), at(11))).toBeNull();
        }),
      );

      it("продлевает только хозяин; после отметки о доставке аренды нет", () =>
        withStores(async ({ first }) => {
          const task = taskRecord();
          await first.create(task);
          await first.claim(task.id, "copy-a", at(30), at(1));
          expect(await first.renewLease(task.id, "copy-b", at(40))).toBe(false);
          expect(await first.renewLease(task.id, "copy-a", at(40))).toBe(true);
          await first.update("anna", task.id, { status: "done", finishedAt: at(5), deliveryKey: `task:${task.id}` });
          expect(await first.renewLease(task.id, "copy-a", at(41))).toBe(true);
          await first.markDelivered([task.id], `task:${task.id}`, at(6));
          expect(await first.renewLease(task.id, "copy-a", at(42))).toBe(false);
          const stored = await first.get("anna", task.id);
          expect(stored).toMatchObject({ deliveredAt: at(6) });
          expect(stored).not.toHaveProperty("leaseOwner");
          expect(stored).not.toHaveProperty("leaseUntil");
          expect(await first.renewLease("нет-такой", "copy-a", at(42))).toBe(false);
        }),
      );

      it("listExpired — недоставленные задачи с истёкшей арендой у всех людей", () =>
        withStores(async ({ first }) => {
          const now = at(40);
          const expiredRunning = taskRecord({ ownerId: "exp-1", status: "running", attempt: 1, leaseOwner: "copy-a", leaseUntil: at(39) });
          const expiredDone = taskRecord({ ownerId: "exp-2", status: "done", attempt: 1, leaseOwner: "copy-a", leaseUntil: at(10) });
          const alive = taskRecord({ ownerId: "exp-1", status: "running", attempt: 1, leaseOwner: "copy-a", leaseUntil: at(41) });
          const exactlyNow = taskRecord({ ownerId: "exp-1", status: "running", attempt: 1, leaseOwner: "copy-a", leaseUntil: now });
          const delivered = taskRecord({ ownerId: "exp-1", status: "done", attempt: 1, leaseUntil: at(1), deliveredAt: at(2) });
          for (const task of [expiredRunning, expiredDone, alive, exactlyNow, delivered]) await first.create(task);
          const ids = (await first.listExpired(now)).map((task) => task.id);
          expect(ids.sort()).toEqual([expiredRunning.id, expiredDone.id].sort());
        }),
      );

      it("listUndelivered — законченные и ждущие подтверждения задачи чата без отметки о доставке", () =>
        withStores(async ({ first }) => {
          const chatId = "chat-undelivered";
          const done = taskRecord({ chatId, status: "done", finishedAt: at(3), deliveryKey: "batch" });
          const failed = taskRecord({ chatId, status: "failed", finishedAt: at(2), deliveryKey: "batch" });
          const paused = taskRecord({ chatId, status: "awaiting_approval" });
          const running = taskRecord({ chatId, status: "running" });
          const delivered = taskRecord({ chatId, status: "done", deliveredAt: at(4) });
          const foreign = taskRecord({ chatId, ownerId: "boris", status: "done" });
          for (const task of [done, failed, paused, running, delivered, foreign]) await first.create(task);
          const ids = (await first.listUndelivered("anna", chatId)).map((task) => task.id);
          expect(ids.sort()).toEqual([done.id, failed.id, paused.id].sort());
          await first.markDelivered([done.id, failed.id], "batch", at(5));
          expect((await first.listUndelivered("anna", chatId)).map((task) => task.id)).toEqual([paused.id]);
          await first.markDelivered([], "batch", at(6));
        }),
      );

      it("markDelivered отмечает только задачи доставленной пачки, которые всё ещё ждут доставки: продолженную и отменённую не трогает", () =>
        withStores(async ({ first, second }) => {
          const chatId = "chat-mark";
          const lease = { leaseOwner: "copy-b", leaseUntil: at(30) };
          const delivered = taskRecord({ chatId, status: "awaiting_approval", deliveryKey: "batch", leaseOwner: "copy-a", leaseUntil: at(30) });
          // Пока шла доставка, человек ответил «Разрешить»: задача снова в работе, ключ сброшен, аренда у копии B.
          const resumed = taskRecord({ chatId, status: "running", attempt: 1, ...lease });
          // …или отменил: пометку «отменена» доставит копия B своей пачкой.
          const canceled = taskRecord({ chatId, status: "canceled", finishedAt: at(5), ...lease });
          const otherBatch = taskRecord({ chatId, status: "done", deliveryKey: "other", ...lease });
          const runningWithKey = taskRecord({ chatId, status: "running", attempt: 1, deliveryKey: "batch", ...lease });
          for (const task of [delivered, resumed, canceled, otherBatch, runningWithKey]) await first.create(task);
          await second.markDelivered([delivered.id, resumed.id, canceled.id, otherBatch.id, runningWithKey.id], "batch", at(6));
          expect(await first.get("anna", delivered.id)).toMatchObject({ deliveredAt: at(6) });
          for (const task of [resumed, canceled, otherBatch, runningWithKey]) expect(await first.get("anna", task.id)).toEqual(task);
          expect(await first.renewLease(resumed.id, "copy-b", at(40))).toBe(true);
        }),
      );
    });

    it("deleteForChat удаляет задачи одного чата одного человека", () =>
      withStores(async ({ first }) => {
        const gone = taskRecord({ chatId: "chat-delete" });
        const otherChat = taskRecord({ chatId: "chat-keep" });
        const otherOwner = taskRecord({ chatId: "chat-delete", ownerId: "boris" });
        for (const task of [gone, otherChat, otherOwner]) await first.create(task);
        await first.deleteForChat("anna", "chat-delete");
        expect(await first.get("anna", gone.id)).toBeNull();
        expect(await first.get("anna", otherChat.id)).not.toBeNull();
        expect(await first.get("boris", otherOwner.id)).not.toBeNull();
      }),
    );

    it("запись одной ручки сразу видна другой", () =>
      withStores(async ({ first, second }) => {
        const task = taskRecord();
        await first.create(task);
        await second.update("anna", task.id, { progress: { task: "x", steps: [], text: "половина", status: "running" } });
        expect((await first.get("anna", task.id))?.progress?.text).toBe("половина");
      }),
    );
  });
}
