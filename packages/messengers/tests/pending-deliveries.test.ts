import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createButtonActions } from "../src/button-actions";
import { MessengerApiError, MessengerMarkupError } from "../src/messenger-api";
import { createOutboundQueue } from "../src/outbound-queue";
import { createPendingDeliveries, DELIVERY_GIVE_UP_MS, durableDelivery } from "../src/pending-deliveries";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { ConversationKey } from "../src/types";
import { createFakeAdapter } from "./support/fake-adapter";
import { createFakeChatService } from "./support/fake-chat-service";

const NOW = Date.UTC(2026, 9, 5, 12, 0);
const key: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: "100" };
const chat = { id: "100", type: "private" as const };
/** Записи в хранилище идут не сразу: даём им дойти (часы поддельные только для даты). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<never>(() => undefined);

/** Две копии сервера на одном хранилище: у каждой своя очередь и свой мессенджер. */
function setup() {
  const store = createMemoryMessengerStore();
  const { service } = createFakeChatService();
  const buttons = createButtonActions({ store, service });
  const errors: unknown[] = [];
  const copy = (holder: string) => {
    const deliveries = createPendingDeliveries({ store, buttons, holder, leaseMs: 60_000, logError: (error) => errors.push(error) });
    const fake = createFakeAdapter();
    const queue = createOutboundQueue({ retryDelayMs: 0, outbox: deliveries.outbox, logError: (error) => errors.push(error) });
    return { deliveries, fake, queue, bot: fake.bot() };
  };
  return { store, errors, copy };
}

describe("итоги после перезапуска", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("итог упавшей копии после срока аренды отправляет другая — с теми же кнопками, нажатие работает", async () => {
    const { store, copy } = setup();
    const first = copy("a");
    const second = copy("b");
    const prepared = createButtonActions({ store, service: createFakeChatService().service }).prepare(key, [[{ text: "Да", action: { type: "reply", text: "да" } }]]);
    // Первая копия записала итог и «упала» посреди отправки.
    void first.queue.run("telegram/bot1/100", never, {
      durable: durableDelivery(key, () => ({ chat, message: { text: "<b>Итог</b>", markup: "html", buttons: prepared.buttons }, rows: prepared.rows })),
    });
    await tick();

    expect(await second.deliveries.recover(second.bot, second.queue)).toBe(0);
    vi.setSystemTime(NOW + 60_000);
    expect(await second.deliveries.recover(second.bot, second.queue)).toBe(1);
    await second.queue.flush();
    expect(second.fake.sent.map((item) => [item.chat, item.message.text, item.message.markup])).toEqual([[chat, "<b>Итог</b>", "html"]]);
    const buttonId = prepared.rows[0]?.[0]?.id ?? "";
    expect(second.fake.sent[0]?.message.buttons?.[0]?.[0]?.id).toBe(buttonId);
    expect(await store.takeButton(key, buttonId, new Date().toISOString())).toMatchObject({ type: "reply", text: "да", messageId: "m1" });
    // Отправлено — запись удалена: третья копия ничего не находит.
    vi.setSystemTime(NOW + 10 * 60_000);
    expect(await copy("c").deliveries.recover(second.bot, second.queue)).toBe(0);
  });

  it("живая копия продлевает аренду: её итог никто не забирает", async () => {
    const { copy } = setup();
    const first = copy("a");
    const second = copy("b");
    void first.queue.run("telegram/bot1/100", never, { durable: durableDelivery(key, () => ({ chat, message: { text: "Итог", markup: "plain" } })) });
    await tick();
    vi.setSystemTime(NOW + 50_000);
    await first.deliveries.renew();
    vi.setSystemTime(NOW + 100_000);
    expect(await second.deliveries.recover(second.bot, second.queue)).toBe(0);
    vi.setSystemTime(NOW + 110_000);
    expect(await second.deliveries.recover(second.bot, second.queue)).toBe(1);
  });

  it("правка сообщения повторяется правкой; отказ разметки — простым текстом; отказ кнопок — без кнопок", async () => {
    const { store, copy } = setup();
    const crashed = copy("a");
    const edit = { chat, messageId: "77" };
    const rows = [[{ id: "btn00001", text: "Да", action: { type: "reply", text: "да" } }]];
    for (const [text, extra] of [
      ["<b>Правка</b>", { edit }],
      ["<b>Отказ разметки</b>", {}],
      ["Отказ кнопок", { rows }],
    ] as const) {
      void crashed.queue.run(`telegram/bot1/${text}`, never, {
        durable: durableDelivery(key, () => ({ chat, message: { text, markup: "html" }, ...extra })),
      });
    }
    await tick();
    const next = copy("b");
    // Сбои по порядку вызовов: разметка, её повтор простым текстом проходит, затем кнопки.
    next.fake.failures.send.push(new MessengerMarkupError("can't parse entities"), undefined, new MessengerApiError("BUTTON_DATA_INVALID", 400));
    vi.setSystemTime(NOW + 60_000);
    expect(await next.deliveries.recover(next.bot, next.queue)).toBe(3);
    await next.queue.flush();
    expect(next.fake.edits.map((item) => [item.sent, item.message.text])).toEqual([[edit, "<b>Правка</b>"]]);
    expect(next.fake.sent.map((item) => [item.message.text, item.message.markup, item.message.buttons])).toEqual([
      ["Отказ разметки", "plain", undefined],
      ["Отказ кнопок", "html", undefined],
    ]);
    expect(await store.takeButton(key, "btn00001", new Date().toISOString())).toBeNull();
  });

  it("сбой удаления записи — повтор при следующем продлении, иначе копия держала бы отправленный итог вечно", async () => {
    const { store, copy, errors } = setup();
    const first = copy("a");
    const remove = store.deletePendingDelivery.bind(store);
    let broken = true;
    store.deletePendingDelivery = async (id) => {
      if (broken) throw new Error("база недоступна");
      return remove(id);
    };
    await first.queue.run("telegram/bot1/100", () => first.bot.adapter.send(chat, { text: "Итог", markup: "plain" }), {
      durable: durableDelivery(key, () => ({ chat, message: { text: "Итог", markup: "plain" } })),
    });
    await first.queue.flush();
    expect(errors).toHaveLength(1);
    broken = false;
    await first.deliveries.renew();
    vi.setSystemTime(NOW + 10 * 60_000);
    expect(await copy("b").deliveries.recover(first.bot, first.queue)).toBe(0);
  });

  it("мессенджер недоступен дольше повторов очереди — запись остаётся, аренда повторяет итог позже, пауза растёт", async () => {
    const { copy } = setup();
    const first = copy("a");
    const down = () => Promise.reject(new MessengerApiError("Bad Gateway", 502));
    const failed = first.queue.run("telegram/bot1/100", down, { durable: durableDelivery(key, () => ({ chat, message: { text: "Итог", markup: "plain" } })) });
    await expect(failed).rejects.toBeInstanceOf(MessengerApiError);
    await first.queue.flush();
    // Своя копия запись не держит: продление её не трогает, повтор достаётся любой копии по сроку.
    await first.deliveries.renew();
    vi.setSystemTime(NOW + 10_000);
    expect(await copy("b").deliveries.recover(first.bot, first.queue)).toBe(0);

    // Повтор снова не прошёл — следующий не раньше, чем через столько же, сколько итог уже ждёт.
    vi.setSystemTime(NOW + 31 * 60_000);
    const second = copy("b");
    second.bot.adapter.send = down;
    expect(await second.deliveries.recover(second.bot, second.queue)).toBe(1);
    await second.queue.flush();
    vi.setSystemTime(NOW + 50 * 60_000);
    expect(await copy("c").deliveries.recover(second.bot, second.queue)).toBe(0);

    vi.setSystemTime(NOW + 70 * 60_000);
    const third = copy("c");
    expect(await third.deliveries.recover(third.bot, third.queue)).toBe(1);
    await third.queue.flush();
    expect(third.fake.texts()).toEqual(["Итог"]);
    vi.setSystemTime(NOW + 24 * 60 * 60_000);
    expect(await copy("d").deliveries.recover(third.bot, third.queue)).toBe(0);
  });

  it("итог ждёт дольше предела — после очередного временного сбоя запись удаляется, вечных повторов нет", async () => {
    const { copy } = setup();
    const first = copy("a");
    const durable = durableDelivery(key, () => ({ chat, message: { text: "Итог", markup: "plain" } }));
    vi.setSystemTime(NOW + DELIVERY_GIVE_UP_MS + 1);
    const failed = first.queue.run("telegram/bot1/100", () => Promise.reject(new MessengerApiError("Bad Gateway", 502)), { durable });
    await expect(failed).rejects.toBeInstanceOf(MessengerApiError);
    await first.queue.flush();
    vi.setSystemTime(NOW + 2 * DELIVERY_GIVE_UP_MS);
    expect(await copy("b").deliveries.recover(first.bot, first.queue)).toBe(0);
  });

  it("сбой записи при отпускании — повтор при следующем продлении", async () => {
    const { store, copy, errors } = setup();
    const first = copy("a");
    const save = store.savePendingDelivery.bind(store);
    let broken = false;
    store.savePendingDelivery = async (...args) => {
      if (broken) throw new Error("база недоступна");
      return save(...args);
    };
    const failed = first.queue.run("telegram/bot1/100", async () => {
      broken = true;
      throw new MessengerApiError("Bad Gateway", 502);
    }, { durable: durableDelivery(key, () => ({ chat, message: { text: "Итог", markup: "plain" } })) });
    await expect(failed).rejects.toBeInstanceOf(MessengerApiError);
    await first.queue.flush();
    expect(errors.map((error) => (error as Error).message)).toContain("база недоступна");
    broken = false;
    await first.deliveries.renew();
    // Копия жива и продлевает свои итоги — отпущенный среди них не держится.
    vi.setSystemTime(NOW + 60 * 60_000);
    await first.deliveries.renew();
    expect(await copy("b").deliveries.recover(first.bot, first.queue)).toBe(1);
  });
});
