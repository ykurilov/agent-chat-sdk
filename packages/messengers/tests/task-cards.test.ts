import type { ChatEvent } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createButtonActions } from "../src/button-actions";
import type { MessengerTaskView } from "../src/chat-port";
import { messengerTexts } from "../src/messenger-texts";
import { createOutboundQueue } from "../src/outbound-queue";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import { createTaskCards } from "../src/task-cards";
import type { ConversationKey, MessengerConversation } from "../src/types";
import { createFakeAdapter } from "./support/fake-adapter";
import { createFakeChatService } from "./support/fake-chat-service";

const key: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: "100" };

function paused(approvalId = "ap-1"): MessengerTaskView {
  return { id: "task-1", title: "Чистка папки", status: "awaiting_approval", progress: { pendingApproval: { approvalId, toolName: "remove", title: "Удалить /tmp/a.txt" } } };
}

async function setup(conversation: Partial<MessengerConversation> = {}) {
  const store = createMemoryMessengerStore();
  const chats = createFakeChatService();
  const fake = createFakeAdapter();
  const errors: unknown[] = [];
  const cards = createTaskCards({
    store,
    service: chats.service,
    bots: [fake.bot()],
    queueFor: () => createOutboundQueue({ retryDelayMs: 0 }),
    buttons: createButtonActions({ store, service: chats.service }),
    logError: (error) => errors.push(error),
  });
  const chatId = chats.addChat("anna", "Разговор", "telegram");
  const at = new Date().toISOString();
  await store.saveConversation({ ...key, type: "private", userId: "anna", currentChatId: chatId, blocked: false, active: true, createdAt: at, updatedAt: at, ...conversation });
  const changed = (ownerId = "anna"): ChatEvent => ({ type: "tasks-changed", ownerId, chatId });
  return { store, chats, fake, errors, cards, chatId, changed };
}

describe("карточка паузы фоновой задачи в мессенджер", () => {
  it("задача ждёт разрешения — карточка «Разрешить / Запретить» в разговор этого чата; кнопки отвечают задаче", async () => {
    const { chats, fake, cards, chatId, changed, store, errors } = await setup();
    chats.setTasks(chatId, [paused(), { id: "task-2", title: "Отчёт", status: "done" }]);
    await cards.handle(changed());

    expect(fake.sent).toHaveLength(1);
    const [card] = fake.sent;
    expect(card?.chat).toEqual({ id: "100", type: "private" });
    expect(card?.message.text).toBe(messengerTexts.taskApprovalQuestion("Чистка папки", "Удалить /tmp/a.txt"));
    const buttons = card?.message.buttons?.flat() ?? [];
    expect(buttons.map((button) => button.text)).toEqual([messengerTexts.allow, messengerTexts.deny]);
    const now = new Date().toISOString();
    expect(await store.takeButton(key, buttons[0]?.id ?? "", now)).toMatchObject({ type: "task_approval", chatId, taskId: "task-1", approvalId: "ap-1", decision: "allow" });
    expect(await store.takeButton(key, buttons[1]?.id ?? "", now)).toMatchObject({ type: "task_approval", chatId, taskId: "task-1", approvalId: "ap-1", decision: "deny" });
    expect(errors).toEqual([]);
  });

  it("одно подтверждение — одна карточка, сколько бы раз задачи ни менялись; новое подтверждение — новая карточка", async () => {
    const { chats, fake, cards, chatId, changed } = await setup();
    chats.setTasks(chatId, [paused("ap-1")]);
    await Promise.all([cards.handle(changed()), cards.handle(changed())]);
    await cards.handle(changed());
    expect(fake.sent).toHaveLength(1);
    chats.setTasks(chatId, [paused("ap-2")]);
    await cards.handle(changed());
    expect(fake.sent).toHaveLength(2);
  });

  it("без названия действия — имя инструмента", async () => {
    const { chats, fake, cards, chatId, changed } = await setup();
    chats.setTasks(chatId, [{ ...paused(), progress: { pendingApproval: { approvalId: "ap-1", toolName: "remove" } } }]);
    await cards.handle(changed());
    expect(fake.sent[0]?.message.text).toBe(messengerTexts.taskApprovalQuestion("Чистка папки", "remove"));
  });

  it("разговор выключен, заблокирован или чужой — карточки нет", async () => {
    for (const conversation of [{ active: false }, { blocked: true }, { userId: "boris" }]) {
      const { chats, fake, cards, chatId, changed } = await setup(conversation);
      chats.setTasks(chatId, [paused()]);
      await cards.handle(changed());
      expect(fake.sent).toEqual([]);
    }
  });

  it("чат без разговора в мессенджере и служба без списка задач — ни запросов, ни карточек", async () => {
    const { chats, fake, cards, changed } = await setup();
    const list = vi.spyOn(chats.service.tasks, "list");
    const webChat = chats.addChat("anna", "Из веба");
    chats.setTasks(webChat, [paused()]);
    await cards.handle({ type: "tasks-changed", ownerId: "anna", chatId: webChat });
    expect(list).not.toHaveBeenCalled();
    expect(fake.sent).toEqual([]);

    const store = createMemoryMessengerStore();
    const bare = createTaskCards({ store, service: {}, bots: [], queueFor: () => createOutboundQueue({ retryDelayMs: 0 }), buttons: createButtonActions({ store, service: chats.service }) });
    await expect(bare.handle(changed())).resolves.toBeUndefined();
  });

  it("задача идёт или ждёт очереди — карточка «Отменить задачу», одна на задачу; кнопка отменяет задачу", async () => {
    const { chats, fake, cards, chatId, changed, store, errors } = await setup();
    chats.setTasks(chatId, [
      { id: "task-2", title: "Отчёт", status: "running" },
      { id: "task-3", title: "Сводка", status: "queued" },
      { id: "task-4", title: "Готовое", status: "done" },
    ]);
    await Promise.all([cards.handle(changed()), cards.handle(changed())]);
    await cards.handle(changed());

    expect(fake.sent.map((item) => item.message.text)).toEqual([messengerTexts.taskRunning("Отчёт"), messengerTexts.taskRunning("Сводка")]);
    const button = fake.sent[0]?.message.buttons?.flat() ?? [];
    expect(button.map((item) => item.text)).toEqual([messengerTexts.cancelTask]);
    expect(await store.takeButton(key, button[0]?.id ?? "", new Date().toISOString())).toMatchObject({ type: "task_cancel", chatId, taskId: "task-2" });
    expect(errors).toEqual([]);
  });

  it("ждущая разрешения задача — только карточка паузы, без второй карточки отмены", async () => {
    const { chats, fake, cards, chatId, changed } = await setup();
    chats.setTasks(chatId, [paused()]);
    await cards.handle(changed());
    expect(fake.sent.map((item) => item.message.text)).toEqual([messengerTexts.taskApprovalQuestion("Чистка папки", "Удалить /tmp/a.txt")]);
  });
});
