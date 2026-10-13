import { randomUUID } from "node:crypto";
import { commandOf } from "./bot-commands";
import type { BotCommand, ExternalAccount, InboundUpdate, MessengerAdapter } from "./messenger-adapter";
import { defaultTextsOf, type MessengerTextsOf } from "./messenger-texts";
import type { ConversationKey, MessengerConversation, MessengersChatOptions, MessengerStore } from "./types";

/** Обращений участника в час по умолчанию. */
export const DEFAULT_PER_MEMBER_HOURLY = 20;
const HOUR_MS = 60 * 60_000;
/** Отметка «участник уже предупреждён о пределе» лежит рядом с его обращениями под этим суффиксом. */
const LIMIT_WARNED_SUFFIX = ":limit-warned";

/** Что делать с обновлением из группы. `turn` — сообщение агенту от имени плательщика. */
export type GroupDecision =
  | { type: "ignore" }
  | { type: "reply"; text: string }
  | { type: "turn"; userId: string; group: { allowedTools: readonly string[]; author: string } };

const commandDescriptions = {
  connect: "Подключить бота к группе",
  disconnect: "Отключить бота",
  help: "Как со мной говорить",
  stop: "Остановить ответ",
} as const;

/**
 * Группы (решение 4): на что отвечать, `/connect` и плательщик, предел обращений участника, имя автора.
 * Настройка `groups` читается только здесь; нет её — бот в группе отвечает один раз «пишите в личные».
 */
export function createGroupChats(options: { store: MessengerStore; groups?: MessengersChatOptions["groups"]; textsOf?: MessengerTextsOf }) {
  const { store, groups } = options;
  const textsOf = options.textsOf ?? defaultTextsOf;
  const enabled = groups !== undefined;
  const allowedTools = groups?.allowedTools ?? [];
  const answerTo = groups?.answerTo ?? "mentions";
  const perMemberHourly = groups?.perMemberHourly ?? DEFAULT_PER_MEMBER_HOURLY;

  function groupCommands(): BotCommand[] {
    if (!enabled) return [];
    return (["connect", "disconnect", "help", "stop"] as const).map((command) => ({ command, description: commandDescriptions[command] }));
  }

  async function installCommands(adapter: MessengerAdapter): Promise<void> {
    if (enabled && adapter.abilities.commandsMenu) await adapter.setCommands(groupCommands(), "group");
  }

  const keyOf = (update: InboundUpdate): ConversationKey => ({ messenger: update.account.messenger, botId: update.account.botId, externalChatId: update.chat.id });

  async function linkedUserOf(account: ExternalAccount): Promise<string | undefined> {
    return account.linkedUserId ?? (await store.findLink(account.messenger, account.botId, account.externalUserId))?.userId;
  }

  async function handleUpdate(update: InboundUpdate): Promise<GroupDecision> {
    const key = keyOf(update);
    if (!enabled) return answerOnceInPrivate(key);
    const conversation = await store.getConversation(key);
    const connected = conversation?.active === true && conversation.type === "group" ? conversation : null;

    if (update.kind === "bot_added") return { type: "reply", text: textsOf(key).connectHint };
    if (update.kind === "bot_removed") {
      if (conversation) await store.setActive(key, false, new Date().toISOString());
      return { type: "ignore" };
    }
    const command = commandOf(update);
    if (command?.name === "connect") return connect(key, update.account, connected);
    if (command?.name === "disconnect") return disconnect(key, update.account, connected);
    if (command?.name === "help") return { type: "reply", text: textsOf(key).helpGroup };

    const addressed = answerTo === "all" || update.group?.mentioned === true || update.group?.replyToBot === true;
    if (!addressed) return { type: "ignore" };
    if (!connected) return { type: "reply", text: textsOf(key).connectHint };
    if (!(await withinMemberLimit(key, update.account.externalUserId))) {
      return (await warnOnce(key, update.account.externalUserId)) ? { type: "reply", text: textsOf(key).memberLimit } : { type: "ignore" };
    }
    return { type: "turn", userId: connected.userId, group: { allowedTools, author: authorNameOf(update.account) } };
  }

  /** Группы выключены: один ответ на группу, отметка — запись разговора без плательщика. */
  async function answerOnceInPrivate(key: ConversationKey): Promise<GroupDecision> {
    if (await store.getConversation(key)) return { type: "ignore" };
    const now = new Date().toISOString();
    await store.saveConversation({ ...key, type: "group", userId: "", blocked: false, active: false, createdAt: now, updatedAt: now });
    return { type: "reply", text: textsOf(key).writeInPrivate };
  }

  async function connect(key: ConversationKey, account: ExternalAccount, connected: MessengerConversation | null): Promise<GroupDecision> {
    const userId = await linkedUserOf(account);
    if (!userId) return { type: "reply", text: textsOf(key).groupNeedsLink };
    if (connected && connected.connectedBy !== userId) return { type: "reply", text: textsOf(key).groupOnlyConnector };
    const payer = groups?.payer ? await groups.payer({ messenger: key.messenger, botId: key.botId, externalChatId: key.externalChatId }, userId) : userId;
    if (payer === null) return { type: "reply", text: textsOf(key).groupRefused };
    const existing = await store.getConversation(key);
    const now = new Date().toISOString();
    await store.saveConversation({
      ...key,
      type: "group",
      userId: payer,
      connectedBy: userId,
      // Тот же плательщик — продолжаем его чат; другой — свой чат появится с первым сообщением.
      ...(existing?.currentChatId !== undefined && existing.userId === payer && { currentChatId: existing.currentChatId }),
      blocked: false,
      active: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return { type: "reply", text: payer === userId ? textsOf(key).groupConnected(account.name) : textsOf(key).groupConnectedPlain };
  }

  async function disconnect(key: ConversationKey, account: ExternalAccount, connected: MessengerConversation | null): Promise<GroupDecision> {
    if (!connected) return { type: "reply", text: textsOf(key).connectHint };
    if (connected.connectedBy !== (await linkedUserOf(account))) return { type: "reply", text: textsOf(key).groupOnlyConnector };
    await store.setActive(key, false, new Date().toISOString());
    return { type: "reply", text: textsOf(key).groupDisconnected };
  }

  /** Скользящий час: обращение засчитывается, только если предел не исчерпан. */
  async function withinMemberLimit(key: ConversationKey, externalUserId: string): Promise<boolean> {
    const now = Date.now();
    const used = await store.countMemberHits(key, externalUserId, new Date(now - HOUR_MS).toISOString());
    if (used >= perMemberHourly) return false;
    await store.addMemberHit({ ...key, id: randomUUID(), externalUserId, at: new Date(now).toISOString() });
    return true;
  }

  /** Предупреждение о пределе — одно на час, дальше молчим: иначе бот сам засоряет группу. */
  async function warnOnce(key: ConversationKey, externalUserId: string): Promise<boolean> {
    const now = Date.now();
    const marker = `${externalUserId}${LIMIT_WARNED_SUFFIX}`;
    if ((await store.countMemberHits(key, marker, new Date(now - HOUR_MS).toISOString())) > 0) return false;
    await store.addMemberHit({ ...key, id: randomUUID(), externalUserId: marker, at: new Date(now).toISOString() });
    return true;
  }

  /** Кнопки в группе (подтверждения, виджеты) нажимает только плательщик. */
  async function checkPress(key: ConversationKey, account: ExternalAccount): Promise<{ ok: true } | { ok: false; text: string }> {
    const conversation = await store.getConversation(key);
    if (!conversation?.active) return { ok: false, text: textsOf(key).connectHint };
    if ((await linkedUserOf(account)) === conversation.userId) return { ok: true };
    const payerLink = (await store.listLinks(conversation.userId)).find((link) => link.messenger === key.messenger && link.botId === key.botId);
    return { ok: false, text: textsOf(key).onlyPayer(payerLink?.name ?? textsOf(key).payerFallback) };
  }

  /** `/stop` в группе: автор текущего хода, плательщик или тот, кто подключил бота. Остальные чужой ход не обрывают. */
  async function mayStop(key: ConversationKey, account: ExternalAccount, turnAuthorId: string | undefined): Promise<boolean> {
    if (turnAuthorId !== undefined && account.externalUserId === turnAuthorId) return true;
    const conversation = await store.getConversation(key);
    const userId = await linkedUserOf(account);
    return userId !== undefined && (userId === conversation?.userId || userId === conversation?.connectedBy);
  }

  return { enabled, groupCommands, installCommands, handleUpdate, checkPress, mayStop };
}

export type GroupChats = ReturnType<typeof createGroupChats>;

/** Длиннее имя автора модели не уходит. */
const AUTHOR_NAME_LIMIT = 64;

/**
 * Имя участника группы для модели: его пишет сам человек в профиле мессенджера, поэтому — одна короткая строка без
 * переводов строк, управляющих и невидимых знаков (иначе в имя прячут «инструкции»). Пустое — номер в мессенджере.
 */
export function authorNameOf(account: Pick<ExternalAccount, "name" | "externalUserId">): string {
  const flat = account.name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!flat) return `id${account.externalUserId}`;
  const chars = Array.from(flat);
  return chars.length > AUTHOR_NAME_LIMIT ? `${chars.slice(0, AUTHOR_NAME_LIMIT - 1).join("").trimEnd()}…` : flat;
}
