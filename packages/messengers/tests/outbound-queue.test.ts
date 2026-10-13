import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessengerApiError, MessengerBlockedError, MessengerMarkupError, MessengerRateLimitError } from "../src/messenger-api";
import { createOutboundQueue, type DeliveryOutbox } from "../src/outbound-queue";
import type { PendingDelivery } from "../src/types";

const NOW = Date.UTC(2026, 9, 5, 12, 0);

/** Действие, которое пишет время вызова и отдаёт ошибки из очереди. */
function recorder(failures: unknown[] = []) {
  const calls: Array<{ name: string; at: number }> = [];
  const op = (name: string) => async () => {
    calls.push({ name, at: Date.now() - NOW });
    const failure = failures.shift();
    if (failure) throw failure;
    return name;
  };
  return { calls, op, names: () => calls.map((call) => call.name) };
}

describe("очередь отправки", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("по умолчанию: правки не чаще раза в 1000 мс на чат, промежуточные сливаются — уходит последняя", async () => {
    const queue = createOutboundQueue();
    const { calls, op } = recorder();
    const results = [1, 2, 3, 4].map((index) => queue.run("chat-a", op(`edit${index}`), { slot: "live" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ name: "edit1", at: 0 }]);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([
      { name: "edit1", at: 0 },
      { name: "edit4", at: 1000 },
    ]);
    expect(await Promise.all(results)).toEqual(["edit1", undefined, undefined, "edit4"]);
  });

  it("частота своя у каждого чата; итог идёт по порядку и без паузы, если не просили", async () => {
    const queue = createOutboundQueue({ gapMs: 500 });
    const { calls, op } = recorder();
    void queue.run("chat-a", op("a-edit1"), { slot: "live" });
    void queue.run("chat-b", op("b-edit1"), { slot: "live" });
    void queue.run("chat-a", op("a-final"));
    void queue.run("chat-a", op("a-edit2"), { slot: "live" });
    void queue.run("chat-a", op("a-final-edit"), { paced: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([
      { name: "a-edit1", at: 0 },
      { name: "b-edit1", at: 0 },
      { name: "a-final", at: 0 },
    ]);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.slice(3)).toEqual([{ name: "a-edit2", at: 500 }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.slice(4)).toEqual([{ name: "a-final-edit", at: 1000 }]);
    await queue.flush();
  });

  it("«слишком часто» до 5 с — ждём и повторяем ту же правку", async () => {
    const queue = createOutboundQueue();
    const { calls, op } = recorder([new MessengerRateLimitError("429", 3000)]);
    const result = queue.run("chat-a", op("edit"), { slot: "live" });
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((call) => call.at)).toEqual([0, 3000]);
    expect(await result).toBe("edit");
  });

  it("«слишком часто» дольше 5 с — промежуточные правки пропускаются, итог ждёт и уходит", async () => {
    const queue = createOutboundQueue();
    const { calls, op, names } = recorder([new MessengerRateLimitError("429", 7000)]);
    const first = queue.run("chat-a", op("edit1"), { slot: "live" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await first).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await queue.run("chat-a", op("edit2"), { slot: "live" })).toBeUndefined();
    const final = queue.run("chat-a", op("final"));
    await vi.advanceTimersByTimeAsync(4999);
    expect(names()).toEqual(["edit1"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await final).toBe("final");
    expect(calls.at(-1)).toEqual({ name: "final", at: 7000 });
  });

  it("итог ждёт «слишком часто» любой длины", async () => {
    const queue = createOutboundQueue();
    const { calls, op } = recorder([new MessengerRateLimitError("429", 20_000)]);
    const final = queue.run("chat-a", op("final"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await final).toBe("final");
    expect(calls.map((call) => call.at)).toEqual([0, 20_000]);
  });

  it("сбой сети или 5xx — итог повторяется с растущей паузой 1, 2, 4 с; потом ошибка", async () => {
    const queue = createOutboundQueue();
    const network = recorder([new TypeError("fetch failed"), new MessengerApiError("502", 502)]);
    const ok = queue.run("chat-a", network.op("final"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await ok).toBe("final");
    expect(network.calls.map((call) => call.at)).toEqual([0, 1000, 3000]);

    const broken = recorder([1, 2, 3, 4].map(() => new MessengerApiError("500", 500)));
    const failed = queue.run("chat-b", broken.op("final"));
    const outcome = failed.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await outcome).toBeInstanceOf(MessengerApiError);
    expect(broken.calls.map((call) => call.at)).toEqual([3000, 4000, 6000, 10_000]);
  });

  it("ошибка запроса (4xx) и отказ разметки не повторяются — их решает вызывающий", async () => {
    const queue = createOutboundQueue();
    const { calls, op } = recorder([new MessengerMarkupError("can't parse entities"), new MessengerApiError("400", 400)]);
    await expect(queue.run("chat-a", op("final1"))).rejects.toBeInstanceOf(MessengerMarkupError);
    await expect(queue.run("chat-a", op("final2"))).rejects.toBeInstanceOf(MessengerApiError);
    expect(calls).toHaveLength(2);
  });

  it("сбой промежуточной правки — пропуск без повтора, очередь идёт дальше", async () => {
    const errors: unknown[] = [];
    const queue = createOutboundQueue({ logError: (error) => errors.push(error) });
    const { op, names } = recorder([new TypeError("fetch failed")]);
    expect(await queue.run("chat-a", op("edit"), { slot: "live" })).toBeUndefined();
    const final = queue.run("chat-a", op("final"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await final).toBe("final");
    expect(names()).toEqual(["edit", "final"]);
    expect(errors).toHaveLength(1);
  });

  it("«заблокирован» — сообщаем один раз, ждущие этого чата отменяются, другие чаты идут", async () => {
    const blocked: string[] = [];
    const queue = createOutboundQueue({ onBlocked: (chatKey) => blocked.push(chatKey) });
    const { op, names } = recorder([new MessengerBlockedError("bot was blocked by the user")]);
    const first = queue.run("chat-a", op("final1")).catch((error: unknown) => error);
    const second = queue.run("chat-a", op("final2")).catch((error: unknown) => error);
    const edit = queue.run("chat-a", op("edit"), { slot: "live" }).catch((error: unknown) => error);
    const other = queue.run("chat-b", op("other"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await first).toBeInstanceOf(MessengerBlockedError);
    expect(await second).toBeInstanceOf(MessengerBlockedError);
    expect(await edit).toBeUndefined();
    expect(await other).toBe("other");
    expect(names()).toEqual(["final1", "other"]);
    expect(blocked).toEqual(["chat-a"]);
  });

  it("настройки: своё предельное ожидание и число повторов", async () => {
    const queue = createOutboundQueue({ maxWaitMs: 10_000, finalAttempts: 2, retryDelayMs: 500 });
    const rate = recorder([new MessengerRateLimitError("429", 8000)]);
    const edit = queue.run("chat-a", rate.op("edit"), { slot: "live" });
    await vi.advanceTimersByTimeAsync(8000);
    expect(await edit).toBe("edit");
    const broken = recorder([new MessengerApiError("500", 500), new MessengerApiError("500", 500)]);
    const failed = queue.run("chat-b", broken.op("final")).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    expect(await failed).toBeInstanceOf(MessengerApiError);
    expect(broken.calls.map((call) => call.at)).toEqual([8000, 8500]);
  });

  it("drop снимает ждущие правки с меткой — итог уходит сразу, чужие правки остаются", async () => {
    const queue = createOutboundQueue();
    const { calls, op } = recorder();
    void queue.run("chat-a", op("edit1"), { slot: "answer1:live:0" });
    await vi.advanceTimersByTimeAsync(0);
    const waiting = queue.run("chat-a", op("edit2"), { slot: "answer1:live:0" });
    const final = queue.run("chat-a", op("final"));
    const other = queue.run("chat-a", op("other-edit"), { slot: "answer2:live:0" });
    await vi.advanceTimersByTimeAsync(100);
    queue.drop("chat-a", "answer1:");
    expect(await waiting).toBeUndefined();
    expect(await final).toBe("final");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await other).toBe("other-edit");
    expect(calls).toEqual([
      { name: "edit1", at: 0 },
      { name: "final", at: 100 },
      { name: "other-edit", at: 1100 },
    ]);
  });

  it("flush ждёт, пока все чаты опустеют", async () => {
    const queue = createOutboundQueue();
    const { names, op } = recorder();
    void queue.run("chat-a", op("edit1"), { slot: "live" });
    void queue.run("chat-a", op("edit2"), { slot: "live" });
    let flushed = false;
    void queue.flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(flushed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(flushed).toBe(true);
    expect(names()).toEqual(["edit1", "edit2"]);
  });

  describe("итог переживает перезапуск", () => {
    /** Записи очереди в хранилище: что сохранено и удалено, по порядку. */
    function outbox() {
      const log: string[] = [];
      const saved = new Map<string, PendingDelivery>();
      const box: DeliveryOutbox = {
        async save(delivery) {
          log.push(`save ${delivery.id} ${delivery.message.text}`);
          saved.set(delivery.id, delivery);
        },
        async remove(id) {
          log.push(`remove ${id}`);
          saved.delete(id);
        },
        async release(delivery) {
          log.push(`release ${delivery.id}`);
        },
      };
      return { box, log, saved };
    }
    const pending = (id: string, text: string): PendingDelivery => ({
      id,
      messenger: "telegram",
      botId: "bot1",
      externalChatId: "100",
      chat: { id: "100", type: "private" },
      message: { text, markup: "plain" },
      createdAt: new Date().toISOString(),
    });

    it("итог записан до отправки и удалён после неё; ждущий в очереди тоже записан", async () => {
      const { box, log, saved } = outbox();
      const queue = createOutboundQueue({ outbox: box });
      const calls: string[] = [];
      const op = (name: string) => async () => {
        calls.push(`${name}: ${[...saved.keys()].join(",")}`);
        return name;
      };
      const first = queue.run("chat-a", op("first"), { durable: () => pending("d1", "Первый") });
      const second = queue.run("chat-a", op("second"), { durable: () => pending("d2", "Второй") });
      expect(log).toEqual(["save d1 Первый", "save d2 Второй"]);
      expect(await Promise.all([first, second])).toEqual(["first", "second"]);
      await queue.flush();
      expect(calls).toEqual(["first: d1,d2", "second: d2"]);
      expect(log.slice(2)).toEqual(["remove d1", "remove d2"]);
      expect(saved.size).toBe(0);
    });

    it("к началу отправки итог поменялся (стало известно сообщение для правки) — запись обновляется", async () => {
      const { box, log } = outbox();
      const queue = createOutboundQueue({ outbox: box });
      let text = "Набросок";
      const sent = queue.run("chat-a", async () => "ok", { durable: () => pending("d1", text) });
      text = "Готово";
      await sent;
      await queue.flush();
      expect(log).toEqual(["save d1 Набросок", "save d1 Готово", "remove d1"]);
    });

    it("окончательный сбой и «заблокирован» тоже удаляют запись; сбой записи — в журнал, итог всё равно уходит", async () => {
      const { box, saved } = outbox();
      const errors: unknown[] = [];
      const queue = createOutboundQueue({ outbox: box, logError: (error) => errors.push(error) });
      const refused = queue.run("chat-a", async () => {
        throw new MessengerApiError("Bad Request", 400);
      }, { durable: () => pending("d1", "x") });
      await expect(refused).rejects.toBeInstanceOf(MessengerApiError);
      const blocked = queue.run("chat-b", async () => {
        throw new MessengerBlockedError("blocked");
      }, { durable: () => pending("d2", "y") });
      await expect(blocked).rejects.toBeInstanceOf(MessengerBlockedError);
      await queue.flush();
      expect(saved.size).toBe(0);

      const broken = createOutboundQueue({
        outbox: {
          save: async () => {
            throw new Error("база недоступна");
          },
          remove: async () => undefined,
          release: async () => undefined,
        },
        logError: (error) => errors.push(error),
      });
      expect(await broken.run("chat-a", async () => "ушло", { durable: () => pending("d3", "z") })).toBe("ушло");
      expect(errors.map((error) => (error as Error).message)).toEqual(["база недоступна"]);
    });

    it("временный сбой (сеть, 5xx, долгое «слишком часто») после всех повторов — запись остаётся для повтора позже", async () => {
      const { box, log, saved } = outbox();
      const queue = createOutboundQueue({ outbox: box, finalAttempts: 2, retryDelayMs: 10 });
      const down = queue.run("chat-a", async () => {
        throw new MessengerApiError("Bad Gateway", 502);
      }, { durable: () => pending("d1", "Итог") });
      const busy = queue.run("chat-b", async () => {
        throw new MessengerRateLimitError("Too Many Requests", 10);
      }, { durable: () => pending("d2", "Итог") });
      const both = Promise.allSettled([down, busy]);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await both).map((result) => result.status)).toEqual(["rejected", "rejected"]);
      await queue.flush();
      expect(log.filter((line) => !line.startsWith("save"))).toEqual(["release d1", "release d2"]);
      expect([...saved.keys()]).toEqual(["d1", "d2"]);
    });

    it("промежуточная правка не записывается", async () => {
      const { box, log } = outbox();
      const queue = createOutboundQueue({ outbox: box });
      await queue.run("chat-a", async () => "edit", { slot: "live", durable: () => pending("d1", "x") });
      await queue.flush();
      expect(log).toEqual([]);
    });
  });
});
