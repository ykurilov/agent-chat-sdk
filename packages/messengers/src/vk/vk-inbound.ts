import { parseCommand } from "../bot-commands";
import type { ExternalAccount, ExternalChat, InboundFile, InboundUpdate } from "../messenger-adapter";
import { mediaTypeOfExtension } from "../messenger-files";

/** С этого номера `peer_id` — беседа, а не личный диалог. */
const CONVERSATION_PEER_START = 2_000_000_000;

interface VkPhotoSize {
  url: string;
  width?: number;
  height?: number;
}
interface VkAttachment {
  type: string;
  audio_message?: { link_ogg?: string; link_mp3?: string; duration?: number };
  photo?: { sizes?: VkPhotoSize[] };
  doc?: { title?: string; ext?: string; size?: number; url?: string };
}
interface VkMessage {
  peer_id: number;
  from_id: number;
  text?: string;
  ref?: string;
  payload?: string;
  reply_message?: { from_id?: number };
  attachments?: VkAttachment[];
  action?: { type: string; member_id?: number };
}
export interface VkEvent {
  type: string;
  event_id?: string;
  group_id?: number;
  secret?: string;
  object?: Record<string, unknown>;
}

export interface VkBotIdentity {
  groupId: number;
  /** Имя человека по номеру: через `users.get`, с запасным значением. */
  nameOf(userId: number): Promise<string>;
}

const chatOfPeer = (peerId: number): ExternalChat => ({ id: String(peerId), type: peerId >= CONVERSATION_PEER_START ? "group" : "private" });

function filesOf(attachments: VkAttachment[]): { files: InboundFile[]; voice: boolean } {
  const files: InboundFile[] = [];
  let voice = false;
  for (const attachment of attachments) {
    if (attachment.type === "audio_message" && attachment.audio_message) {
      const { link_ogg, link_mp3, duration } = attachment.audio_message;
      const url = link_ogg ?? link_mp3;
      if (!url) continue;
      voice = true;
      files.push({ fileId: url, name: link_ogg ? "voice.ogg" : "voice.mp3", mediaType: link_ogg ? "audio/ogg" : "audio/mpeg", ...(duration !== undefined && { durationMs: duration * 1000 }) });
    } else if (attachment.type === "photo" && attachment.photo?.sizes?.length) {
      const biggest = [...attachment.photo.sizes].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
      if (biggest) files.push({ fileId: biggest.url, name: "photo.jpg", mediaType: "image/jpeg" });
    } else if (attachment.type === "doc" && attachment.doc?.url) {
      const { url, title, ext, size } = attachment.doc;
      const mediaType = mediaTypeOfExtension(ext);
      files.push({ fileId: url, ...(title && { name: title }), ...(mediaType && { mediaType }), ...(size !== undefined && { size }) });
    }
  }
  return { files, voice };
}

function ownMention(groupId: number) {
  return new RegExp(`\\[(?:club|public)${groupId}\\|[^\\]]*\\]\\s*`, "g");
}

async function fromMessage(message: VkMessage, key: string, bot: VkBotIdentity): Promise<InboundUpdate[]> {
  const chat = chatOfPeer(message.peer_id);
  const account = async (): Promise<ExternalAccount> => ({ messenger: "vk", botId: String(bot.groupId), externalUserId: String(message.from_id), name: await bot.nameOf(message.from_id) });

  if (message.action) {
    if (message.action.member_id !== -bot.groupId) return [];
    if (message.action.type === "chat_invite_user") return [{ key, account: await account(), chat, kind: "bot_added" }];
    if (message.action.type === "chat_kick_user") return [{ key, account: await account(), chat, kind: "bot_removed" }];
    return [];
  }

  const raw = message.text ?? "";
  const mention = chat.type === "group" ? ownMention(bot.groupId) : undefined;
  const text = (mention ? raw.replace(mention, "") : raw).trim();
  const mentioned = mention !== undefined && new RegExp(mention.source).test(raw);
  const group = chat.type === "group" ? { group: { mentioned, replyToBot: message.reply_message?.from_id === -bot.groupId } } : {};
  const { files, voice } = filesOf(message.attachments ?? []);

  if (voice) return [{ key, account: await account(), chat, kind: "voice", files, ...group }];
  if (files.length > 0) return [{ key, account: await account(), chat, kind: "files", ...(text && { text }), files, ...group }];

  if (chat.type === "private") {
    if (message.ref) return [{ key, account: await account(), chat, kind: "start", startPayload: message.ref }];
    if (isStartPayload(message.payload)) return [{ key, account: await account(), chat, kind: "start" }];
  }
  if (!text) return [];
  return [{ key, account: await account(), chat, kind: parseCommand(text) ? "command" : "text", text, ...group }];
}

/** Кнопка «Начать» в личном диалоге с сообществом присылает `payload` `{"command":"start"}`. */
function isStartPayload(payload: string | undefined): boolean {
  if (!payload) return false;
  try {
    return (JSON.parse(payload) as { command?: string }).command === "start";
  } catch {
    return false;
  }
}

function buttonIdOf(payload: unknown): string | undefined {
  const data = typeof payload === "string" ? safeParse(payload) : payload;
  const id = (data as { b?: unknown } | null)?.b;
  return typeof id === "string" ? id : undefined;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Событие VK (Callback API или Long Poll) → обновления общего вида. */
export async function toInboundUpdates(event: VkEvent, bot: VkBotIdentity): Promise<InboundUpdate[]> {
  if (event.group_id !== undefined && event.group_id !== bot.groupId) return [];
  const object = event.object ?? {};
  const key = `vk:${bot.groupId}:${event.event_id ?? ""}`;
  const account = async (userId: number): Promise<ExternalAccount> => ({ messenger: "vk", botId: String(bot.groupId), externalUserId: String(userId), name: await bot.nameOf(userId) });

  switch (event.type) {
    case "message_new": {
      const message = object.message as VkMessage | undefined;
      if (!message || message.from_id < 0) return [];
      return fromMessage(message, key, bot);
    }
    case "message_event": {
      const { user_id, peer_id, payload, event_id } = object as { user_id?: number; peer_id?: number; payload?: unknown; event_id?: string };
      const buttonId = buttonIdOf(payload);
      if (user_id === undefined || peer_id === undefined || buttonId === undefined) return [];
      return [{ key, account: await account(user_id), chat: chatOfPeer(peer_id), kind: "button", buttonId, callbackId: event_id ?? event.event_id ?? "" }];
    }
    case "message_allow":
    case "message_deny": {
      const userId = (object as { user_id?: number }).user_id;
      if (userId === undefined) return [];
      return [{ key, account: await account(userId), chat: { id: String(userId), type: "private" }, kind: event.type === "message_allow" ? "allowed" : "blocked" }];
    }
    default:
      return [];
  }
}
