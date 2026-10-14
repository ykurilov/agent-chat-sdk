import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMessengers } from "../src/create-messengers";
import { MessengerApiError, MessengerBlockedError, MessengerWindowClosedError } from "../src/messenger-api";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { AnswerDeliveryReport, ConversationKey, MessengersOptions } from "../src/types";
import { createFakeAdapter, privateChat, update } from "./support/fake-adapter";
import { createFakeChatService, streamOf, textAnswer } from "./support/fake-chat-service";

// 061 этап 5: `createMessengers({ onAnswerDelivery })` — исход доставки каждого ответа наружу; ход notice — обязательно.

const NOW = Date.UTC(2026, 9, 14, 12, 0);
const BASE = "/api/messengers";
const key: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: privateChat.id };

function setup(overrides: Partial<MessengersOptions> = {}) {
  const fake = createFakeAdapter();
  const store = createMemoryMessengerStore();
  const chats = createFakeChatService();
  const errors: unknown[] = [];
  const reports: AnswerDeliveryReport[] = [];
  const messengers = createMessengers({
    service: chats.service,
    store,
    resolveUser: async () => null,
    bots: [fake.bot()],
    basePath: BASE,
    taskReadyPing: false,
    logError: (error) => errors.push(error),
    onAnswerDelivery: (report) => {
      reports.push(report);
    },
    ...overrides,
  });
  const link = () => store.saveLink({ messenger: "telegram", botId: "bot1", externalUserId: "100", userId: "anna", name: "Анна", linkedAt: new Date().toISOString() });
  const post = (updates: unknown[]) =>
    messengers.handler.fetch(
      new Request(`http://app${BASE}/telegram/webhook`, { method: "POST", headers: { "x-secret": "webhook-secret", "content-type": "application/json" }, body: JSON.stringify({ updates }) }),
    );
  const settle = async () => {
    let finished = false;
    const done = messengers.flush().then(() => {
      finished = true;
    });
    for (let step = 0; step < 100 && !finished; step++) await vi.advanceTimersByTimeAsync(500);
    await done;
  };
  /** Человек написал, агент ответил: разговор и текущий чат `chat-1` есть. */
  async function talked() {
    await link();
    await post([update({ text: "Привет" })]);
    await settle();
    await messengers.start();
    reports.length = 0;
  }
  /** Агент пишет первым: ход сервера в `chat-1`. */
  async function notice(text: string, messageId: string, extra: { deliveredByApp?: true; channel?: "web" | "telegram" } = {}) {
    chats.service.continuation = () => streamOf(textAnswer(text, messageId));
    chats.emit({ type: "turn-started", ownerId: "anna", chatId: "chat-1", messageId, trigger: "notice", channel: extra.channel ?? "web", ...(extra.deliveredByApp && { deliveredByApp: true }) });
    await settle();
  }
  return { fake, store, chats, errors, reports, messengers, link, post, settle, talked, notice };
}

describe("исход доставки наружу — onAnswerDelivery (061)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("ответ на сообщение человека — `human`, доставлено", async () => {
    const { reports, link, post, settle, chats } = setup();
    await link();
    chats.service.respond = () => streamOf(textAnswer("Здравствуйте!", "answer-1"));
    await post([update({ text: "Привет" })]);
    await settle();
    expect(reports).toEqual([{ ownerId: "anna", chatId: "chat-1", messageId: "answer-1", trigger: "human", outcome: { status: "delivered" } }]);
  });

  it("агент пишет первым — `notice`, доставлено", async () => {
    const { reports, talked, notice, fake } = setup();
    await talked();
    await notice("Доброе утро!", "answer-9");
    expect(fake.texts().at(-1)).toBe("Доброе утро!");
    expect(reports).toEqual([{ ownerId: "anna", chatId: "chat-1", messageId: "answer-9", trigger: "notice", outcome: { status: "delivered" } }]);
  });

  it("заблокировал — `blocked`; следующий ход notice в заблокированный разговор — сразу `blocked`, без отправки", async () => {
    const { reports, talked, notice, fake, store } = setup();
    await talked();
    fake.failures.send.push(new MessengerBlockedError("telegram: Forbidden: bot was blocked by the user"));
    await notice("Доброе утро!", "answer-9");
    expect(reports).toEqual([{ ownerId: "anna", chatId: "chat-1", messageId: "answer-9", trigger: "notice", outcome: { status: "blocked" } }]);
    expect((await store.getConversation(key))?.blocked).toBe(true);

    const sentBefore = fake.sent.length;
    await notice("Как дела?", "answer-10");
    expect(fake.sent).toHaveLength(sentBefore);
    expect(reports.at(-1)).toEqual({ ownerId: "anna", chatId: "chat-1", messageId: "answer-10", trigger: "notice", outcome: { status: "blocked" } });
  });

  it("окно закрыто (ВК 950) — `window_closed`, разговор не заблокирован", async () => {
    const { reports, talked, notice, fake, store } = setup();
    await talked();
    fake.failures.send.push(new MessengerWindowClosedError("vk: ошибка 950: Can't send message, reply timed out"));
    await notice("Доброе утро!", "answer-9");
    expect(reports).toEqual([{ ownerId: "anna", chatId: "chat-1", messageId: "answer-9", trigger: "notice", outcome: { status: "window_closed" } }]);
    expect((await store.getConversation(key))?.blocked).toBe(false);
  });

  it("сеть лежит дольше повторов — `retry`; итог ушёл позже из хранилища итогов — ещё один исход `delivered`", async () => {
    const { reports, talked, notice, fake, settle } = setup();
    await talked();
    for (let i = 0; i < 4; i++) fake.failures.send.push(new MessengerApiError("telegram: сбой запроса к API: ECONNRESET", 0));
    await notice("Доброе утро!", "answer-9");
    expect(reports).toEqual([{ ownerId: "anna", chatId: "chat-1", messageId: "answer-9", trigger: "notice", outcome: { status: "retry" } }]);
    expect(fake.texts().at(-1)).not.toBe("Доброе утро!");

    // Отпущенный итог ждёт паузу и забирается при обходе хранилища.
    for (let step = 0; step < 40 && reports.length < 2; step++) {
      await vi.advanceTimersByTimeAsync(5000);
      await settle();
    }
    expect(fake.texts().at(-1)).toBe("Доброе утро!");
    expect(reports.at(-1)).toEqual({ ownerId: "anna", chatId: "chat-1", messageId: "answer-9", trigger: "notice", outcome: { status: "delivered" } });
  });

  it("мессенджер отказал насовсем — `failed`; ход сорвался — тоже `failed`", async () => {
    const { reports, talked, notice, fake, chats, settle } = setup();
    await talked();
    fake.failures.send.push(new MessengerApiError("telegram: Bad Request: chat not found", 400));
    await notice("Доброе утро!", "answer-9");
    expect(reports.at(-1)).toMatchObject({ messageId: "answer-9", outcome: { status: "failed" } });

    chats.service.continuation = () =>
      streamOf([
        { type: "start", messageId: "answer-10" },
        { type: "error", errorText: "модель недоступна" },
      ]);
    chats.emit({ type: "turn-started", ownerId: "anna", chatId: "chat-1", messageId: "answer-10", trigger: "notice", channel: "web" });
    await settle();
    expect(reports.at(-1)).toMatchObject({ messageId: "answer-10", trigger: "notice", outcome: { status: "failed" } });
  });

  it("ответ доставит приложение (`deliveredByApp`) — шлюз его не провожает и исхода не шлёт", async () => {
    const { reports, talked, notice, fake } = setup();
    await talked();
    const sentBefore = fake.sent.length;
    await notice("Доброе утро!", "answer-9", { deliveredByApp: true });
    expect(fake.sent).toHaveLength(sentBefore);
    expect(reports).toEqual([]);
  });

  it("служба проверяет ответы, ход notice из веба — без черновика и правок по ходу, только итог", async () => {
    const { reports, talked, fake, chats, settle } = setup();
    Object.assign(chats.service, { checksReplies: true });
    await talked();
    const draftsBefore = fake.drafts.length;
    const editsBefore = fake.edits.length;
    chats.service.continuation = () =>
      streamOf([
        { type: "start", messageId: "answer-9" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Доброе утpо! Черновик длиннее сорока знаков, чтобы появилась правка." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "data-step-reset" },
        { type: "start-step" },
        { type: "text-start", id: "t2" },
        { type: "text-delta", id: "t2", delta: "Доброе утро! Проверенный текст." },
        { type: "text-end", id: "t2" },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    chats.emit({ type: "turn-started", ownerId: "anna", chatId: "chat-1", messageId: "answer-9", trigger: "notice", channel: "web" });
    await settle();
    expect(fake.drafts.slice(draftsBefore)).toEqual([]);
    expect(fake.edits.slice(editsBefore)).toEqual([]);
    expect(fake.texts().at(-1)).toBe("Доброе утро! Проверенный текст.");
    expect(reports.at(-1)).toMatchObject({ messageId: "answer-9", outcome: { status: "delivered" } });
  });

  it("сбой в `onAnswerDelivery` — строка в журнале, доставка не ломается", async () => {
    const boom = new Error("приложение упало");
    const { errors, talked, notice, fake } = setup({
      onAnswerDelivery: () => {
        throw boom;
      },
    });
    await talked();
    await notice("Доброе утро!", "answer-9");
    expect(fake.texts().at(-1)).toBe("Доброе утро!");
    expect(errors).toContain(boom);
  });
});
