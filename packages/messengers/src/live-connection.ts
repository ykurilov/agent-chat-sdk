import type { MessengerName } from "./messenger-adapter";
import type { MessengerConversation, MessengerStore, MessengersBaseOptions } from "./types";

/**
 * Жива ли связь разговора перед отправкой, которую начал не человек (ход сервера, карточка задачи, «Задача готова»):
 * разговор не выключен, и аккаунт, через который он подключён, ещё привязан. Группа держится на привязке подключившего,
 * личка — на привязке владельца; при `resolveAccount` кто пишет в личке решает приложение, поэтому там — только `active`.
 */
export function createLiveConnection(options: { store: MessengerStore; resolveAccount?: MessengersBaseOptions["resolveAccount"] }) {
  const { store } = options;

  async function linkedOnBot(userId: string, messenger: MessengerName, botId: string): Promise<boolean> {
    return (await store.listLinks(userId)).some((link) => link.messenger === messenger && link.botId === botId);
  }

  return async function isLive(conversation: MessengerConversation): Promise<boolean> {
    if (!conversation.active) return false;
    if (conversation.type === "group") return linkedOnBot(conversation.connectedBy ?? conversation.userId, conversation.messenger, conversation.botId);
    return options.resolveAccount ? true : linkedOnBot(conversation.userId, conversation.messenger, conversation.botId);
  };
}

export type LiveConnection = ReturnType<typeof createLiveConnection>;

/**
 * Отвязка: разговоры человека в этом мессенджере выключаются — его личные чаты с ботами и группы, которые он подключил.
 * Дальше они как неподключённые: личный снова включится, когда человек привяжет аккаунт или напишет с разрешения
 * `resolveAccount`; группу заново подключают `/connect`.
 */
export async function deactivateConversationsOf(store: MessengerStore, userId: string, messenger: MessengerName): Promise<void> {
  const now = new Date().toISOString();
  for (const conversation of await store.listConversationsOfUser(userId)) {
    if (conversation.messenger !== messenger || !conversation.active) continue;
    if (conversation.type === "group" && (conversation.connectedBy ?? conversation.userId) !== userId) continue;
    await store.setActive({ messenger, botId: conversation.botId, externalChatId: conversation.externalChatId }, false, now);
  }
}
