import { parseCommand } from "../bot-commands";
import type { ExternalAccount, ExternalChat, InboundFile, InboundUpdate } from "../messenger-adapter";

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TelegramChat {
  id: number;
  type: string;
}
interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
}
interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}
interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  entities?: TelegramEntity[];
  caption_entities?: TelegramEntity[];
  reply_to_message?: { from?: TelegramUser };
  voice?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: TelegramPhotoSize[];
}
interface TelegramChatMember {
  status: string;
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: { id: string; from: TelegramUser; data?: string; message?: { chat: TelegramChat } };
  my_chat_member?: { chat: TelegramChat; from: TelegramUser; old_chat_member: TelegramChatMember; new_chat_member: TelegramChatMember };
}

export interface TelegramBotIdentity {
  botId: string;
  username: string;
}

const GONE_STATUSES = new Set(["left", "kicked"]);

function chatOf(chat: TelegramChat): ExternalChat | null {
  if (chat.type === "private") return { id: String(chat.id), type: "private" };
  if (chat.type === "group" || chat.type === "supergroup") return { id: String(chat.id), type: "group" };
  return null;
}

function accountOf(user: TelegramUser, bot: TelegramBotIdentity): ExternalAccount {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username || String(user.id);
  return { messenger: "telegram", botId: bot.botId, externalUserId: String(user.id), name, ...(user.username && { username: user.username }) };
}

/** Убирает `@бот` из текста группового сообщения; находит его по `entities`, а не по тексту. */
function withoutMention(text: string, entities: TelegramEntity[], username: string): { text: string; mentioned: boolean } {
  const mention = `@${username}`.toLowerCase();
  const own = entities.filter((entity) => entity.type === "mention" && text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === mention);
  let result = text;
  for (const entity of [...own].sort((a, b) => b.offset - a.offset)) {
    result = result.slice(0, entity.offset) + result.slice(entity.offset + entity.length).replace(/^\s+/, "");
  }
  return { text: result.trim(), mentioned: own.length > 0 };
}

function largest(sizes: TelegramPhotoSize[]): TelegramPhotoSize | undefined {
  return [...sizes].sort((a, b) => b.width * b.height - a.width * a.height || (b.file_size ?? 0) - (a.file_size ?? 0))[0];
}

function filesOf(message: TelegramMessage): InboundFile[] {
  const { voice, audio, document, photo } = message;
  if (voice) return [{ fileId: voice.file_id, name: "voice.ogg", mediaType: voice.mime_type ?? "audio/ogg", ...(voice.file_size !== undefined && { size: voice.file_size }), ...(voice.duration !== undefined && { durationMs: voice.duration * 1000 }) }];
  if (document) return [{ fileId: document.file_id, ...(document.file_name && { name: document.file_name }), ...(document.mime_type && { mediaType: document.mime_type }), ...(document.file_size !== undefined && { size: document.file_size }) }];
  if (audio) return [{ fileId: audio.file_id, ...(audio.file_name && { name: audio.file_name }), ...(audio.mime_type && { mediaType: audio.mime_type }), ...(audio.file_size !== undefined && { size: audio.file_size }) }];
  const biggest = photo && largest(photo);
  if (biggest) return [{ fileId: biggest.file_id, name: "photo.jpg", mediaType: "image/jpeg", ...(biggest.file_size !== undefined && { size: biggest.file_size }) }];
  return [];
}

function fromMessage(message: TelegramMessage, key: string, bot: TelegramBotIdentity): InboundUpdate[] {
  if (!message.from || message.from.is_bot) return [];
  const chat = chatOf(message.chat);
  if (!chat) return [];
  const account = accountOf(message.from, bot);
  const raw = message.text ?? message.caption ?? "";
  const entities = (message.text !== undefined ? message.entities : message.caption_entities) ?? [];
  const replyTo = message.reply_to_message?.from;
  const replyToBot = replyTo !== undefined && (String(replyTo.id) === bot.botId || (replyTo.is_bot === true && replyTo.username?.toLowerCase() === bot.username.toLowerCase()));
  const mention = chat.type === "group" ? withoutMention(raw, entities, bot.username) : { text: raw.trim(), mentioned: false };
  const group = chat.type === "group" ? { group: { mentioned: mention.mentioned, replyToBot } } : {};
  const base = { key, account, chat, ...group };
  const files = filesOf(message);

  if (message.voice) return [{ ...base, kind: "voice", files }];
  if (files.length > 0) return [{ ...base, kind: "files", ...(mention.text && { text: mention.text }), files }];
  if (!mention.text) return [];

  const command = parseCommand(mention.text);
  if (command?.name === "start" && chat.type === "private") return [{ ...base, kind: "start", text: mention.text, ...(command.args && { startPayload: command.args.split(/\s+/)[0] }) }];
  if (command) return [{ ...base, kind: "command", text: mention.text }];
  return [{ ...base, kind: "text", text: mention.text }];
}

function fromMembership(change: NonNullable<TelegramUpdate["my_chat_member"]>, key: string, bot: TelegramBotIdentity): InboundUpdate[] {
  const chat = chatOf(change.chat);
  if (!chat) return [];
  const account = accountOf(change.from, bot);
  const wasGone = GONE_STATUSES.has(change.old_chat_member.status);
  const isGone = GONE_STATUSES.has(change.new_chat_member.status);
  if (wasGone === isGone) return [];
  if (chat.type === "private") return [{ key, account, chat, kind: isGone ? "blocked" : "allowed" }];
  return [{ key, account, chat, kind: isGone ? "bot_removed" : "bot_added" }];
}

/** Обновление Telegram → обновления общего вида (0 — боту не нужно, 1 — обычно). */
export function toInboundUpdates(update: TelegramUpdate, bot: TelegramBotIdentity): InboundUpdate[] {
  const key = `telegram:${bot.botId}:${update.update_id}`;
  if (update.message) return fromMessage(update.message, key, bot);
  if (update.my_chat_member) return fromMembership(update.my_chat_member, key, bot);
  const press = update.callback_query;
  if (press?.data !== undefined && press.message) {
    const chat = chatOf(press.message.chat);
    if (!chat) return [];
    return [{ key, account: accountOf(press.from, bot), chat, kind: "button", buttonId: press.data, callbackId: press.id }];
  }
  return [];
}
