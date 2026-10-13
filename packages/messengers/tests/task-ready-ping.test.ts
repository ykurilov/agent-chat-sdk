import type { ChatEvent } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createButtonActions } from "../src/button-actions";
import { messengerTexts } from "../src/messenger-texts";
import { createOutboundQueue } from "../src/outbound-queue";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import { createTaskReadyPing } from "../src/task-ready-ping";
import { createFakeAdapter } from "./support/fake-adapter";
import { createFakeChatService } from "./support/fake-chat-service";

function setup(options: { taskReadyPing?: boolean; webChatUrl?: (chatId: string) => string; linked?: boolean } = {}) {
  const store = createMemoryMessengerStore();
  const chats = createFakeChatService();
  const { service } = chats;
  const fake = createFakeAdapter();
  const errors: unknown[] = [];
  const ping = createTaskReadyPing({
    store,
    service,
    bots: [fake.bot()],
    queue: createOutboundQueue({ retryDelayMs: 0 }),
    buttons: createButtonActions({ store, service }),
    ...(options.taskReadyPing !== undefined && { taskReadyPing: options.taskReadyPing }),
    ...(options.webChatUrl !== undefined && { webChatUrl: options.webChatUrl }),
    logError: (error) => errors.push(error),
  });
  const chatId = chats.addChat("anna", "Разговор о продажах");
  chats.addNotices(chatId, [{ kind: "task_done", taskId: "t1", title: "Отчёт по сделкам", result: "Готово: 12 сделок" }]);
  const link = () => store.saveLink({ messenger: "telegram", botId: "bot1", externalUserId: "100", userId: "anna", name: "Анна", linkedAt: new Date().toISOString() });
  const finished = (overrides: Partial<Extract<ChatEvent, { type: "turn-finished" }>> = {}): ChatEvent => ({
    type: "turn-finished",
    ownerId: "anna",
    chatId,
    messageId: "msg-1",
    status: "complete",
    trigger: "notice",
    channel: "web",
    ...overrides,
  });
  return { store, service: chats, fake, errors, ping, chatId, link, finished };
}

describe("«Задача готова» при закрытой вкладке", () => {
  it("по умолчанию включено: ход после задачи в веб-чате, вкладка закрыта — сообщение с кнопкой «Открыть чат»", async () => {
    const { ping, fake, link, finished, store, chatId } = setup({ webChatUrl: (id) => `https://app.example/chat/${id}` });
    await link();
    await ping.handle(finished());
    expect(fake.sent).toHaveLength(1);
    const [message] = fake.sent;
    expect(message?.chat).toEqual({ id: "100", type: "private" });
    expect(message?.message.text).toBe(messengerTexts.taskReady("Отчёт по сделкам"));
    expect(message?.message.buttons?.flat().map((button) => button.text)).toEqual([messengerTexts.openChat]);
    const buttonId = message?.message.buttons?.[0]?.[0]?.id ?? "";
    expect((await store.takeButton({ messenger: "telegram", botId: "bot1", externalChatId: "100" }, buttonId, new Date().toISOString())) ?? {}).toMatchObject({
      type: "open_link",
      url: `https://app.example/chat/${chatId}`,
    });
  });

  it("без webChatUrl — без кнопки; у задачи нет названия — «Задача готова»", async () => {
    const { ping, fake, link, finished, service } = setup();
    await link();
    const untitled = service.addChat("anna", null);
    service.addNotices(untitled, [{ kind: "task_failed", taskId: "t2", title: " ", error: "сбой" }]);
    await ping.handle(finished({ chatId: untitled }));
    expect(fake.sent.map((item) => [item.message.text, item.message.buttons])).toEqual([[messengerTexts.taskReadyUntitled, undefined]]);
  });

  it("название — из служебного сообщения задачи, несколько задач — через запятую", async () => {
    const { ping, fake, link, finished, service } = setup();
    await link();
    const twoTasks = service.addChat("anna", "Чат");
    service.addNotices(twoTasks, [
      { kind: "task_done", taskId: "a", title: "Отчёт" },
      { kind: "task_timed_out", taskId: "b", title: "Сводка" },
    ]);
    await ping.handle(finished({ chatId: twoTasks }));
    expect(fake.sent.map((item) => item.message.text)).toEqual([messengerTexts.taskReady("Отчёт, Сводка")]);
  });

  it("личный чат берётся из разговора с ботом (у MAX его номер не совпадает с номером человека), не из группы", async () => {
    const { ping, fake, link, finished, store } = setup();
    await link();
    const now = new Date().toISOString();
    const base = { messenger: "telegram" as const, botId: "bot1", userId: "anna", blocked: false, active: true, createdAt: now, updatedAt: now };
    await store.saveConversation({ ...base, externalChatId: "-500", type: "group" });
    await store.saveConversation({ ...base, externalChatId: "9100", type: "private" });
    await ping.handle(finished());
    expect(fake.sent.map((item) => item.chat)).toEqual([{ id: "9100", type: "private" }]);
  });

  it("ход не по задаче (агент пишет первым) и чат, который ведёт сам мессенджер, — ничего", async () => {
    const { ping, fake, link, finished, service, store } = setup();
    await link();
    const started = service.addChat("anna", "Урок");
    service.addNotices(started, [{ kind: "conversation_started", title: "Начни урок" }]);
    await ping.handle(finished({ chatId: started }));

    const followed = service.addChat("anna", "Из Telegram", "telegram");
    service.addNotices(followed, [{ kind: "task_done", taskId: "t3", title: "Отчёт" }]);
    const now = new Date().toISOString();
    await store.saveConversation({ messenger: "telegram", botId: "bot1", externalChatId: "100", type: "private", userId: "anna", currentChatId: followed, blocked: false, active: true, createdAt: now, updatedAt: now });
    await ping.handle(finished({ chatId: followed }));
    expect(fake.sent).toEqual([]);
  });

  it("вкладка открыта, ход человека, ход в мессенджере или аккаунт не привязан — ничего", async () => {
    const { ping, fake, link, finished, service, chatId } = setup();
    await ping.handle(finished());
    await link();
    await ping.handle(finished({ trigger: "human" }));
    await ping.handle(finished({ channel: "telegram" }));
    await ping.handle({ type: "turn-started", ownerId: "anna", chatId, messageId: "m", trigger: "notice", channel: "web" });
    service.watch("anna", chatId);
    await ping.handle(finished());
    expect(fake.sent).toEqual([]);
  });

  it("taskReadyPing: false — ничего не шлёт", async () => {
    const { ping, fake, link, finished } = setup({ taskReadyPing: false });
    await link();
    await ping.handle(finished());
    expect(fake.sent).toEqual([]);
  });

  it("повтор того же события — одно сообщение; человек заблокировал бота — ничего; сбой отправки — в журнал", async () => {
    const repeated = setup();
    await repeated.link();
    await Promise.all([repeated.ping.handle(repeated.finished()), repeated.ping.handle(repeated.finished())]);
    expect(repeated.fake.sent).toHaveLength(1);

    const blocked = setup();
    await blocked.link();
    const now = new Date().toISOString();
    await blocked.store.saveConversation({ messenger: "telegram", botId: "bot1", externalChatId: "100", type: "private", userId: "anna", blocked: true, active: true, createdAt: now, updatedAt: now });
    await blocked.ping.handle(blocked.finished());
    expect(blocked.fake.sent).toEqual([]);

    const broken = setup();
    await broken.link();
    broken.fake.failures.send.push(new Error("network"), new Error("network"), new Error("network"), new Error("network"));
    await broken.ping.handle(broken.finished());
    expect(broken.errors.length).toBeGreaterThan(0);
  });
});
