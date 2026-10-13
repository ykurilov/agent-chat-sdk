import { parseCommand } from "../bot-commands";
import type { ExternalAccount, ExternalChat, InboundFile, InboundUpdate } from "../messenger-adapter";
import { mediaTypeOfFileName } from "../messenger-files";

interface MaxUser {
  user_id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}
interface MaxRecipient {
  chat_id?: number;
  chat_type?: string;
}
interface MaxAttachment {
  type: string;
  payload?: { url?: string; transcription?: string };
  filename?: string;
  size?: number;
}
interface MaxMessage {
  sender?: MaxUser;
  recipient?: MaxRecipient;
  body?: { mid?: string; text?: string | null; attachments?: MaxAttachment[] | null };
  link?: { type?: string; sender?: MaxUser };
}
export interface MaxUpdate {
  update_type: string;
  timestamp?: number;
  message?: MaxMessage;
  callback?: { callback_id: string; payload?: string; user: MaxUser };
  chat_id?: number;
  user?: MaxUser;
  payload?: string;
  is_channel?: boolean;
}

export interface MaxBotIdentity {
  botName: string;
}

function chatOf(recipient: MaxRecipient | undefined): ExternalChat | null {
  if (recipient?.chat_id === undefined) return null;
  if (recipient.chat_type === "dialog") return { id: String(recipient.chat_id), type: "private" };
  if (recipient.chat_type === "chat") return { id: String(recipient.chat_id), type: "group" };
  return null;
}

function accountOf(user: MaxUser, bot: MaxBotIdentity): ExternalAccount {
  const name = user.name?.trim() || [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username || String(user.user_id);
  return { messenger: "max", botId: bot.botName, externalUserId: String(user.user_id), name, ...(user.username && { username: user.username }) };
}

function filesOf(attachments: MaxAttachment[]): { files: InboundFile[]; voice: boolean; transcription?: string } {
  const files: InboundFile[] = [];
  let voice = false;
  let transcription: string | undefined;
  for (const attachment of attachments) {
    const url = attachment.payload?.url;
    if (!url) continue;
    if (attachment.type === "audio") {
      voice = true;
      const text = attachment.payload?.transcription?.trim();
      if (text) transcription = text;
      files.push({ fileId: url });
    } else if (attachment.type === "image") {
      files.push({ fileId: url, name: "photo.jpg", mediaType: "image/jpeg" });
    } else if (attachment.type === "file") {
      const mediaType = mediaTypeOfFileName(attachment.filename);
      files.push({ fileId: url, ...(attachment.filename && { name: attachment.filename }), ...(mediaType && { mediaType }), ...(attachment.size !== undefined && { size: attachment.size }) });
    }
  }
  return { files, voice, ...(transcription && { transcription }) };
}

function fromMessage(message: MaxMessage, bot: MaxBotIdentity): InboundUpdate[] {
  const mid = message.body?.mid;
  const chat = chatOf(message.recipient);
  if (!message.sender || message.sender.is_bot || !chat || !mid) return [];
  const key = `max:${bot.botName}:${mid}`;
  const account = accountOf(message.sender, bot);
  const raw = message.body?.text ?? "";
  const mention = new RegExp(`@${bot.botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])\\s*`, "gi");
  const mentioned = chat.type === "group" && new RegExp(mention.source, "i").test(raw);
  const text = (chat.type === "group" ? raw.replace(mention, "") : raw).trim();
  const link = message.link;
  const replyToBot = link?.type === "reply" && link.sender?.is_bot === true && (!link.sender.username || link.sender.username.toLowerCase() === bot.botName.toLowerCase());
  const group = chat.type === "group" ? { group: { mentioned, replyToBot } } : {};
  const { files, voice, transcription } = filesOf(message.body?.attachments ?? []);

  if (voice) return [{ key, account, chat, kind: "voice", files, ...(transcription && { transcription }), ...group }];
  if (files.length > 0) return [{ key, account, chat, kind: "files", ...(text && { text }), files, ...group }];
  if (!text) return [];
  return [{ key, account, chat, kind: parseCommand(text) ? "command" : "text", text, ...group }];
}

/** Обновление MAX → обновления общего вида (0 — боту не нужно). */
export function toInboundUpdates(update: MaxUpdate, bot: MaxBotIdentity): InboundUpdate[] {
  // У событий бота нет своего номера: одного вида в одну секунду бывает несколько — в разных чатах и от разных людей.
  const stamp = `${update.update_type}:${update.timestamp ?? ""}:${update.chat_id ?? ""}:${update.user?.user_id ?? ""}`;
  switch (update.update_type) {
    case "message_created":
      return update.message ? fromMessage(update.message, bot) : [];
    case "message_callback": {
      const { callback, message } = update;
      const chat = chatOf(message?.recipient);
      if (!callback || callback.payload === undefined || !chat) return [];
      return [{ key: `max:${bot.botName}:${callback.callback_id}`, account: accountOf(callback.user, bot), chat, kind: "button", buttonId: callback.payload, callbackId: callback.callback_id }];
    }
    case "bot_started":
    case "bot_stopped": {
      if (update.chat_id === undefined || !update.user) return [];
      const base = { key: `max:${bot.botName}:${stamp}`, account: accountOf(update.user, bot), chat: { id: String(update.chat_id), type: "private" as const } };
      if (update.update_type === "bot_stopped") return [{ ...base, kind: "blocked" }];
      return [{ ...base, kind: "start", ...(update.payload && { startPayload: update.payload }) }];
    }
    case "bot_added":
    case "bot_removed": {
      if (update.chat_id === undefined || !update.user || update.is_channel) return [];
      return [{ key: `max:${bot.botName}:${stamp}`, account: accountOf(update.user, bot), chat: { id: String(update.chat_id), type: "group" }, kind: update.update_type }];
    }
    default:
      return [];
  }
}
