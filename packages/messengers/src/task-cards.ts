import type { ChatEvent } from "@ykurilov/agent-chat-core";
import type { ButtonActions, CardButton } from "./button-actions";
import type { MessengerChatService, MessengerTaskView } from "./chat-port";
import type { ExternalChat } from "./messenger-adapter";
import { defaultTextsOf, type MessengerTexts, type MessengerTextsOf } from "./messenger-texts";
import { chatKeyOf, type OutboundQueue } from "./outbound-queue";
import { durableDelivery } from "./pending-deliveries";
import type { ConversationKey, MessengerBot, MessengerConversation, MessengerStore } from "./types";

/**
 * Карточки фоновых задач в разговор мессенджера, который ведёт чат задачи. Задача ждёт очереди или идёт — «Отменить
 * задачу»; помощнику в задаче нужно разрешение (FR-032) — «Разрешить / Запретить». Служебное сообщение о паузе тихое и
 * хода не начинает, поэтому карточки шлёт не печать ответа, а событие `tasks-changed`: статус задачи записан до него.
 * Одна задача — одна карточка отмены, одно подтверждение — одна карточка паузы (отметка в базе: копии сервера и повторы
 * события не шлют вторую).
 */
export function createTaskCards(options: {
  store: MessengerStore;
  service: Pick<MessengerChatService, "tasks">;
  bots: readonly MessengerBot[];
  queueFor(bot: MessengerBot): OutboundQueue;
  buttons: Pick<ButtonActions, "prepare">;
  textsOf?: MessengerTextsOf;
  logError?(error: unknown): void;
}) {
  const { store, service, buttons } = options;
  const textsOf = options.textsOf ?? defaultTextsOf;
  const logError = (error: unknown) => options.logError?.(error);

  async function handle(event: ChatEvent): Promise<void> {
    const list = service.tasks?.list;
    if (event.type !== "tasks-changed" || !list) return;
    try {
      const conversations = (await store.listConversationsOfChat(event.chatId)).filter(
        (conversation) => conversation.active && !conversation.blocked && conversation.userId === event.ownerId,
      );
      if (conversations.length === 0) return;
      for (const task of await list(event.ownerId, event.chatId)) {
        for (const conversation of conversations) {
          const card = cardOf(event.chatId, task, textsOf(conversation));
          // Пустая фраза карточки — карточку не шлём.
          if (card?.text) await sendCard(conversation, card);
        }
      }
    } catch (error) {
      logError(error);
    }
  }

  function cardOf(chatId: string, task: MessengerTaskView, texts: MessengerTexts): { mark: string; text: string; rows: CardButton[][] } | undefined {
    const approval = task.progress?.pendingApproval;
    if (task.status === "awaiting_approval" && approval) {
      const button = (text: string, decision: "allow" | "deny"): CardButton => ({
        text,
        action: { type: "task_approval", chatId, taskId: task.id, approvalId: approval.approvalId, decision },
      });
      return {
        mark: `task-card:${approval.approvalId}`,
        text: texts.taskApprovalQuestion(task.title, approval.title ?? approval.toolName),
        rows: [[button(texts.allow, "allow"), button(texts.deny, "deny")]],
      };
    }
    if (task.status === "queued" || task.status === "running") {
      return {
        mark: `task-cancel-card:${task.id}`,
        text: texts.taskRunning(task.title),
        rows: [[{ text: texts.cancelTask, action: { type: "task_cancel", chatId, taskId: task.id } }]],
      };
    }
    return undefined;
  }

  async function sendCard(conversation: MessengerConversation, card: { mark: string; text: string; rows: CardButton[][] }): Promise<void> {
    const bot = options.bots.find((item) => item.messenger === conversation.messenger && item.botId === conversation.botId);
    if (!bot) return;
    const key: ConversationKey = { messenger: conversation.messenger, botId: conversation.botId, externalChatId: conversation.externalChatId };
    const mark = `${card.mark}:${conversation.messenger}:${conversation.botId}:${conversation.externalChatId}`;
    if (!(await store.claimUpdate(mark, new Date().toISOString()))) return;
    const prepared = buttons.prepare(key, card.rows);
    const message = { text: card.text, markup: "plain" as const, buttons: prepared.buttons };
    const chat: ExternalChat = { id: conversation.externalChatId, type: conversation.type };
    try {
      await options.queueFor(bot).run(
        chatKeyOf(key),
        async () => {
          const sent = await bot.adapter.send(chat, message);
          await prepared.save(sent, message);
          return sent;
        },
        { durable: durableDelivery(key, () => ({ chat, message, rows: prepared.rows })) },
      );
      await store.finishUpdate(mark, "done", new Date().toISOString());
    } catch (error) {
      await store.finishUpdate(mark, "failed", new Date().toISOString()).catch(logError);
      throw error;
    }
  }

  return { handle };
}

export type TaskCards = ReturnType<typeof createTaskCards>;
