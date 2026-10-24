import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFlow, type AgentFlow } from "../../src/format";
import type { FlowPendingDelivery, FlowStore, PendingFlowChange, PinFlowChatInput } from "../../src/store/flow-store";

/** Две ручки на одну базу: так копии сервера видят одни чаты. У памяти — одно и то же хранилище. */
export interface SharedFlowStores {
  first: FlowStore;
  second: FlowStore;
  close(): Promise<void>;
}

/** Время по секундам от полудня 13.10.2026, с миллисекундами: база не должна их терять. */
export const at = (seconds: number, ms = 0) => new Date(Date.UTC(2026, 9, 13, 12, 0, 0, ms) + seconds * 1000).toISOString();

export function exampleFlow(): AgentFlow {
  const json = JSON.parse(readFileSync(new URL("../fixtures/sales-review.json", import.meta.url), "utf8"));
  const result = parseFlow(json);
  if (!result.ok) throw new Error("пример сценария не разобрался");
  return result.flow;
}

let counter = 0;
export function chatInput(overrides: Partial<PinFlowChatInput> = {}): PinFlowChatInput {
  counter += 1;
  return {
    chatId: `chat-${counter}`,
    ownerId: "anna",
    flowId: "sales-review",
    versionId: "v1",
    stateId: "intro",
    timeZone: "Europe/Moscow",
    at: at(0),
    ...overrides,
  };
}

const judged = (key: string, branchHead: string | null = "msg-7"): Extract<PendingFlowChange, { kind: "transition" }> => ({
  kind: "transition",
  key,
  branchHead,
  transition: { from: "intro", to: "block", exitId: "x1", decidedBy: "judge", probability: 0.82, tags: ["продажа", "«горячий»"], at: Date.UTC(2026, 9, 13, 12) },
});

/** Общий договор `FlowStore`: память, SQLite и PostgreSQL ведут себя одинаково. */
export function describeFlowStoreContract(open: () => Promise<SharedFlowStores>): void {
  async function withStores(check: (stores: SharedFlowStores) => Promise<void>): Promise<void> {
    const stores = await open();
    try {
      await check(stores);
    } finally {
      await stores.close();
    }
  }

  describe("договор FlowStore", () => {
    describe("закрепление чата", () => {
      it("закреплённый чат читается целиком, вторая копия видит его", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput({ at: at(1, 7) });
          const expected = {
            chatId: input.chatId,
            ownerId: "anna",
            flowId: "sales-review",
            versionId: "v1",
            stateId: "intro",
            pending: [],
            dueAt: null,
            dueExitId: null,
            dueBranchHead: null,
            timeZone: "Europe/Moscow",
            updatedAt: at(1, 7),
            endedAt: null,
            endReason: null,
            reopenedAt: null,
            pausedUntil: null,
            windowClosed: false,
            dayClosedOn: null,
            delivery: null,
            placement: null,
          };
          expect(await first.pinChat(input)).toEqual(expected);
          expect(await second.getChat(input.chatId)).toEqual(expected);
          expect(await second.getChat("нет-такого")).toBeNull();
        }));

      it("перенос чата: места startedAt/enteredAt сохраняются, видны второй копии и снимаются правкой", () =>
        withStores(async ({ first, second }) => {
          const placement = { startedAt: at(-3600, 5), enteredAt: at(-60, 7) };
          const input = chatInput({ stateId: "block", placement });
          expect(await first.pinChat(input)).toMatchObject({ stateId: "block", placement });
          expect(await second.getChat(input.chatId)).toMatchObject({ placement });
          expect(await second.updateChat(input.chatId, { placement: null }, at(5))).toMatchObject({ stateId: "block", placement: null });
          expect(await first.getChat(input.chatId)).toMatchObject({ placement: null });
        }));

      it("повторное закрепление ничего не меняет и возвращает прежнюю запись, даже одновременно из двух копий", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          const pinned = await first.pinChat(input);
          expect(await second.pinChat({ ...input, versionId: "v2", stateId: "block", timeZone: "Asia/Makassar", at: at(9) })).toEqual(pinned);

          const racing = chatInput();
          const [one, two] = await Promise.all([
            first.pinChat(racing),
            second.pinChat({ ...racing, versionId: "v9", at: at(5) }),
          ]);
          expect(one).toEqual(two);
          expect(await first.getChat(racing.chatId)).toEqual(one);
        }));

      it("правка меняет версию, состояние и пояс, ставит время правки; неизвестный чат — null", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          expect(await second.updateChat(input.chatId, { stateId: "block", timeZone: "Asia/Makassar" }, at(30))).toMatchObject({
            versionId: "v1",
            stateId: "block",
            timeZone: "Asia/Makassar",
            updatedAt: at(30),
          });
          expect(await first.updateChat(input.chatId, { versionId: "v2" }, at(31))).toMatchObject({ versionId: "v2", stateId: "block" });
          expect(await first.updateChat("нет-такого", { stateId: "x" }, at(32))).toBeNull();
          expect(await first.getChat("нет-такого")).toBeNull();
        }));

      it("удаление стирает чат вместе с ожидающим и таймером; удалить неизвестный — не ошибка", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.addPending(input.chatId, judged("judge:x1:m1"));
          await first.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: "m1" });
          await second.deleteChat(input.chatId);
          expect(await first.getChat(input.chatId)).toBeNull();
          expect(await first.takePending(input.chatId)).toEqual([]);
          expect(await first.leaseDue({ now: at(60), owner: "copy-a", leaseMs: 60_000, limit: 10 })).toEqual([]);
          await first.deleteChat("нет-такого");
        }));
    });

    describe("ожидающие изменения", () => {
      it("переход судьи с веткой, событие и перевод версии хранятся целиком и в порядке добавления", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          const changes: PendingFlowChange[] = [
            judged("judge:x1:msg-7"),
            judged("judge:x1:root", null),
            { kind: "event", key: "event:paid:1", name: "paid", data: { sum: 4900, items: ["разбор"], nested: { deep: true } }, at: at(2) },
            { kind: "migrate", key: "migrate:v2", versionId: "v2", map: { soft: "block" }, at: at(3) },
          ];
          for (const change of changes) await first.addPending(input.chatId, change);
          expect((await second.getChat(input.chatId))?.pending).toEqual(changes);
          const taken = await second.takePending(input.chatId);
          expect(taken).toEqual(changes);
          // Ветка, на которой судья решил переход: правка старого сообщения по ней снимает ожидание.
          expect(taken.slice(0, 2).map((change) => change.kind === "transition" && change.branchHead)).toEqual(["msg-7", null]);
          expect(await first.takePending(input.chatId)).toEqual([]);
          expect((await first.getChat(input.chatId))?.pending).toEqual([]);
        }));

      it("повтор с тем же ключом ничего не добавляет, даже из двух копий сразу", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.addPending(input.chatId, judged("judge:x1:m1"));
          await second.addPending(input.chatId, { kind: "event", key: "judge:x1:m1", name: "другое", at: at(1) });
          await Promise.all([first.addPending(input.chatId, judged("judge:x2:m1")), second.addPending(input.chatId, judged("judge:x2:m1"))]);
          const pending = await first.takePending(input.chatId);
          expect(pending.map((change) => change.key)).toEqual(["judge:x1:m1", "judge:x2:m1"]);
          expect(pending[0]).toEqual(judged("judge:x1:m1"));
        }));

      it("тот же ключ с `appliedAt` дописывает его к ожидающему: порядок и остальное — как были", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.addPending(input.chatId, judged("timer:x1:e1"));
          await first.addPending(input.chatId, judged("timer:x2:e1"));
          await second.addPending(input.chatId, { ...judged("timer:x1:e1", "другая"), appliedAt: at(5) });
          // Уже применённый не перезаписывается ни новым `appliedAt`, ни ожидающим без него.
          await first.addPending(input.chatId, { ...judged("timer:x1:e1"), appliedAt: at(9) });
          await first.addPending(input.chatId, judged("timer:x1:e1"));
          expect((await second.getChat(input.chatId))?.pending).toEqual([{ ...judged("timer:x1:e1"), appliedAt: at(5) }, judged("timer:x2:e1")]);
        }));

      it("переход, применённый в срок (`appliedAt`), остаётся после «забрать»: «Переделать» на той же ветке применит его снова", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          const applied = { ...judged("timer:x1:e1"), appliedAt: at(5) };
          await first.addPending(input.chatId, judged("judge:x2:m1"));
          await first.addPending(input.chatId, applied);
          await first.addPending(input.chatId, { kind: "event", key: "event:paid:1", name: "paid", at: at(6) });
          expect((await second.takePending(input.chatId)).map((change) => change.key)).toEqual(["judge:x2:m1", "timer:x1:e1", "event:paid:1"]);
          expect((await first.getChat(input.chatId))?.pending).toEqual([applied]);
          expect(await first.takePending(input.chatId)).toEqual([applied]);
        }));

      it("забрать ожидающее может только одна копия", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          for (let index = 0; index < 5; index += 1) await first.addPending(input.chatId, judged(`k${index}`));
          const [one, two] = await Promise.all([first.takePending(input.chatId), second.takePending(input.chatId)]);
          expect([one.length, two.length].sort()).toEqual([0, 5]);
        }));

      it("ожидающее к незакреплённому чату пропадает без ошибки и не создаёт чат", () =>
        withStores(async ({ first }) => {
          await first.addPending("нет-такого", judged("k"));
          expect(await first.getChat("нет-такого")).toBeNull();
          expect(await first.takePending("нет-такого")).toEqual([]);
        }));
    });

    describe("ближайший таймер и аренда", () => {
      const lease = (now: string, owner: string, limit = 10, leaseMs = 60_000) => ({ now, owner, leaseMs, limit });

      it("ближайший таймер пишется с веткой и стирается", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(120, 345), exitId: "x4", branchHead: "msg-9" });
          expect(await second.getChat(input.chatId)).toMatchObject({ dueAt: at(120, 345), dueExitId: "x4", dueBranchHead: "msg-9" });
          await second.setDue(input.chatId, null);
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: null, dueExitId: null, dueBranchHead: null });
          await first.setDue("нет-такого", { at: at(0), exitId: "x", branchHead: null });
          expect(await first.getChat("нет-такого")).toBeNull();
        }));

      it("берутся только наступившие, ранние первыми, не больше предела", () =>
        withStores(async ({ first }) => {
          const late = chatInput();
          const early = chatInput();
          const exact = chatInput();
          const future = chatInput();
          const none = chatInput();
          for (const input of [late, early, exact, future, none]) await first.pinChat(input);
          await first.setDue(late.chatId, { at: at(50), exitId: "x4", branchHead: null });
          await first.setDue(early.chatId, { at: at(10), exitId: "x4", branchHead: "m1" });
          await first.setDue(exact.chatId, { at: at(60), exitId: "x5", branchHead: null });
          await first.setDue(future.chatId, { at: at(61), exitId: "x4", branchHead: null });

          const taken = await first.leaseDue(lease(at(60), "copy-a", 2));
          expect(taken.map((chat) => chat.chatId)).toEqual([early.chatId, late.chatId]);
          expect(taken[0]).toMatchObject({ dueAt: at(10), dueExitId: "x4", dueBranchHead: "m1" });
          expect((await first.leaseDue(lease(at(60), "copy-a"))).map((chat) => chat.chatId)).toEqual([exact.chatId]);
          expect(await first.leaseDue(lease(at(60), "copy-a"))).toEqual([]);
        }));

      it("две копии с одной базой: каждый таймер берёт ровно одна", () =>
        withStores(async ({ first, second }) => {
          const chats = Array.from({ length: 12 }, () => chatInput());
          for (const [index, input] of chats.entries()) {
            await first.pinChat(input);
            await first.setDue(input.chatId, { at: at(index), exitId: "x4", branchHead: null });
          }
          const [one, two] = await Promise.all([
            first.leaseDue(lease(at(100), "copy-a", 8)),
            second.leaseDue(lease(at(100), "copy-b", 8)),
          ]);
          const ids = [...one, ...two].map((chat) => chat.chatId);
          expect(new Set(ids).size).toBe(ids.length);
          expect(ids.sort()).toEqual(chats.map((chat) => chat.chatId).sort());
        }));

      it("живую аренду не взять никому, даже хозяину; после срока берёт другая копия", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: null });
          expect(await first.leaseDue(lease(at(1), "copy-a"))).toHaveLength(1);
          expect(await second.leaseDue(lease(at(30), "copy-b"))).toEqual([]);
          expect(await first.leaseDue(lease(at(30), "copy-a"))).toEqual([]);
          // Срок аренды — ровно минута: в эту миллисекунду она ещё держит.
          expect(await second.leaseDue(lease(at(61), "copy-b"))).toEqual([]);
          // Копия «a» упала, не отпустив: через минуту таймер забирает «b».
          expect((await second.leaseDue(lease(at(61, 1), "copy-b"))).map((chat) => chat.chatId)).toEqual([input.chatId]);
        }));

      it("отпустить может только хозяин; отпущенный таймер снова берётся", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: null });
          await first.leaseDue(lease(at(1), "copy-a"));
          await second.releaseLease(input.chatId, "copy-b");
          expect(await second.leaseDue(lease(at(2), "copy-b"))).toEqual([]);
          await second.releaseLease(input.chatId, "copy-a");
          expect(await second.leaseDue(lease(at(3), "copy-b"))).toHaveLength(1);
          await first.releaseLease("нет-такого", "copy-a");
        }));

      it("перенос срока снимает аренду: новый срок берётся, когда наступит", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: null });
          await first.leaseDue(lease(at(1), "copy-a"));
          // Тихие часы: копия «a» переносит срок и тем самым отпускает строку.
          await first.setDue(input.chatId, { at: at(3600), exitId: "x4", branchHead: null });
          expect(await second.leaseDue(lease(at(5), "copy-b"))).toEqual([]);
          expect(await second.leaseDue(lease(at(3600), "copy-b"))).toMatchObject([{ chatId: input.chatId, dueAt: at(3600) }]);
        }));

      it("продлить аренду может только хозяин, пока строку не взяла другая копия и срок не переписан", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: null });
          await first.leaseDue(lease(at(1), "copy-a"));
          expect(await second.renewLease({ chatId: input.chatId, owner: "copy-b", now: at(50), leaseMs: 60_000 })).toBe(false);
          expect(await second.renewLease({ chatId: input.chatId, owner: "copy-a", now: at(50), leaseMs: 60_000 })).toBe(true);
          // Продлённая аренда держит дольше исходной минуты.
          expect(await second.leaseDue(lease(at(100), "copy-b"))).toEqual([]);
          expect((await second.leaseDue(lease(at(111), "copy-b"))).map((chat) => chat.chatId)).toEqual([input.chatId]);
          expect(await first.renewLease({ chatId: input.chatId, owner: "copy-a", now: at(112), leaseMs: 60_000 })).toBe(false);
          // Перенос срока снимает аренду: продлевать нечего.
          await second.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: null });
          expect(await second.renewLease({ chatId: input.chatId, owner: "copy-b", now: at(113), leaseMs: 60_000 })).toBe(false);
          expect(await first.renewLease({ chatId: "нет-такого", owner: "copy-a", now: at(113), leaseMs: 60_000 })).toBe(false);
        }));

      it("срок с условием «аренда моя» пишет только хозяин аренды (аудит kimi-3)", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: null });
          await first.leaseDue(lease(at(1), "copy-a"));
          // Аренда «a» кончилась, строку взяла «b»: поздний срок «a» не пишется.
          expect((await second.leaseDue(lease(at(70), "copy-b"))).map((chat) => chat.chatId)).toEqual([input.chatId]);
          await first.setDue(input.chatId, { at: at(500), exitId: "x5", branchHead: null }, { leaseOwner: "copy-a" });
          expect(await second.getChat(input.chatId)).toMatchObject({ dueAt: at(0), dueExitId: "x4" });
          expect(await second.renewLease({ chatId: input.chatId, owner: "copy-b", now: at(71), leaseMs: 60_000 })).toBe(true);
          await second.setDue(input.chatId, { at: at(900), exitId: "x6", branchHead: null }, { leaseOwner: "copy-b" });
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: at(900), dueExitId: "x6" });
          // Срок снял аренду: условный срок больше не пишется, обычный — как раньше.
          await first.setDue(input.chatId, { at: at(950), exitId: "x7", branchHead: null }, { leaseOwner: "copy-b" });
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: at(900) });
          await first.setDue(input.chatId, { at: at(950), exitId: "x7", branchHead: null });
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: at(950), dueExitId: "x7" });
        }));

      it("срок «если нет повтора доставки» не затирает срок повтора", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDelivery(input.chatId, { messageId: "msg-1", attempt: 2, retryAt: at(60), reasons: [] });
          await first.setDue(input.chatId, { at: at(60), exitId: "@delivery", branchHead: "msg-1" });
          await second.setDue(input.chatId, { at: at(900), exitId: "@first", branchHead: "msg-1" }, { unlessDelivery: true });
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: at(60), dueExitId: "@delivery" });
          await first.setDelivery(input.chatId, null);
          await second.setDue(input.chatId, { at: at(900), exitId: "@first", branchHead: "msg-1" }, { unlessDelivery: true });
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: at(900), dueExitId: "@first" });
        }));

      it("чат без таймера не берётся, даже если раньше был взят", () =>
        withStores(async ({ first }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(0), exitId: "x4", branchHead: null });
          await first.leaseDue(lease(at(1), "copy-a"));
          await first.setDue(input.chatId, null);
          expect(await first.leaseDue(lease(at(500), "copy-a"))).toEqual([]);
        }));
    });

    describe("версии сценария", () => {
      it("копия версии по отпечатку: новая, та же, конфликт; конфликт не перезаписывает", () =>
        withStores(async ({ first, second }) => {
          const flow = exampleFlow();
          expect(await first.saveVersion({ flowId: flow.id, versionId: "v1", hash: "h1", flow, at: at(1, 5) })).toBe("new");
          expect(await second.saveVersion({ flowId: flow.id, versionId: "v1", hash: "h1", flow, at: at(9) })).toBe("same");
          expect(await second.saveVersion({ flowId: flow.id, versionId: "v1", hash: "h2", flow: { ...flow, name: "Другой" }, at: at(9) })).toBe("conflict");
          expect(await second.getVersion(flow.id, "v1")).toEqual({ flowId: flow.id, versionId: "v1", hash: "h1", flow, createdAt: at(1, 5) });
          expect(await first.getVersion(flow.id, "v2")).toBeNull();
          expect(await first.getVersion("другой", "v1")).toBeNull();
        }));

      it("одновременное сохранение одной версии из двух копий: одна новая, другая та же", () =>
        withStores(async ({ first, second }) => {
          const flow = exampleFlow();
          const results = await Promise.all([
            first.saveVersion({ flowId: flow.id, versionId: "v7", hash: "h7", flow, at: at(1) }),
            second.saveVersion({ flowId: flow.id, versionId: "v7", hash: "h7", flow, at: at(1) }),
          ]);
          expect(results.sort()).toEqual(["new", "same"]);
        }));
    });

    describe("подсчёт и перевод чатов", () => {
      it("подсчёт по версиям и состояниям только своего сценария", () =>
        withStores(async ({ first, second }) => {
          await first.pinChat(chatInput({ versionId: "v1", stateId: "intro" }));
          await first.pinChat(chatInput({ versionId: "v1", stateId: "intro" }));
          await first.pinChat(chatInput({ versionId: "v1", stateId: "block" }));
          await first.pinChat(chatInput({ versionId: "v2", stateId: "intro" }));
          await first.pinChat(chatInput({ flowId: "shop-support", versionId: "v1", stateId: "intro" }));
          expect(await second.countChatsByState({ flowId: "sales-review" })).toEqual([
            { versionId: "v1", stateId: "block", chats: 1 },
            { versionId: "v1", stateId: "intro", chats: 2 },
            { versionId: "v2", stateId: "intro", chats: 1 },
          ]);
          expect(await second.countChatsByState({ flowId: "нет" })).toEqual([]);
        }));

      it("перевод пачками: версия сразу, удалённое состояние — по карте, ожидающий перевод для хода", () =>
        withStores(async ({ first, second }) => {
          const onOld = [
            chatInput({ versionId: "v1", stateId: "soft" }),
            chatInput({ versionId: "v1", stateId: "intro" }),
            chatInput({ versionId: "v1", stateId: "block" }),
          ];
          const onNew = chatInput({ versionId: "v2", stateId: "intro" });
          const otherFlow = chatInput({ flowId: "shop-support", versionId: "v1", stateId: "soft" });
          for (const input of [...onOld, onNew, otherFlow]) await first.pinChat(input);
          const map = { soft: "block" };

          const firstBatch = await first.migrateBatch({ flowId: "sales-review", toVersionId: "v2", map, limit: 2, at: at(40) });
          expect(firstBatch.moved).toHaveLength(2);
          const secondBatch = await second.migrateBatch({ flowId: "sales-review", toVersionId: "v2", map, limit: 2, at: at(41) });
          expect(secondBatch.moved).toHaveLength(1);
          expect(await first.migrateBatch({ flowId: "sales-review", toVersionId: "v2", map, limit: 2, at: at(42) })).toEqual({ moved: [] });
          expect([...firstBatch.moved, ...secondBatch.moved].sort()).toEqual(onOld.map((chat) => chat.chatId).sort());

          const soft = await first.getChat(onOld[0]!.chatId);
          expect(soft).toMatchObject({ versionId: "v2", stateId: "block" });
          expect(soft?.pending).toEqual([{ kind: "migrate", key: expect.stringContaining("v2"), versionId: "v2", map, at: soft?.updatedAt }]);
          expect(await first.getChat(onOld[1]!.chatId)).toMatchObject({ versionId: "v2", stateId: "intro" });
          expect((await first.getChat(onNew.chatId))?.pending).toEqual([]);
          expect(await first.getChat(otherFlow.chatId)).toMatchObject({ versionId: "v1", stateId: "soft", pending: [] });
          expect(await first.countChatsByState({ flowId: "sales-review" })).toEqual([
            { versionId: "v2", stateId: "block", chats: 2 },
            { versionId: "v2", stateId: "intro", chats: 2 },
          ]);
        }));

      it("перевод дописывается к ожидающему и не теряет прежнее; два перевода подряд — оба по порядку", () =>
        withStores(async ({ first }) => {
          const input = chatInput({ versionId: "v1", stateId: "soft" });
          await first.pinChat(input);
          await first.addPending(input.chatId, judged("judge:x1:m1"));
          await first.migrateBatch({ flowId: "sales-review", toVersionId: "v2", map: { soft: "block" }, limit: 10, at: at(1) });
          await first.migrateBatch({ flowId: "sales-review", toVersionId: "v3", map: { block: "intro" }, limit: 10, at: at(2) });
          const pending = await first.takePending(input.chatId);
          expect(pending.map((change) => change.kind)).toEqual(["transition", "migrate", "migrate"]);
          expect(pending.slice(1)).toMatchObject([{ versionId: "v2", map: { soft: "block" }, at: at(1) }, { versionId: "v3", map: { block: "intro" }, at: at(2) }]);
          expect(await first.getChat(input.chatId)).toMatchObject({ versionId: "v3", stateId: "intro" });
        }));

      it("список чатов сценария: без чатов версии `exceptVersionId`, только названные `chatIds`, с концом разговора", () =>
        withStores(async ({ first, second }) => {
          const one = chatInput({ versionId: "v1", stateId: "soft" });
          const two = chatInput({ versionId: "v1", stateId: "intro" });
          const fresh = chatInput({ versionId: "v2", stateId: "intro" });
          const other = chatInput({ flowId: "shop-support", versionId: "v1" });
          for (const input of [one, two, fresh, other]) await first.pinChat(input);
          await first.endChat(two.chatId, { reason: "final", at: at(5) });

          const all = await second.listFlowChats({ flowId: "sales-review" });
          expect(all.map((row) => row.chatId)).toEqual([one, two, fresh].map((chat) => chat.chatId).sort());
          expect(all.find((row) => row.chatId === one.chatId)).toEqual({
            chatId: one.chatId,
            ownerId: "anna",
            flowId: "sales-review",
            versionId: "v1",
            stateId: "soft",
            endedAt: null,
            endReason: null,
          });
          expect(all.find((row) => row.chatId === two.chatId)).toMatchObject({ endedAt: at(5), endReason: "final" });
          expect((await second.listFlowChats({ flowId: "sales-review", exceptVersionId: "v2" })).map((row) => row.chatId)).toEqual([one.chatId, two.chatId].sort());
          expect((await second.listFlowChats({ flowId: "sales-review", chatIds: [two.chatId, other.chatId, "нет"] })).map((row) => row.chatId)).toEqual([two.chatId]);
          expect(await second.listFlowChats({ flowId: "sales-review", chatIds: [] })).toEqual([]);
        }));

      it("перевод только названных чатов (`chatIds`): остальные на месте", () =>
        withStores(async ({ first, second }) => {
          const chats = Array.from({ length: 4 }, () => chatInput({ versionId: "v1" }));
          for (const input of chats) await first.pinChat(input);
          const chosen = [chats[0]!.chatId, chats[2]!.chatId];
          const batch = { flowId: "sales-review", toVersionId: "v2", map: {}, limit: 10, at: at(1) };
          expect((await second.migrateBatch({ ...batch, chatIds: chosen })).moved.sort()).toEqual([...chosen].sort());
          expect(await second.migrateBatch({ ...batch, chatIds: chosen })).toEqual({ moved: [] });
          expect(await second.migrateBatch({ ...batch, chatIds: [] })).toEqual({ moved: [] });
          expect((await first.getChat(chats[1]!.chatId))?.versionId).toBe("v1");
          expect((await first.getChat(chats[3]!.chatId))?.versionId).toBe("v1");
        }));

      it("две копии переводят одновременно: каждый чат переводится один раз", () =>
        withStores(async ({ first, second }) => {
          const chats = Array.from({ length: 9 }, () => chatInput({ versionId: "v1" }));
          for (const input of chats) await first.pinChat(input);
          const batch = { flowId: "sales-review", toVersionId: "v2", map: {}, limit: 5, at: at(1) };
          const [one, two] = await Promise.all([first.migrateBatch(batch), second.migrateBatch(batch)]);
          const rest = await first.migrateBatch(batch);
          const moved = [...one.moved, ...two.moved, ...rest.moved];
          expect(moved.sort()).toEqual(chats.map((chat) => chat.chatId).sort());
          for (const input of chats) expect((await first.getChat(input.chatId))?.pending).toHaveLength(1);
        }));
    });

    describe("карточка клиента", () => {
      it("поле пишется, перезаписывается и читается по порядку id; у каждого человека своя карточка", () =>
        withStores(async ({ first, second }) => {
          const write = (fieldId: string, value: unknown, seconds: number, ownerId = "anna") =>
            first.writeCardField({ ownerId, fieldId, value, chatId: "chat-a", flowId: "sales-review", at: at(seconds, 9) });
          await write("sales", 12, 1);
          await write("course_topic", "Excel для бухгалтеров «с нуля»", 2);
          await write("channels", ["Telegram", "VK"], 3);
          await write("profile", { booked: true, score: 0.5 }, 4);
          // Текст из цифр остаётся текстом, а не превращается в число.
          await write("zip", "007", 4);
          await write("empty", "", 4);
          await write("course_topic", "Таблицы", 5, "boris");
          await second.writeCardField({ ownerId: "anna", fieldId: "sales", value: 40, chatId: "chat-b", flowId: "shop-support", at: at(6) });
          expect(await second.readCard("anna")).toEqual([
            { fieldId: "channels", value: ["Telegram", "VK"], updatedAt: at(3, 9), chatId: "chat-a", flowId: "sales-review" },
            { fieldId: "course_topic", value: "Excel для бухгалтеров «с нуля»", updatedAt: at(2, 9), chatId: "chat-a", flowId: "sales-review" },
            { fieldId: "empty", value: "", updatedAt: at(4, 9), chatId: "chat-a", flowId: "sales-review" },
            { fieldId: "profile", value: { booked: true, score: 0.5 }, updatedAt: at(4, 9), chatId: "chat-a", flowId: "sales-review" },
            { fieldId: "sales", value: 40, updatedAt: at(6), chatId: "chat-b", flowId: "shop-support" },
            { fieldId: "zip", value: "007", updatedAt: at(4, 9), chatId: "chat-a", flowId: "sales-review" },
          ]);
          expect(await first.readCard("boris")).toMatchObject([{ fieldId: "course_topic", value: "Таблицы" }]);
          expect(await first.readCard("никто")).toEqual([]);
        }));

      it("стирание поля и всей карточки касается только этого человека", () =>
        withStores(async ({ first, second }) => {
          for (const [ownerId, fieldId] of [["anna", "a"], ["anna", "b"], ["anna", "c"], ["boris", "a"]] as const) {
            await first.writeCardField({ ownerId, fieldId, value: true, chatId: "c", flowId: "f", at: at(1) });
          }
          await second.forgetCard("anna", "b");
          expect((await first.readCard("anna")).map((entry) => entry.fieldId)).toEqual(["a", "c"]);
          await second.forgetCard("anna", "нет-такого");
          await second.forgetCard("anna", "all");
          expect(await first.readCard("anna")).toEqual([]);
          expect((await first.readCard("boris")).map((entry) => entry.fieldId)).toEqual(["a"]);
        }));
    });

    describe("конец разговора, пауза, окно, закрытый день, повтор доставки", () => {
      const lease = (now: string, owner = "copy-a") => ({ now, owner, leaseMs: 60_000, limit: 10 });

      it("конец ставит время и причину, снимает таймер; повторный конец ничего не меняет", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDue(input.chatId, { at: at(10), exitId: "x4", branchHead: null });
          expect(await second.endChat(input.chatId, { reason: "deadline", at: at(5, 3) })).toMatchObject({
            endedAt: at(5, 3),
            endReason: "deadline",
            dueAt: null,
            dueExitId: null,
          });
          expect(await first.endChat(input.chatId, { reason: "final", at: at(6) })).toMatchObject({ endedAt: at(5, 3), endReason: "deadline" });
          expect(await first.endChat("нет-такого", { reason: "final", at: at(6) })).toBeNull();
        }));

      it("105 открыть заново: только тот конец, что прочитан; снимает конец, ставит отметку; второй раз и другая копия — null", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          expect(await first.reopenChat(input.chatId, { endedAt: at(5), at: at(9) })).toBeNull();
          await first.endChat(input.chatId, { reason: "abandoned", at: at(5, 3) });
          expect(await second.reopenChat(input.chatId, { endedAt: at(4), at: at(9) })).toBeNull();
          expect(await second.reopenChat(input.chatId, { endedAt: at(5, 3), at: at(9, 7) })).toMatchObject({ endedAt: null, endReason: null, reopenedAt: at(9, 7) });
          expect(await first.reopenChat(input.chatId, { endedAt: at(5, 3), at: at(10) })).toBeNull();
          expect(await first.getChat(input.chatId)).toMatchObject({ endedAt: null, endReason: null, reopenedAt: at(9, 7) });
          expect(await first.reopenChat("нет-такого", { endedAt: at(5, 3), at: at(10) })).toBeNull();
          // Открытый заново снова кончается и снова открывается.
          await first.endChat(input.chatId, { reason: "abandoned", at: at(20) });
          expect(await first.reopenChat(input.chatId, { endedAt: at(20), at: at(30) })).toMatchObject({ endedAt: null, reopenedAt: at(30) });
        }));

      it("105 гонка двух копий: открывает одна", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.endChat(input.chatId, { reason: "abandoned", at: at(5) });
          const results = await Promise.all([first.reopenChat(input.chatId, { endedAt: at(5), at: at(9) }), second.reopenChat(input.chatId, { endedAt: at(5), at: at(9) })]);
          expect(results.filter((result) => result !== null)).toHaveLength(1);
        }));

      it("законченный чат таймер не берёт, даже если срок записали после конца", () =>
        withStores(async ({ first }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.endChat(input.chatId, { reason: "abandoned", at: at(1) });
          await first.setDue(input.chatId, { at: at(10), exitId: "x4", branchHead: null });
          expect(await first.leaseDue(lease(at(60)))).toEqual([]);
        }));

      it("на паузе таймер не берётся; пауза истекла или снята — берётся", () =>
        withStores(async ({ first, second }) => {
          const paused = chatInput();
          const expired = chatInput();
          for (const input of [paused, expired]) {
            await first.pinChat(input);
            await first.setDue(input.chatId, { at: at(10), exitId: "x4", branchHead: null });
          }
          expect(await second.setPause(paused.chatId, at(3600, 5))).toMatchObject({ pausedUntil: at(3600, 5) });
          await second.setPause(expired.chatId, at(30));
          expect((await first.leaseDue(lease(at(60)))).map((chat) => chat.chatId)).toEqual([expired.chatId]);
          expect(await first.setPause(paused.chatId, null)).toMatchObject({ pausedUntil: null });
          expect((await first.leaseDue(lease(at(61), "copy-b"))).map((chat) => chat.chatId)).toEqual([paused.chatId]);
          expect(await first.setPause("нет-такого", null)).toBeNull();
        }));

      it("окно, закрытый день и повтор доставки пишутся и стираются", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          const delivery = { messageId: "msg-12", attempt: 2, retryAt: at(300, 1), reasons: ["silence:1", "«утро»"] };
          await first.setWindowClosed(input.chatId, true);
          await first.setDayClosed(input.chatId, "2026-10-13");
          await first.setDelivery(input.chatId, delivery);
          expect(await second.getChat(input.chatId)).toMatchObject({ windowClosed: true, dayClosedOn: "2026-10-13", delivery });
          await second.setWindowClosed(input.chatId, false);
          await second.setDayClosed(input.chatId, null);
          await second.setDelivery(input.chatId, null);
          expect(await first.getChat(input.chatId)).toMatchObject({ windowClosed: false, dayClosedOn: null, delivery: null });
          await first.setDelivery("нет-такого", delivery);
          expect(await first.getChat("нет-такого")).toBeNull();
        }));
    });

    describe("повтор доставки: условная замена и законченный разговор (0.81)", () => {
      const lease = (now: string, owner: string) => ({ now, owner, leaseMs: 60_000, limit: 10 });
      const record = (token: string, extra: Partial<FlowPendingDelivery> = {}): FlowPendingDelivery => ({ messageId: "msg-5", attempt: 2, retryAt: at(60, 7), reasons: ["silence:1"], token, ...extra });
      const due = (seconds: number) => ({ at: at(seconds), exitId: "@delivery", branchHead: "msg-5" });

      it("хранилище объявляет, что исполняет условия ограды", () =>
        withStores(async ({ first, second }) => {
          expect(first.guarded).toBe(true);
          expect(second.guarded).toBe(true);
        }));

      it("замена только с той записью, что прочитана: messageId, attempt и token; срок пишется вместе с ней", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          const paused = record("t-1", { pausedAt: at(30, 3), resumedAt: at(40, 9) });
          expect(await first.swapDelivery(input.chatId, { expected: null, next: paused, due: due(60) })).toBe(true);
          expect(await second.getChat(input.chatId)).toMatchObject({ delivery: paused, dueAt: at(60), dueExitId: "@delivery", dueBranchHead: "msg-5" });
          // Ждали «записи нет», другой token при том же attempt, другой attempt или ответ — не та запись.
          expect(await second.swapDelivery(input.chatId, { expected: null, next: record("t-x") })).toBe(false);
          expect(await second.swapDelivery(input.chatId, { expected: record("t-0"), next: record("t-x") })).toBe(false);
          expect(await second.swapDelivery(input.chatId, { expected: record("t-1", { attempt: 3 }), next: record("t-x") })).toBe(false);
          expect(await second.swapDelivery(input.chatId, { expected: record("t-1", { messageId: "msg-6" }), next: record("t-x") })).toBe(false);
          expect(await first.getChat(input.chatId)).toMatchObject({ delivery: paused });
          // Без поля `due` срок не трогается; `null` — снимает.
          expect(await second.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-2", { attempt: 3 }) })).toBe(true);
          expect(await first.getChat(input.chatId)).toMatchObject({ delivery: { token: "t-2", attempt: 3 }, dueAt: at(60) });
          expect(await first.swapDelivery(input.chatId, { expected: record("t-2", { attempt: 3 }), next: null, due: null })).toBe(true);
          expect(await second.getChat(input.chatId)).toMatchObject({ delivery: null, dueAt: null, dueExitId: null });
          expect(await first.swapDelivery("нет-такого", { expected: null, next: record("t-1") })).toBe(false);
          expect(await first.getChat("нет-такого")).toBeNull();
        }));

      it("запись до 0.81 без token совпадает с ожиданием без token", () =>
        withStores(async ({ first }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.setDelivery(input.chatId, { messageId: "msg-5", attempt: 2, retryAt: at(60), reasons: [] });
          expect(await first.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-2") })).toBe(false);
          expect(await first.swapDelivery(input.chatId, { expected: { messageId: "msg-5", attempt: 2, retryAt: at(0), reasons: [] }, next: record("t-2") })).toBe(true);
        }));

      it("две копии меняют одну запись одновременно: заменяет одна", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.swapDelivery(input.chatId, { expected: null, next: record("t-1") });
          const results = await Promise.all([
            first.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-a") }),
            second.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-b") }),
          ]);
          expect(results.filter(Boolean)).toHaveLength(1);
          expect((await first.getChat(input.chatId))?.delivery?.token).toBe(results[0] ? "t-a" : "t-b");
        }));

      it("взять аренду: свободную, свою или переданную срабатыванием (`from`); живую чужую — нет, запись не меняется", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.swapDelivery(input.chatId, { expected: null, next: record("t-1"), due: due(0) });
          expect(await first.leaseDue(lease(at(1), "timer-a"))).toHaveLength(1);
          const claim = (owner: string, seconds: number, from?: string) => ({ owner, now: at(seconds), leaseMs: 60_000, ...(from && { from }) });
          // Живая аренда срабатывания «a»: чужая отправка её не берёт.
          expect(await second.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-2"), claim: claim("send-b", 10) })).toBe(false);
          expect(await first.getChat(input.chatId)).toMatchObject({ delivery: { token: "t-1" } });
          // Срабатывание «a» передаёт аренду своей отправке: держит отправка, а не «a».
          expect(await first.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-2"), due: due(30), claim: claim("send-a", 10, "timer-a") })).toBe(true);
          expect(await first.renewLease({ chatId: input.chatId, owner: "timer-a", now: at(11), leaseMs: 60_000 })).toBe(false);
          expect(await second.renewLease({ chatId: input.chatId, owner: "send-a", now: at(11), leaseMs: 60_000 })).toBe(true);
          // Срок пришёл, но аренда отправки живая: таймер чат не берёт.
          expect(await second.leaseDue(lease(at(40), "timer-b"))).toEqual([]);
          // Своя аренда берётся снова.
          expect(await first.swapDelivery(input.chatId, { expected: record("t-2"), next: record("t-3"), claim: claim("send-a", 20) })).toBe(true);
          // Отправка упала: после срока аренды запись берёт другая копия.
          expect(await second.swapDelivery(input.chatId, { expected: record("t-3"), next: record("t-4"), claim: claim("send-b", 81, "timer-b") })).toBe(true);
          expect(await second.renewLease({ chatId: input.chatId, owner: "send-b", now: at(82), leaseMs: 60_000 })).toBe(true);
        }));

      it("`endedAt`: пишет, только пока конец разговора тот же; `null` — не закончен", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          expect(await first.swapDelivery(input.chatId, { expected: null, next: record("t-1"), endedAt: null })).toBe(true);
          await second.endChat(input.chatId, { reason: "switched", at: at(30) });
          expect(await first.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-2"), endedAt: null })).toBe(false);
          expect(await first.getChat(input.chatId)).toMatchObject({ delivery: { token: "t-1" } });
          expect(await second.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-2"), endedAt: at(30) })).toBe(true);
          expect(await first.swapDelivery(input.chatId, { expected: record("t-2"), next: null, endedAt: at(31) })).toBe(false);
          expect(await first.swapDelivery(input.chatId, { expected: record("t-2"), next: null })).toBe(true);
        }));

      it("`freeAt`: при живой аренде запись не меняется; без аренды — меняется, срок ставится, аренда не снимается", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.swapDelivery(input.chatId, { expected: null, next: record("t-1"), claim: { owner: "send-a", now: at(0), leaseMs: 60_000 } });
          expect(await second.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-1"), due: due(60), freeAt: at(30) })).toBe(false);
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: null });
          // Своё условие и срок не снимают аренду идущей отправки.
          expect(await first.swapDelivery(input.chatId, { expected: record("t-1"), next: record("t-2"), due: due(60) })).toBe(true);
          expect(await first.renewLease({ chatId: input.chatId, owner: "send-a", now: at(10), leaseMs: 60_000 })).toBe(true);
          expect(await second.swapDelivery(input.chatId, { expected: record("t-2"), next: record("t-2"), due: due(120), freeAt: at(71) })).toBe(true);
          expect(await first.getChat(input.chatId)).toMatchObject({ dueAt: at(120) });
        }));

      it("законченный разговор: срок повтора доставки таймер берёт, другие сроки — нет", () =>
        withStores(async ({ first, second }) => {
          const waiting = chatInput();
          const other = chatInput();
          for (const input of [waiting, other]) {
            await first.pinChat(input);
            await first.endChat(input.chatId, { reason: "deadline", at: at(1) });
          }
          await first.swapDelivery(waiting.chatId, { expected: null, next: record("t-1"), due: due(10) });
          await first.setDue(other.chatId, { at: at(10), exitId: "x4", branchHead: null });
          expect((await second.leaseDue(lease(at(60), "timer-a"))).map((chat) => chat.chatId)).toEqual([waiting.chatId]);
        }));

      it("конец при ждущей доставке: срок и аренда отправки остаются; без доставки — снимаются", () =>
        withStores(async ({ first, second }) => {
          const input = chatInput();
          await first.pinChat(input);
          await first.swapDelivery(input.chatId, { expected: null, next: record("t-1"), due: due(60), claim: { owner: "send-a", now: at(0), leaseMs: 60_000 } });
          expect(await second.endChat(input.chatId, { reason: "deadline", at: at(5) })).toMatchObject({ endReason: "deadline", dueAt: at(60), dueExitId: "@delivery" });
          expect(await first.renewLease({ chatId: input.chatId, owner: "send-a", now: at(10), leaseMs: 60_000 })).toBe(true);
          const plain = chatInput();
          await first.pinChat(plain);
          await first.setDue(plain.chatId, { at: at(0), exitId: "x4", branchHead: null });
          await first.leaseDue(lease(at(1), "timer-a"));
          expect(await second.endChat(plain.chatId, { reason: "final", at: at(5) })).toMatchObject({ dueAt: null });
          expect(await first.renewLease({ chatId: plain.chatId, owner: "timer-a", now: at(10), leaseMs: 60_000 })).toBe(false);
        }));
    });

    describe("пояс человека", () => {
      it("неизвестен — null; пишется и перезаписывается; у каждого свой", () =>
        withStores(async ({ first, second }) => {
          expect(await first.readTimeZone("anna")).toBeNull();
          await first.writeTimeZone("anna", "Asia/Novosibirsk", at(1));
          expect(await second.readTimeZone("anna")).toBe("Asia/Novosibirsk");
          await second.writeTimeZone("anna", "Europe/Moscow", at(2));
          expect(await first.readTimeZone("anna")).toBe("Europe/Moscow");
          expect(await first.readTimeZone("boris")).toBeNull();
        }));
    });

    describe("попутные задачи", () => {
      it("попытки на человека и на разговор считаются раздельно, «сделано» ставит время", () =>
        withStores(async ({ first, second }) => {
          expect(await first.readSideTasks("anna", "chat-a")).toEqual([]);
          expect(await first.noteSideTask({ ownerId: "anna", taskId: "subscribe", chatId: null, status: "asked", at: at(1) })).toEqual({
            taskId: "subscribe",
            chatId: null,
            asks: 1,
            doneAt: null,
          });
          await second.noteSideTask({ ownerId: "anna", taskId: "subscribe", chatId: null, status: "asked", at: at(2) });
          await first.noteSideTask({ ownerId: "anna", taskId: "review", chatId: "chat-a", status: "asked", at: at(3) });
          await first.noteSideTask({ ownerId: "anna", taskId: "review", chatId: "chat-b", status: "done", at: at(4, 9) });
          expect(await second.readSideTasks("anna", "chat-a")).toEqual([
            { taskId: "review", chatId: "chat-a", asks: 1, doneAt: null },
            { taskId: "subscribe", chatId: null, asks: 2, doneAt: null },
          ]);
          expect(await second.readSideTasks("anna", "chat-b")).toEqual([
            { taskId: "review", chatId: "chat-b", asks: 0, doneAt: at(4, 9) },
            { taskId: "subscribe", chatId: null, asks: 2, doneAt: null },
          ]);
          expect(await first.readSideTasks("boris", "chat-a")).toEqual([]);
        }));

      it("forgetSideTasks стирает все попытки человека (и на человека, и на разговоры), чужие остаются", () =>
        withStores(async ({ first, second }) => {
          await first.noteSideTask({ ownerId: "anna", taskId: "subscribe", chatId: null, status: "asked", at: at(1) });
          await first.noteSideTask({ ownerId: "anna", taskId: "review", chatId: "chat-a", status: "done", at: at(2) });
          await first.noteSideTask({ ownerId: "boris", taskId: "subscribe", chatId: null, status: "asked", at: at(3) });

          await second.forgetSideTasks("anna");

          expect(await first.readSideTasks("anna", "chat-a")).toEqual([]);
          expect(await second.readSideTasks("boris", "chat-a")).toEqual([{ taskId: "subscribe", chatId: null, asks: 1, doneAt: null }]);
          // после стирания счёт идёт заново
          expect((await first.noteSideTask({ ownerId: "anna", taskId: "subscribe", chatId: null, status: "asked", at: at(4) })).asks).toBe(1);
          await first.forgetSideTasks("nobody");
        }));

      it("одновременные попытки из двух копий не теряются", () =>
        withStores(async ({ first, second }) => {
          const asks = await Promise.all(
            [1, 2, 3, 4].map((index) =>
              (index % 2 ? first : second).noteSideTask({ ownerId: "anna", taskId: "subscribe", chatId: null, status: "asked", at: at(index) }),
            ),
          );
          expect(asks.map((task) => task.asks).sort()).toEqual([1, 2, 3, 4]);
        }));
    });

    describe("«писал первым» за день", () => {
      it("счёт по человеку и дню; одновременные записи из двух копий не теряются", () =>
        withStores(async ({ first, second }) => {
          expect(await first.countFirstMessages("anna", "2026-10-13")).toBe(0);
          expect(await first.addFirstMessage("anna", "2026-10-13")).toBe(1);
          expect(await second.addFirstMessage("anna", "2026-10-13")).toBe(2);
          expect(await first.addFirstMessage("anna", "2026-10-14")).toBe(1);
          expect(await first.addFirstMessage("boris", "2026-10-13")).toBe(1);
          const counts = await Promise.all([1, 2, 3, 4].map((index) => (index % 2 ? first : second).addFirstMessage("anna", "2026-10-13")));
          expect(counts.sort()).toEqual([3, 4, 5, 6]);
          expect(await second.countFirstMessages("anna", "2026-10-13")).toBe(6);
          expect(await second.countFirstMessages("anna", "2026-10-14")).toBe(1);
        }));
    });
  });
}
