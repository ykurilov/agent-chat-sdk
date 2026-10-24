import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowDeliveryOutcome, FlowOutgoing } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import type { FlowStore } from "../../src/store/flow-store";
import { FLOW_DELIVERY_EXIT } from "../../src/runtime/flow-delivery";
import { withoutSilenceTimers } from "../flow-fixtures";
import { iso, msk, threeDays } from "./days-chat";
import { clockAt, human, OWNER, tick, timerChat, type TimerChat, type TimerChatSetup } from "./timer-chat";

// 131 на модели-заглушке и подменённых часах: канал сломан и ждёт починки (`await_repair`, `resumeDelivery`), копия
// упала или зависла посреди отправки, повтор доставки у законченного разговора.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

/** Касания 15 мин и 1 ч; своих таймеров тишины у сценария нет. */
const nudging = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: { afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }] } };
};

const AWAIT_REPAIR = { status: "await_repair" } as const;

/** Копия сервера со своей доставкой: исходы по очереди, дальше — `delivered`. */
function appCopy(outcomes: Array<FlowDeliveryOutcome | Promise<FlowDeliveryOutcome>> = [], setup: TimerChatSetup = {}) {
  const chat = timerChat({ edit: nudging, ...setup });
  const sent: FlowOutgoing[] = [];
  const deliver = vi.fn(async (message: FlowOutgoing) => {
    sent.push(message);
    return outcomes.shift() ?? { status: "delivered" as const };
  });
  chat.flow.attach({ portFor: () => chat.service, deliver });
  return { ...chat, sent, deliver };
}

/** Две копии сервера на общих хранилищах. */
function twoCopies(first: Parameters<typeof appCopy>[0], second: Parameters<typeof appCopy>[0] = [], setup: TimerChatSetup = {}) {
  const shared = { store: setup.store ?? memoryFlowStore(), storage: createInMemoryChatStorage(), ...setup };
  return [appCopy(first, shared), appCopy(second, shared)] as const;
}

/** Дождаться условия по настоящему времени: ожидание vitest при подменённых часах двигает и их. */
async function until(ok: () => boolean) {
  while (!ok()) await new Promise((resolve) => setTimeout(resolve, 10));
}

/** Хранилище, в котором первый подходящий вызов `swapDelivery` стоит, пока тест его не отпустит. */
function paused(inner: FlowStore, matches: (input: Parameters<FlowStore["swapDelivery"]>[1]) => boolean) {
  const gate = hanging();
  let reached = false;
  const store: FlowStore = {
    ...inner,
    async swapDelivery(chatId, input) {
      if (!reached && matches(input)) {
        reached = true;
        await gate.promise;
      }
      return inner.swapDelivery(chatId, input);
    },
  };
  return { store, reached: () => reached, open: () => gate.resolve({ status: "delivered" }) };
}

/** Внешний вызов, который идёт, пока тест его не отпустит. */
function hanging() {
  let resolve!: (outcome: FlowDeliveryOutcome) => void;
  const promise = new Promise<FlowDeliveryOutcome>((done) => (resolve = done));
  return { promise, resolve };
}

async function started(chat: TimerChat) {
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return id;
}

async function startedAndNudged(chat: TimerChat) {
  const id = await started(chat);
  clockAt(msk(14, 10, 15));
  await tick(chat, id);
  return id;
}

const undeliveredOf = async (chat: TimerChat, id: string) =>
  (await chat.service.peekHistory(OWNER, id)).messages.filter((message) => message.metadata?.undelivered === true).map((message) => message.role);
const touchesToday = (chat: TimerChat) => chat.store.countFirstMessages(OWNER, "2026-10-14");

describe("131: канал ждёт починки (await_repair)", () => {
  it("бот сломан сутки: попытка не тратится, повторов и новых ходов нет; после починки — тот же ответ, засчитан", async () => {
    const chat = appCopy([AWAIT_REPAIR, AWAIT_REPAIR]);
    const id = await startedAndNudged(chat);
    const calls = chat.model.doStreamCalls.length;
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null, delivery: { attempt: 1, pausedAt: iso(msk(14, 10, 15)) } });

    // Раньше ряд 1/5/30 мин сгорал, ответ помечался недоставленным. Теперь ждёт, сколько бы ни прошло.
    for (const at of [msk(14, 10, 16), msk(14, 11), msk(15, 10, 15)]) {
      clockAt(at);
      await tick(chat, id);
    }
    expect(chat.sent).toHaveLength(1);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(await undeliveredOf(chat, id)).toEqual([]);

    // Ещё не починили: отправка снова ждёт, попытка та же.
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: chat.sent[0]!.messageId })).toBe("resumed");
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null, delivery: { attempt: 1, pausedAt: iso(msk(15, 10, 15)) } });

    clockAt(msk(15, 12));
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: chat.sent[0]!.messageId })).toBe("resumed");
    // Повтор вызова безопасен: отправка уже поставлена.
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: chat.sent[0]!.messageId })).toBe("pending");
    await tick(chat, id);
    expect(chat.sent).toHaveLength(3);
    expect(chat.sent.map((message) => message.attempt)).toEqual([1, 1, 1]);
    expect(chat.sent.slice(1)).toEqual([chat.sent[0], chat.sent[0]]);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    const after = await chat.store.getChat(id);
    expect(after).toMatchObject({ delivery: null });
    expect(after?.dueAt).not.toBeNull();
    expect(after?.dueExitId).not.toBe(FLOW_DELIVERY_EXIT);
    // Засчитано в день, когда дошло.
    expect(await chat.store.countFirstMessages(OWNER, "2026-10-15")).toBe(1);
    expect(await undeliveredOf(chat, id)).toEqual([]);
  });

  it("не тот человек, другое сообщение, чужой или неизвестный чат — not_found; ожидание прежнее", async () => {
    const chat = appCopy([AWAIT_REPAIR]);
    const id = await startedAndNudged(chat);
    const { messageId } = chat.sent[0]!;
    const before = await chat.store.getChat(id);
    expect(await chat.flow.resumeDelivery({ ownerId: "чужой", chatId: id, messageId })).toBe("not_found");
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: "старое" })).toBe("not_found");
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: "нет", messageId })).toBe("not_found");
    expect(await chat.store.getChat(id)).toEqual(before);
  });

  it("нет ожидания починки — not_found; ждёт обычный повтор — pending", async () => {
    const chat = appCopy([{ status: "retry" }]);
    const id = await started(chat);
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: "m" })).toBe("not_found");
    clockAt(msk(14, 10, 15));
    await tick(chat, id);
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: chat.sent[0]!.messageId })).toBe("pending");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 16)), delivery: { attempt: 2 } });
  });

  it("у чата живая аренда — busy, ничего не меняется; аренда кончилась — resumed", async () => {
    const chat = appCopy([AWAIT_REPAIR]);
    const id = await startedAndNudged(chat);
    const pending = (await chat.store.getChat(id))!.delivery!;
    expect(await chat.store.swapDelivery(id, { expected: pending, next: pending, claim: { owner: "другая-копия", now: iso(Date.now()), leaseMs: 60_000 } })).toBe(true);
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: pending.messageId })).toBe("busy");
    expect((await chat.store.getChat(id))!.delivery).toEqual(pending);
    clockAt(Date.now() + 61_000);
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: pending.messageId })).toBe("resumed");
  });

  it("пауза переживает перезапуск: новая копия на том же хранилище отправляет тот же ответ после починки", async () => {
    const [broken, restarted] = twoCopies([AWAIT_REPAIR]);
    const id = await startedAndNudged(broken);
    clockAt(msk(14, 12));
    expect(await restarted.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: broken.sent[0]!.messageId })).toBe("resumed");
    await tick(restarted, id);
    expect(restarted.sent).toEqual([broken.sent[0]]);
    expect(restarted.model.doStreamCalls).toHaveLength(0);
    expect(await restarted.store.getChat(id)).toMatchObject({ delivery: null });
    expect(await touchesToday(restarted)).toBe(1);
  });

  it("человек написал, пока канал чинили — dropped: ответ не уходит, помечен недоставленным, не засчитан; сроки снова идут", async () => {
    const chat = appCopy([AWAIT_REPAIR]);
    const id = await startedAndNudged(chat);
    clockAt(msk(14, 11));
    await human(chat, id, "Алло");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null });
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: chat.sent[0]!.messageId })).toBe("dropped");
    await tick(chat, id);
    expect(chat.sent).toHaveLength(1);
    expect(await undeliveredOf(chat, id)).toEqual(["assistant"]);
    expect(await touchesToday(chat)).toBe(0);
    expect(await chat.store.getChat(id)).toMatchObject({ delivery: null, dueAt: iso(msk(14, 11, 15)) });
  });

  it("человек написал между починкой и отправкой — ответ снят при отправке тем же правилом", async () => {
    const chat = appCopy([AWAIT_REPAIR]);
    const id = await startedAndNudged(chat);
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: chat.sent[0]!.messageId })).toBe("resumed");
    clockAt(msk(14, 11));
    await human(chat, id, "Алло");
    await tick(chat, id);
    expect(chat.sent).toHaveLength(1);
    expect(await undeliveredOf(chat, id)).toEqual(["assistant"]);
    expect(await chat.store.getChat(id)).toMatchObject({ delivery: null, dueAt: iso(msk(14, 11, 15)) });
  });

  it("reportDelivery с await_repair — TypeError: каналы SDK повторяют сами", async () => {
    const chat = timerChat({ edit: nudging });
    const id = await started(chat);
    await expect(chat.flow.reportDelivery({ chatId: id, messageId: "m", outcome: AWAIT_REPAIR as never })).rejects.toThrow(TypeError);
  });
});

describe("131: доставка у законченного разговора", () => {
  const farewell = "Программа закончилась. Спасибо, что были с нами!";
  const farewellOf = (message: FlowOutgoing) => message.reasons.some((reason) => reason.kind === "farewell");

  it("прощание при сроке: повтор и ожидание починки после конца — тот же ответ, без новых ходов и без открытия разговора", async () => {
    clockAt(msk(13, 15));
    const outcomes: FlowDeliveryOutcome[] = [{ status: "retry" }, AWAIT_REPAIR];
    const chat = timerChat({ edit: (json) => threeDays(json, { farewellOnDeadline: true, farewellText: farewell }) });
    const sent: FlowOutgoing[] = [];
    chat.flow.attach({
      portFor: () => chat.service,
      deliver: async (message) => {
        sent.push(message);
        return (farewellOf(message) && outcomes.shift()) || { status: "delivered" };
      },
    });
    const id = await started(chat);
    for (const at of [msk(14, 9), msk(15, 9), msk(16, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    const ended = await chat.store.getChat(id);
    expect(ended).toMatchObject({ endReason: "deadline", dueAt: iso(msk(16, 9, 1)), dueExitId: FLOW_DELIVERY_EXIT, delivery: { attempt: 2 } });
    const calls = chat.model.doStreamCalls.length;

    clockAt(msk(16, 9, 1));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null, delivery: { attempt: 2, pausedAt: iso(msk(16, 9, 1)) } });

    clockAt(msk(17, 12));
    await tick(chat, id);
    const farewells = () => sent.filter(farewellOf);
    expect(farewells()).toHaveLength(2);
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: farewells()[0]!.messageId })).toBe("resumed");
    await tick(chat, id);

    expect(farewells().map((message) => [message.messageId, message.text, message.attempt])).toEqual([
      [farewells()[0]!.messageId, farewell, 1],
      [farewells()[0]!.messageId, farewell, 2],
      [farewells()[0]!.messageId, farewell, 2],
    ]);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(chat.finished).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ endedAt: ended!.endedAt, endReason: "deadline", reopenedAt: null, dueAt: null, delivery: null });
    clockAt(msk(18, 12));
    await tick(chat, id);
    expect(farewells()).toHaveLength(3);
  });
});

describe("131: копия упала или зависла посреди отправки", () => {
  it("посреди первой отправки дольше аренды — другая копия шлёт тот же ответ после паузы попытки; запоздалый итог ничего не меняет", async () => {
    const late = hanging();
    const [stale, fresh] = twoCopies([late.promise]);
    const id = await started(stale);
    clockAt(msk(14, 10, 15));
    const staleTick = stale.flow.tick();
    await until(() => stale.sent.length === 1);
    expect(await stale.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 16)), dueExitId: FLOW_DELIVERY_EXIT, delivery: { attempt: 1 } });

    // До срока попытки другая копия её не берёт.
    clockAt(msk(14, 10, 15) + 30_000);
    await tick(fresh, id);
    expect(fresh.sent).toEqual([]);

    clockAt(msk(14, 10, 16) + 1_000);
    await tick(fresh, id);
    expect(fresh.sent).toEqual(stale.sent);
    expect(fresh.model.doStreamCalls).toHaveLength(0);
    const settled = await fresh.store.getChat(id);
    expect(settled).toMatchObject({ delivery: null });
    expect(await touchesToday(fresh)).toBe(1);

    // Зависшая копия вернулась с отказом: запись уже чужая — ни пометки, ни пересчёта.
    late.resolve({ status: "failed" });
    await staleTick;
    await stale.flow.settled();
    expect(await fresh.store.getChat(id)).toEqual(settled);
    expect(await undeliveredOf(fresh, id)).toEqual([]);
    expect(await touchesToday(fresh)).toBe(1);
  });

  it("посреди повтора — та же попытка через свою паузу, тот же ответ; запоздалое «доставлено» не засчитано второй раз", async () => {
    const late = hanging();
    const [stale, fresh] = twoCopies([{ status: "retry" }, late.promise]);
    const id = await startedAndNudged(stale);
    clockAt(msk(14, 10, 16));
    const staleTick = stale.flow.tick();
    await until(() => stale.sent.length === 2);
    // Пауза второй попытки — 5 мин: раньше другая копия её не повторит.
    clockAt(msk(14, 10, 20));
    await tick(fresh, id);
    expect(fresh.sent).toEqual([]);

    clockAt(msk(14, 10, 21));
    await tick(fresh, id);
    expect(fresh.sent).toEqual([stale.sent[1]]);
    expect(fresh.sent[0]).toMatchObject({ attempt: 2, messageId: stale.sent[0]!.messageId, parts: stale.sent[0]!.parts });
    const settled = await fresh.store.getChat(id);

    late.resolve({ status: "delivered" });
    await staleTick;
    await stale.flow.settled();
    expect(await fresh.store.getChat(id)).toEqual(settled);
    expect(await touchesToday(fresh)).toBe(1);
  });

  it("аренду взяла другая копия, а запись ещё прежняя: итог первой — один раз, другая не шлёт и не считает", async () => {
    const late = hanging();
    const shared = { store: memoryFlowStore(), storage: createInMemoryChatStorage() };
    const reserve = paused(shared.store, (input) => input.claim !== undefined);
    const stale = appCopy([late.promise], shared);
    const fresh = appCopy([], { ...shared, store: reserve.store });
    const id = await started(stale);
    clockAt(msk(14, 10, 15));
    const staleTick = stale.flow.tick();
    await until(() => stale.sent.length === 1);
    const reserved = (await stale.store.getChat(id))!.delivery;

    // Аренда кончилась: другая копия взяла чат и стоит перед своей заменой записи — запись ещё первой копии.
    clockAt(msk(14, 10, 16) + 1_000);
    const freshTick = fresh.flow.tick();
    await until(reserve.reached);
    expect((await stale.store.getChat(id))!.delivery).toEqual(reserved);

    late.resolve({ status: "delivered" });
    await staleTick;
    await stale.flow.settled();
    reserve.open();
    await freshTick;
    await fresh.flow.settled();
    expect(fresh.sent).toEqual([]);
    expect(await touchesToday(stale)).toBe(1);
    const after = await stale.store.getChat(id);
    expect(after).toMatchObject({ delivery: null });
    expect(after?.dueExitId).not.toBe(FLOW_DELIVERY_EXIT);
  });

  it("другая копия зарезервировала первой: запоздалое «доставлено» не перетирает её «ждёт починки»", async () => {
    const late = hanging();
    const [stale, fresh] = twoCopies([late.promise], [AWAIT_REPAIR]);
    const id = await started(stale);
    clockAt(msk(14, 10, 15));
    const staleTick = stale.flow.tick();
    await until(() => stale.sent.length === 1);

    clockAt(msk(14, 10, 16) + 1_000);
    await tick(fresh, id);
    expect(fresh.sent).toEqual(stale.sent);
    const repair = await fresh.store.getChat(id);
    expect(repair).toMatchObject({ dueAt: null, delivery: { pausedAt: iso(msk(14, 10, 16) + 1_000) } });

    late.resolve({ status: "delivered" });
    await staleTick;
    await stale.flow.settled();
    expect(await fresh.store.getChat(id)).toEqual(repair);
    expect(await touchesToday(fresh)).toBe(0);

    expect(await fresh.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: stale.sent[0]!.messageId })).toBe("resumed");
    await tick(fresh, id);
    expect(fresh.sent).toHaveLength(2);
    expect(await touchesToday(fresh)).toBe(1);
  });

  it("длинный callback дольше аренды: продление держит её, другая копия ту же попытку не начинает", async () => {
    const inner = memoryFlowStore();
    const renewals: string[] = [];
    const store: FlowStore = {
      ...inner,
      async renewLease(input) {
        const renewed = await inner.renewLease(input);
        if (renewed && input.owner.startsWith("flow-delivery:")) renewals.push(input.now);
        return renewed;
      },
    };
    const late = hanging();
    // Аренда 300 мс: продление каждые 100 мс настоящего времени.
    const [slow, other] = twoCopies([late.promise], [], { store, timers: { leaseMs: 300 } });
    const id = await started(slow);
    clockAt(msk(14, 10, 15));
    const slowTick = slow.flow.tick();
    await until(() => slow.sent.length === 1);

    // По часам прошло больше минуты: и аренда, и срок попытки кончились бы, но продление идёт.
    clockAt(msk(14, 10, 16) + 1_000);
    const jumped = iso(Date.now());
    await until(() => renewals.some((at) => at >= jumped));
    await tick(other, id);
    expect(other.sent).toEqual([]);

    late.resolve({ status: "delivered" });
    await slowTick;
    await slow.flow.settled();
    expect(await store.getChat(id)).toMatchObject({ delivery: null });
    expect(await touchesToday(slow)).toBe(1);
    await tick(other, id);
    expect(other.sent).toEqual([]);
  });
});

describe("131: последняя проверка перед отправкой", () => {
  const resumed = async (chat: ReturnType<typeof appCopy>, id: string) =>
    expect(await chat.flow.resumeDelivery({ ownerId: OWNER, chatId: id, messageId: chat.sent[0]!.messageId })).toBe("resumed");
  const droppedOnce = async (chat: ReturnType<typeof appCopy>, id: string) => {
    expect(chat.sent).toHaveLength(1);
    expect(await undeliveredOf(chat, id)).toEqual(["assistant"]);
    expect(await touchesToday(chat)).toBe(0);
    expect(await chat.store.getChat(id)).toMatchObject({ delivery: null });
  };

  it("человек написал, пока повтор после починки читал пояс: ответ снят перед отправкой", async () => {
    const inner = memoryFlowStore();
    const zone = hanging();
    let armed = false;
    let reading = false;
    const store: FlowStore = {
      ...inner,
      async readTimeZone(ownerId) {
        if (armed && !reading) {
          reading = true;
          await zone.promise;
        }
        return inner.readTimeZone(ownerId);
      },
    };
    const chat = appCopy([AWAIT_REPAIR], { store });
    const id = await startedAndNudged(chat);
    await resumed(chat, id);
    armed = true;
    const ticking = chat.flow.tick();
    await until(() => reading);
    await human(chat, id, "Алло");
    zone.resolve({ status: "delivered" });
    await ticking;
    await chat.flow.settled();
    await droppedOnce(chat, id);
  });

  it("человек написал, пока повтор после починки брал резерв: ответ снят перед отправкой", async () => {
    const inner = memoryFlowStore();
    let armed = false;
    const reserve = paused(inner, (input) => armed && input.claim !== undefined);
    const chat = appCopy([AWAIT_REPAIR], { store: reserve.store });
    const id = await startedAndNudged(chat);
    await resumed(chat, id);
    armed = true;
    const ticking = chat.flow.tick();
    await until(reserve.reached);
    await human(chat, id, "Алло");
    reserve.open();
    await ticking;
    await chat.flow.settled();
    await droppedOnce(chat, id);
  });

  it("flow.end, пока таймер ждал ответ модели: касание не уходит, ожидания доставки нет", async () => {
    const chat = appCopy();
    const id = await started(chat);
    const answer = hanging();
    let streaming = false;
    const stream = chat.model.doStream.bind(chat.model);
    chat.model.doStream = async (options) => {
      streaming = true;
      await answer.promise;
      return stream(options);
    };
    clockAt(msk(14, 10, 15));
    const ticking = chat.flow.tick();
    await until(() => streaming);
    expect(await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" })).toEqual({ ended: true });
    answer.resolve({ status: "delivered" });
    await ticking;
    await chat.flow.settled();
    expect(chat.sent).toEqual([]);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "switched", delivery: null, dueAt: null });
    expect(await undeliveredOf(chat, id)).toEqual(["assistant"]);
    clockAt(msk(14, 12));
    await tick(chat, id);
    expect(chat.sent).toEqual([]);
  });

  it("аренду держит другая копия, flow.end, пока ответ вставал в очередь: ни ожидания, ни отправки", async () => {
    const inner = memoryFlowStore();
    const reserve = paused(inner, (input) => input.expected === null && input.claim !== undefined);
    const queue = paused(reserve.store, (input) => input.expected === null && input.claim === undefined);
    const chat = appCopy([], { store: queue.store });
    const id = await started(chat);
    clockAt(msk(14, 10, 15));
    const ticking = chat.flow.tick();
    await until(reserve.reached);
    // Другая копия взяла аренду чата: резерв не выйдет, ответ встаёт в очередь.
    expect(await inner.swapDelivery(id, { expected: null, next: null, claim: { owner: "copy-b", now: iso(Date.now()), leaseMs: 60_000 } })).toBe(true);
    reserve.open();
    await until(queue.reached);
    expect(await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" })).toEqual({ ended: true });
    queue.open();
    await ticking;
    await chat.flow.settled();
    expect(chat.sent).toEqual([]);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "switched", delivery: null, dueAt: null });
    expect(await undeliveredOf(chat, id)).toEqual(["assistant"]);
    clockAt(msk(14, 12));
    await tick(chat, id);
    expect(chat.sent).toEqual([]);
  });

  it("аренду держит другая копия, разговор идёт: ответ ждёт в очереди и уходит один раз, когда аренда кончилась", async () => {
    const inner = memoryFlowStore();
    const reserve = paused(inner, (input) => input.expected === null && input.claim !== undefined);
    const chat = appCopy([], { store: reserve.store });
    const id = await started(chat);
    clockAt(msk(14, 10, 15));
    const ticking = chat.flow.tick();
    await until(reserve.reached);
    expect(await inner.swapDelivery(id, { expected: null, next: null, claim: { owner: "copy-b", now: iso(Date.now()), leaseMs: 60_000 } })).toBe(true);
    reserve.open();
    await ticking;
    await chat.flow.settled();
    expect(chat.sent).toEqual([]);
    expect((await inner.getChat(id))?.delivery).not.toBeNull();
    clockAt(msk(14, 11, 30));
    await tick(chat, id);
    expect(chat.sent).toHaveLength(1);
    expect((await inner.getChat(id))?.delivery).toBeNull();
  });

  it("flow.reopen успел открыть разговор, пока flow.end дочищал: срок открытого разговора остаётся", async () => {
    const inner = memoryFlowStore();
    const closed = hanging();
    let inEnd = false;
    const store: FlowStore = {
      ...inner,
      async endChat(chatId, input) {
        const after = await inner.endChat(chatId, input);
        if (!inEnd) {
          inEnd = true;
          await closed.promise;
        }
        return after;
      },
    };
    const chat = appCopy([], { store });
    const id = await started(chat);
    const end = chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    await until(() => inEnd);
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id })).toEqual({ reopened: true });
    const reopened = await inner.getChat(id);
    expect(reopened).toMatchObject({ endedAt: null });
    expect(reopened?.dueAt).not.toBeNull();
    closed.resolve({ status: "delivered" });
    expect(await end).toEqual({ ended: true });
    await chat.flow.settled();
    expect(await inner.getChat(id)).toMatchObject({ endedAt: null, dueAt: reopened?.dueAt, dueExitId: reopened?.dueExitId });
    // Копия помнит разговор открытым: его снова можно закончить.
    expect(await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" })).toEqual({ ended: true });
  });

  it("отправка записана, пока flow.end закрывал разговор: после конца её нет, повтора нет", async () => {
    const inner = memoryFlowStore();
    const ending = hanging();
    let inEnd = false;
    const store: FlowStore = {
      ...inner,
      async endChat(chatId, input) {
        if (!inEnd) {
          inEnd = true;
          await ending.promise;
        }
        return inner.endChat(chatId, input);
      },
    };
    const chat = appCopy([{ status: "retry" }], { store });
    const id = await started(chat);
    const answer = hanging();
    let streaming = false;
    const stream = chat.model.doStream.bind(chat.model);
    chat.model.doStream = async (options) => {
      streaming = true;
      await answer.promise;
      return stream(options);
    };
    clockAt(msk(14, 10, 15));
    const ticking = chat.flow.tick();
    await until(() => streaming);
    const end = chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    await until(() => inEnd);
    // Разговор ещё не закончен: касание уходит, «повторить» ставит ожидание.
    answer.resolve({ status: "delivered" });
    await ticking;
    expect(chat.sent).toHaveLength(1);
    expect((await inner.getChat(id))?.delivery).toMatchObject({ attempt: 2 });
    ending.resolve({ status: "delivered" });
    expect(await end).toEqual({ ended: true });
    await chat.flow.settled();
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "switched", delivery: null, dueAt: null });
    clockAt(msk(14, 12));
    await tick(chat, id);
    expect(chat.sent).toHaveLength(1);
  });

  it("flow.end, пока первая отправка брала резерв: касание не уходит, ожидания доставки нет", async () => {
    const inner = memoryFlowStore();
    const reserve = paused(inner, (input) => input.expected === null && input.claim !== undefined);
    const chat = appCopy([], { store: reserve.store });
    const id = await started(chat);
    clockAt(msk(14, 10, 15));
    const ticking = chat.flow.tick();
    await until(reserve.reached);
    expect(await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" })).toEqual({ ended: true });
    reserve.open();
    await ticking;
    await chat.flow.settled();
    expect(chat.sent).toEqual([]);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "switched", delivery: null, dueAt: null });
    expect(await undeliveredOf(chat, id)).toEqual(["assistant"]);
    clockAt(msk(14, 12));
    await tick(chat, id);
    expect(chat.sent).toEqual([]);
  });
});

describe("131: хранилище без договора 0.81", () => {
  it("без guarded: true — createAgentFlow отказывается сразу (TypeError)", () => {
    const { guarded: _, ...legacy } = memoryFlowStore();
    expect(() => timerChat({ store: legacy as unknown as FlowStore })).toThrow(/guarded/);
    expect(() => timerChat({ store: legacy as unknown as FlowStore })).toThrow(TypeError);
  });

  it("своя доставка без swapDelivery — attach отказывается (TypeError)", () => {
    const chat = timerChat({ store: { ...memoryFlowStore(), swapDelivery: undefined } as unknown as FlowStore });
    expect(() => chat.flow.attach({ portFor: () => chat.service, deliver: async () => ({ status: "delivered" }) })).toThrow(TypeError);
  });
});
