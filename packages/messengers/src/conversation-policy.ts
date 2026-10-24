import { ActionForbiddenError, ChatCreationRefusedError, ChatNotFoundError } from "@ykurilov/agent-chat-core";
import { isLinkCode } from "./account-linking";
import { type CardButton, chatListRows } from "./button-actions";
import type { MessengerChatService } from "./chat-port";
import type { BotCommand, ExternalAccount, MessengerAdapter } from "./messenger-adapter";
import { defaultTextsOf, type MessengerTextsOf } from "./messenger-texts";
import type { ChatRequestReason, ConversationKey, MessengersBaseOptions, MessengersChatOptions, MessengerStore } from "./types";

/** Сколько последних чатов показывает `/chats`. */
export const RECENT_CHATS = 5;

/** Разговор, для которого решаем: внешний чат, кто пишет и чьим именем. */
export interface ConversationContext {
  key: ConversationKey;
  account: ExternalAccount;
  userId: string;
}

/** Что ответить человеку на команду. Нет `text` — отвечать не нужно (агент пишет первым). */
export interface PolicyReply {
  text?: string;
  rows?: CardButton[][];
}

/** Группа разговора: её границы получает и первый ход агента, начатый до сообщения группы. */
export interface ConversationGroup {
  allowedTools: readonly string[];
  author: string;
}

export interface OpenedChat {
  chatId: string;
  /** Правило приложения попросило агента написать первым, и ход начался. */
  agentStarted: boolean;
}

const commandDescriptions = {
  new: "Новый чат",
  chats: "Последние чаты",
  help: "Как со мной говорить",
  stop: "Остановить ответ",
} as const;

/**
 * Режим разговоров и правила «кто пишет» и «чат для разговора» (решения 2, 3, 18). Настройки
 * `conversations`, `resolveAccount` и `chatForConversation` читаются только здесь.
 */
export function createConversationPolicy(options: {
  store: MessengerStore;
  service: Pick<MessengerChatService, "createChat" | "listChats" | "deliverNotices" | "assertCapability">;
  conversations?: MessengersChatOptions["conversations"];
  resolveAccount?: MessengersBaseOptions["resolveAccount"];
  chatForConversation?: MessengersChatOptions["chatForConversation"];
  textsOf?: MessengerTextsOf;
  logError?(error: unknown): void;
}) {
  const { store, service } = options;
  const textsOf = options.textsOf ?? defaultTextsOf;
  const mode = options.conversations ?? "single";

  function privateCommands(): BotCommand[] {
    const names = mode === "many" ? (["new", "chats", "help", "stop"] as const) : (["help", "stop"] as const);
    return names.map((command) => ({ command, description: commandDescriptions[command] }));
  }

  function helpText(bot: { messenger: string; botId: string }): string {
    const texts = textsOf(bot);
    return mode === "many" ? texts.helpMany : texts.helpSingle;
  }

  async function installCommands(adapter: MessengerAdapter): Promise<void> {
    if (adapter.abilities.commandsMenu) await adapter.setCommands(privateCommands(), "private");
  }

  /** Кто пишет: пользователь приложения или текст отказа. По умолчанию — только привязанные аккаунты. */
  async function resolveWriter(account: ExternalAccount): Promise<{ userId: string } | { reply: string }> {
    if (options.resolveAccount) {
      const decision = await options.resolveAccount(account);
      return "userId" in decision ? { userId: decision.userId } : { reply: decision.refuse };
    }
    const userId = account.linkedUserId ?? (await store.findLink(account.messenger, account.botId, account.externalUserId))?.userId;
    return userId ? { userId } : { reply: textsOf(account).howToConnect };
  }

  /** Новый чат для разговора по правилу приложения; он становится текущим. */
  async function openChat(input: ConversationContext & { reason: ChatRequestReason; startPayload?: string; group?: ConversationGroup }): Promise<OpenedChat> {
    const { key, account, userId, reason } = input;
    const conversation = await store.getConversation(key);
    const currentChatId = conversation?.currentChatId;
    const decided = options.chatForConversation
      ? await options.chatForConversation({
          userId,
          account,
          reason,
          ...(input.startPayload !== undefined && { startPayload: input.startPayload }),
          ...(currentChatId !== undefined && { currentChatId }),
        })
      : { chatId: (await service.createChat(userId, { origin: key.messenger })).id };
    await makeCurrent(input, decided.chatId);
    const agentStarted = decided.agentStarts ? await startAgent(input, decided.chatId, decided.agentStarts) : false;
    return { chatId: decided.chatId, agentStarted };
  }

  /** Текущий чат разговора; нет — первый по правилу приложения. */
  async function currentChat(input: ConversationContext & { group?: ConversationGroup }): Promise<OpenedChat> {
    const chatId = (await store.getConversation(input.key))?.currentChatId;
    return chatId ? { chatId, agentStarted: false } : openChat({ ...input, reason: "first" });
  }

  async function makeCurrent({ key, userId }: ConversationContext, chatId: string) {
    const now = new Date().toISOString();
    if (await store.getConversation(key)) {
      await store.setCurrentChat(key, chatId, now);
      return;
    }
    await store.saveConversation({ ...key, type: "private", userId, currentChatId: chatId, blocked: false, active: true, createdAt: now, updatedAt: now });
  }

  /**
   * Агент пишет первым тем же путём, что ход после результата фона: служебное сообщение `conversation_started`. В группе
   * сообщение несёт её границы: сообщения группы в ветке ещё нет, а ответ уйдёт в группу.
   */
  async function startAgent({ key, userId, group }: ConversationContext & { group?: ConversationGroup }, chatId: string, instruction: string): Promise<boolean> {
    try {
      const result = await service.deliverNotices({
        ownerId: userId,
        chatId,
        notices: [{ kind: "conversation_started", title: instruction }],
        wakeAgent: true,
        deliveryKey: `conversation_started:${key.messenger}:${key.botId}:${key.externalChatId}:${chatId}`,
        ...(group && { channel: key.messenger, group: { allowedTools: [...group.allowedTools], author: group.author } }),
      });
      return result.turnStarted;
    } catch (error) {
      options.logError?.(error);
      return false;
    }
  }

  /** Команды режима и `/start` с меткой сценария. Не наша команда — `null`. */
  async function handleCommand(command: { name: string; args: string }, ctx: ConversationContext): Promise<PolicyReply | null> {
    const texts = textsOf(ctx.key);
    switch (command.name) {
      case "start": {
        if (!command.args) return { text: texts.hello };
        // Код привязки разбирает привязка аккаунта.
        if (isLinkCode(command.args)) return null;
        const opened = await refusedOr(openChat({ ...ctx, reason: "start_payload", startPayload: command.args }));
        if ("text" in opened) return opened;
        return opened.agentStarted ? {} : { text: texts.hello };
      }
      case "help":
        return { text: helpText(ctx.key) };
      case "new": {
        if (mode !== "many") return null;
        const opened = await refusedOr(openChat({ ...ctx, reason: "new" }));
        if ("text" in opened) return opened;
        return opened.agentStarted ? {} : { text: texts.newChat };
      }
      case "chats": {
        if (mode !== "many") return null;
        const forbidden = await chatListForbidden(ctx);
        if (forbidden) return { text: forbidden };
        const chats = (await service.listChats(ctx.userId)).slice(0, RECENT_CHATS);
        return chats.length > 0 ? { text: texts.chatsTitle, rows: chatListRows(chats, texts) } : { text: texts.noChats };
      }
      default:
        return null;
    }
  }

  /** Кнопка из `/chats`: чат становится текущим, если он этого пользователя. */
  async function selectChat(ctx: ConversationContext, chatId: string): Promise<string> {
    const forbidden = await chatListForbidden(ctx);
    if (forbidden) return forbidden;
    const texts = textsOf(ctx.key);
    const chat = (await service.listChats(ctx.userId)).find((item) => item.id === chatId);
    if (!chat) return texts.failed;
    await makeCurrent(ctx, chatId);
    return texts.chatSelected(chat.title || texts.untitledChat);
  }

  /** Приложение не дало завести чат (`beforeCreateChat`): ответ человеку — текст отказа. */
  async function refusedOr(opening: Promise<OpenedChat>): Promise<OpenedChat | { text: string }> {
    try {
      return await opening;
    } catch (error) {
      if (error instanceof ChatCreationRefusedError) return { text: error.message };
      throw error;
    }
  }

  /** Право `chatList` текущего чата закрыто — текст отказа. Текущего чата нет — спрашивать не о чем, список открыт. */
  async function chatListForbidden(ctx: ConversationContext): Promise<string | undefined> {
    const chatId = (await store.getConversation(ctx.key))?.currentChatId;
    if (!chatId || !service.assertCapability) return undefined;
    try {
      await service.assertCapability(ctx.userId, chatId, "chatList");
      return undefined;
    } catch (error) {
      if (error instanceof ActionForbiddenError) return textsOf(ctx.key).chatListForbidden;
      if (error instanceof ChatNotFoundError) return undefined;
      throw error;
    }
  }

  return { mode, privateCommands, helpText, installCommands, resolveWriter, openChat, currentChat, handleCommand, selectChat };
}

export type ConversationPolicy = ReturnType<typeof createConversationPolicy>;
