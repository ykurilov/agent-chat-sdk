import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverAnswer } from "../src/answer-delivery";
import { createButtonActions } from "../src/button-actions";
import type { AnswerChunk } from "../src/chat-port";
import { MessengerApiError, MessengerBlockedError, MessengerRateLimitError, MessengerWindowClosedError } from "../src/messenger-api";
import type { MessengerAbilities } from "../src/messenger-adapter";
import { createOutboundQueue } from "../src/outbound-queue";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { ConversationKey } from "../src/types";
import { createFakeAdapter, privateChat } from "./support/fake-adapter";
import { createFakeChatService, streamOf, textAnswer } from "./support/fake-chat-service";

// 061 этап 5: исход доставки ответа — доставлено, заблокировал, окно закрыто, повтор позже, не ушло совсем.

const NOW = Date.UTC(2026, 9, 14, 12, 0);
const key: ConversationKey = { messenger: "vk", botId: "bot1", externalChatId: "100" };

function setup(abilities: Partial<MessengerAbilities> = {}) {
  const fake = createFakeAdapter({ messenger: "vk", abilities });
  const store = createMemoryMessengerStore();
  const service = createFakeChatService();
  const queue = createOutboundQueue({ gapMs: fake.adapter.abilities.editEveryMs, retryDelayMs: 1000, finalAttempts: 3 });
  const buttons = createButtonActions({ store, service: service.service });
  const deliver = (stream: ReadableStream<AnswerChunk>, options: { holdText?: boolean } = {}) =>
    deliverAnswer({ adapter: fake.adapter, chat: privateChat, chatKey: "vk/bot1/100", queue, buttons, key, chatId: "chat-1", stream, ...options });
  /** Доставка с прокруткой поддельных часов: очередь ждёт паузы повторов. */
  async function settled(stream: ReadableStream<AnswerChunk>, options: { holdText?: boolean } = {}) {
    let result: Awaited<ReturnType<typeof deliver>> | undefined;
    const done = deliver(stream, options).then((value) => {
      result = value;
    });
    for (let step = 0; step < 200 && !result; step++) await vi.advanceTimersByTimeAsync(500);
    await done;
    return result as Awaited<ReturnType<typeof deliver>>;
  }
  return { fake, deliver, settled };
}

describe("исход доставки ответа (061)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("ушло — `finished`, ничего не потеряно", async () => {
    const { fake, settled } = setup();
    const outcome = await settled(streamOf(textAnswer("Доброе утро!", "answer-1")));
    expect(outcome).toMatchObject({ status: "finished", messageId: "answer-1" });
    expect(outcome.unsent).toBeUndefined();
    expect(fake.texts()).toEqual(["Доброе утро!"]);
  });

  it("человек заблокировал бота (403) — `blocked`", async () => {
    const { fake, settled } = setup();
    fake.failures.send.push(new MessengerBlockedError("vk: ошибка 901"));
    const outcome = await settled(streamOf(textAnswer("Доброе утро!")));
    expect(outcome.status).toBe("blocked");
    expect(fake.texts()).toEqual([]);
  });

  it("ВК не пускает писать первым (950) — `window_closed`, без повторов", async () => {
    const { fake, settled } = setup();
    fake.failures.send.push(new MessengerWindowClosedError("vk: ошибка 950: Can't send message, reply timed out"));
    const outcome = await settled(streamOf(textAnswer("Доброе утро!")));
    expect(outcome.status).toBe("window_closed");
    expect(outcome.unsent).toBeUndefined();
    expect(fake.texts()).toEqual([]);
  });

  it("«слишком часто» (429), потом ушло — `finished`, текст один раз", async () => {
    const { fake, settled } = setup();
    fake.failures.send.push(new MessengerRateLimitError("vk: ошибка 6", 1000));
    const outcome = await settled(streamOf(textAnswer("Доброе утро!")));
    expect(outcome.status).toBe("finished");
    expect(outcome.unsent).toBeUndefined();
    expect(fake.texts()).toEqual(["Доброе утро!"]);
  });

  it("сбой сети, потом ушло — `finished`", async () => {
    const { fake, settled } = setup();
    fake.failures.send.push(new MessengerApiError("vk: сбой запроса к API: ECONNRESET", 0));
    const outcome = await settled(streamOf(textAnswer("Доброе утро!")));
    expect(outcome.status).toBe("finished");
    expect(outcome.unsent).toBeUndefined();
    expect(fake.texts()).toEqual(["Доброе утро!"]);
  });

  it("сеть лежит дольше повторов очереди — `unsent: later` (итог повторит хранилище итогов)", async () => {
    const { fake, settled } = setup();
    for (let i = 0; i < 5; i++) fake.failures.send.push(new MessengerApiError("vk: сбой запроса к API: ETIMEDOUT", 0));
    const outcome = await settled(streamOf(textAnswer("Доброе утро!")));
    expect(outcome.status).toBe("finished");
    expect(outcome.unsent).toBe("later");
    expect(fake.texts()).toEqual([]);
  });

  it("мессенджер отказал насовсем (4xx) — `unsent: never`", async () => {
    const { fake, settled } = setup();
    fake.failures.send.push(new MessengerApiError("vk: ошибка 100: One of the parameters specified was missing or invalid", 400));
    fake.failures.send.push(new MessengerApiError("vk: ошибка 100: One of the parameters specified was missing or invalid", 400));
    const outcome = await settled(streamOf(textAnswer("Доброе утро!")));
    expect(outcome.unsent).toBe("never");
  });

  it("`holdText`: ни черновика, ни правок по ходу — только итог, уже после сброса шага", async () => {
    const { fake, settled } = setup({ liveText: "edit" });
    const draft = "Пpивет! Это черновик ответа, который проверка перепишет целиком и полностью.";
    const chunks: AnswerChunk[] = [
      { type: "start", messageId: "answer-2" },
      { type: "start-step" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: draft },
      { type: "text-end", id: "t1" },
      { type: "finish-step" },
      // Проверка ответа заменила текст: шаг стёрт и прислан заново (`web: "replace"`).
      { type: "data-step-reset" },
      { type: "start-step" },
      { type: "text-start", id: "t2" },
      { type: "text-delta", id: "t2", delta: "Привет! Это проверенный ответ." },
      { type: "text-end", id: "t2" },
      { type: "finish-step" },
      { type: "finish" },
    ];
    const outcome = await settled(streamOf(chunks), { holdText: true });
    expect(fake.drafts).toEqual([]);
    expect(fake.edits).toEqual([]);
    expect(fake.texts()).toEqual(["Привет! Это проверенный ответ."]);
    expect(outcome.text).toBe("Привет! Это проверенный ответ.");
  });

  it("сброс двух шагов подряд стирает оба: текст до инструмента и после", async () => {
    const { fake, settled } = setup();
    const chunks: AnswerChunk[] = [
      { type: "start", messageId: "answer-3" },
      { type: "start-step" },
      { type: "text-start", id: "a" },
      { type: "text-delta", id: "a", delta: "Сначала." },
      { type: "text-end", id: "a" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-start", id: "b" },
      { type: "text-delta", id: "b", delta: "Пpовeрка." },
      { type: "text-end", id: "b" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "finish-step" },
      { type: "data-step-reset" },
      { type: "data-step-reset" },
      { type: "start-step" },
      { type: "text-start", id: "c" },
      { type: "text-delta", id: "c", delta: "Проверка." },
      { type: "text-end", id: "c" },
      { type: "finish-step" },
      { type: "finish" },
    ];
    const outcome = await settled(streamOf(chunks), { holdText: true });
    expect(outcome.text).toBe("Сначала.\n\nПроверка.");
    expect(fake.texts()).toEqual(["Сначала.\n\nПроверка."]);
  });
});
