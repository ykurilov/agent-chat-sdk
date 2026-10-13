import type { ChatEvent } from "@ykurilov/agent-chat-core";
import type { ButtonActions } from "./button-actions";
import type { MessengerChatService } from "./chat-port";
import { isTaskNotice, noticesOfLastTurn } from "./chat-notices";
import type { ExternalChat } from "./messenger-adapter";
import { defaultTextsOf, type MessengerTextsOf } from "./messenger-texts";
import { chatKeyOf, type OutboundQueue } from "./outbound-queue";
import { durableDelivery } from "./pending-deliveries";
import type { ConversationKey, MessengerBot, MessengersChatOptions, MessengerStore } from "./types";

/** Сколько последних ходов помнить, чтобы повтор события не дал второе сообщение. */
const SEEN_TURNS = 1000;

/**
 * «Задача готова» при закрытой вкладке (решение 21): ход после результата фоновой задачи в веб-чате закончился, вкладка
 * не открыта, у владельца привязан мессенджер — короткое сообщение с названием задачи и кнопкой «Открыть чат».
 * Чат, который ведёт сам мессенджер, и ход не по задаче (агент пишет первым) — без сообщения. Настройка
 * `taskReadyPing` читается только здесь.
 */
export function createTaskReadyPing(options: {
  store: MessengerStore;
  service: Pick<MessengerChatService, "hasWatchers" | "getHistory">;
  bots: readonly MessengerBot[];
  queue: OutboundQueue;
  buttons: Pick<ButtonActions, "prepare">;
  taskReadyPing?: MessengersChatOptions["taskReadyPing"];
  webChatUrl?: MessengersChatOptions["webChatUrl"];
  textsOf?: MessengerTextsOf;
  logError?(error: unknown): void;
}) {
  const { store, service, queue, buttons } = options;
  const textsOf = options.textsOf ?? defaultTextsOf;
  const enabled = options.taskReadyPing ?? true;
  const logError = (error: unknown) => options.logError?.(error);
  const seen = new Set<string>();

  /**
   * Личный чат с ботом, который есть у приложения: одно сообщение, а не по всем мессенджерам. Номер чата — из разговора
   * (у MAX он не совпадает с номером человека); разговора ещё нет — номер человека (у Telegram и VK это одно и то же).
   */
  async function privateChatOf(ownerId: string): Promise<{ bot: MessengerBot; chat: ExternalChat; key: ConversationKey } | null> {
    const botOf = (item: { messenger: string; botId: string }) => options.bots.find((bot) => bot.messenger === item.messenger && bot.botId === item.botId);
    const conversations = (await store.listConversationsOfUser(ownerId))
      .filter((conversation) => conversation.type === "private" && botOf(conversation))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const conversation = conversations[0];
    if (conversation) {
      if (conversation.blocked) return null;
      const chat: ExternalChat = { id: conversation.externalChatId, type: "private" };
      return { bot: botOf(conversation) as MessengerBot, chat, key: { messenger: conversation.messenger, botId: conversation.botId, externalChatId: chat.id } };
    }
    const links = await store.listLinks(ownerId);
    const link = [...links].reverse().find((item) => botOf(item));
    if (!link) return null;
    const chat: ExternalChat = { id: link.externalUserId, type: "private" };
    return { bot: botOf(link) as MessengerBot, chat, key: { messenger: link.messenger, botId: link.botId, externalChatId: chat.id } };
  }

  async function handle(event: ChatEvent): Promise<void> {
    if (!enabled || event.type !== "turn-finished" || event.trigger !== "notice" || event.channel !== "web") return;
    const turn = `${event.ownerId}/${event.chatId}/${event.messageId}`;
    if (seen.has(turn)) return;
    seen.add(turn);
    if (seen.size > SEEN_TURNS) seen.delete(seen.values().next().value as string);
    try {
      if (await service.hasWatchers(event.ownerId, event.chatId)) return;
      // Чат ведёт разговор в мессенджере: ответ туда уже напечатан.
      const followers = await store.listConversationsOfChat(event.chatId);
      if (followers.some((conversation) => conversation.active && conversation.userId === event.ownerId)) return;
      const tasks = noticesOfLastTurn((await service.getHistory(event.ownerId, event.chatId)).messages).filter(isTaskNotice);
      if (tasks.length === 0) return;
      const target = await privateChatOf(event.ownerId);
      if (!target) return;
      const { bot, chat, key } = target;
      const title = tasks
        .map((notice) => notice.title.trim())
        .filter(Boolean)
        .join(", ");
      const texts = textsOf(key);
      const text = title ? texts.taskReady(title) : texts.taskReadyUntitled;
      // Пустая фраза — сообщение «Задача готова» не шлём.
      if (!text) return;
      const prepared = options.webChatUrl ? buttons.prepare(key, [[{ text: texts.openChat, action: { type: "open_link", url: options.webChatUrl(event.chatId) } }]]) : undefined;
      const message = { text, markup: "plain" as const, ...(prepared && { buttons: prepared.buttons }) };
      await queue.run(
        chatKeyOf(key),
        async () => {
          const sent = await bot.adapter.send(chat, message);
          if (prepared) await prepared.save(sent, message);
          return sent;
        },
        { durable: durableDelivery(key, () => ({ chat, message, ...(prepared && { rows: prepared.rows }) })) },
      );
    } catch (error) {
      logError(error);
    }
  }

  return { enabled, handle };
}

export type TaskReadyPing = ReturnType<typeof createTaskReadyPing>;
