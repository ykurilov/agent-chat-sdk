import { describe, expect, it, vi } from "vitest";
import { createChatEvents } from "../../../src/chat-events/chat-events";
import type { ChatEvent } from "../../../src/chat-events/chat-events";
import { askInNewChat, doneNotice, noticeService, scriptedModel, waitTurn } from "../support/notice-chat";

describe("T043: события чата", () => {
  it("createChatEvents: рассылка, отписка, упавший слушатель не мешает другим", () => {
    const events = createChatEvents();
    const seen: ChatEvent[] = [];
    events.subscribe(() => {
      throw new Error("сломался");
    });
    const off = events.subscribe((event) => seen.push(event));
    const event: ChatEvent = { type: "tasks-changed", ownerId: "anna", chatId: "c" };
    events.emit(event);
    off();
    events.emit(event);
    expect(seen).toEqual([event]);
  });

  it("ход человека и ход по служебному сообщению — turn-started и turn-finished с trigger и channel", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const seen: ChatEvent[] = [];
    service.subscribeEvents((event) => seen.push(event));
    const chat = await askInNewChat(service, "привет", { channel: "telegram" });
    const delivered = await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "ок")], wakeAgent: true, deliveryKey: "k" });
    await waitTurn(service, chat.id);
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    const answers = (await service.getHistory("anna", chat.id)).messages.filter((message) => message.role === "assistant").map((message) => message.id);
    expect(seen).toEqual([
      { type: "turn-started", ownerId: "anna", chatId: chat.id, messageId: answers[0], trigger: "human", channel: "telegram" },
      { type: "turn-finished", ownerId: "anna", chatId: chat.id, messageId: answers[0], status: "complete", trigger: "human", channel: "telegram" },
      { type: "turn-started", ownerId: "anna", chatId: chat.id, messageId: answers[1], trigger: "notice", channel: "telegram" },
      { type: "turn-finished", ownerId: "anna", chatId: chat.id, messageId: answers[1], status: "complete", trigger: "notice", channel: "telegram" },
    ]);
    expect(delivered.turnStarted).toBe(true);
  });

  it("тихая доставка (без хода) — notice-added с номером сообщения; повтор того же ключа — без события", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service, "привет");
    await waitTurn(service, chat.id);
    const seen: ChatEvent[] = [];
    service.subscribeEvents((event) => seen.push(event));
    const request = { ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "ок")], wakeAgent: false, deliveryKey: "k" };
    const delivered = await service.deliverNotices(request);
    expect(delivered).toMatchObject({ status: "delivered", turnStarted: false });
    expect(seen).toEqual([{ type: "notice-added", ownerId: "anna", chatId: chat.id, messageId: delivered.status === "delivered" ? delivered.messageId : "" }]);
    await service.deliverNotices(request);
    expect(seen).toHaveLength(1);
  });

  it("свои события приложения (chatEvents) — тот же канал; tasks-changed проходит как есть", () => {
    const chatEvents = createChatEvents();
    const { service } = noticeService(scriptedModel(), { chatEvents });
    const seen: ChatEvent[] = [];
    service.subscribeEvents((event) => seen.push(event));
    chatEvents.emit({ type: "tasks-changed", ownerId: "anna", chatId: "c" });
    expect(seen).toEqual([{ type: "tasks-changed", ownerId: "anna", chatId: "c" }]);
  });
});
