import { timingSafeEqual } from "node:crypto";
import { readJsonBody } from "../bounded-body";
import type { Button, ExternalChat, InboundFile, InboundUpdate, MessengerAdapter, OutboundMessage, SentMessage } from "../messenger-adapter";
import { MessengerApiError, MessengerBlockedError, MessengerRateLimitError } from "../messenger-api";
import type { TelegramClient } from "./telegram-client";
import { type TelegramBotIdentity, type TelegramUpdate, toInboundUpdates } from "./telegram-inbound";

const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const CALLBACK_DATA_LIMIT = 64;
const ANSWER_TEXT_LIMIT = 200;
const POLL_TIMEOUT_SECONDS = 25;
const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"];

type InlineButton = { text: string; callback_data: string } | { text: string; url: string };

function keyboardOf(buttons: Button[][] | undefined): { inline_keyboard: InlineButton[][] } | undefined {
  const rows = (buttons ?? []).filter((row) => row.length > 0);
  if (rows.length === 0) return undefined;
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button): InlineButton => {
        if (button.url) return { text: button.text, url: button.url };
        if (Buffer.byteLength(button.id) > CALLBACK_DATA_LIMIT) throw new Error(`telegram: id кнопки длиннее ${CALLBACK_DATA_LIMIT} байт — Telegram такое не принимает`);
        return { text: button.text, callback_data: button.id };
      }),
    ),
  };
}

function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sentOf(chat: ExternalChat, result: { message_id: number }): SentMessage {
  return { chat, messageId: String(result.message_id) };
}

/** Telegram как `MessengerAdapter`. `webhookSecret` нет — вебхук не принимается (бот работает опросом). */
export function createTelegramAdapter(input: { client: TelegramClient; bot: TelegramBotIdentity; webhookSecret?: string }): MessengerAdapter {
  const { client, bot } = input;
  const chatId = (chat: ExternalChat) => Number(chat.id);
  const textBody = (message: OutboundMessage) => ({ text: message.text, ...(message.markup === "html" && { parse_mode: "HTML" }) });

  async function sendText(chat: ExternalChat, message: OutboundMessage): Promise<SentMessage> {
    const keyboard = keyboardOf(message.buttons);
    const result = await client.call<{ message_id: number }>("sendMessage", { chat_id: chatId(chat), ...textBody(message), ...(keyboard && { reply_markup: keyboard }) });
    return sentOf(chat, result);
  }

  async function sendPhoto(chat: ExternalChat, message: OutboundMessage & { photo: NonNullable<OutboundMessage["photo"]> }): Promise<SentMessage> {
    const photo = "url" in message.photo ? message.photo.url : { bytes: message.photo.bytes, name: message.photo.name };
    const captionFits = message.text.length <= CAPTION_LIMIT;
    const keyboard = captionFits ? keyboardOf(message.buttons) : undefined;
    const result = await client.upload<{ message_id: number }>("sendPhoto", {
      chat_id: String(chat.id),
      photo,
      ...(captionFits && message.text && { caption: message.text }),
      ...(captionFits && message.markup === "html" && { parse_mode: "HTML" }),
      ...(keyboard && { reply_markup: JSON.stringify(keyboard) }),
    });
    if (captionFits) return sentOf(chat, result);
    // Подпись не влезла: картинка сама, текст с кнопками — следом, и править потом будут его.
    return sendText(chat, { ...message, photo: undefined });
  }

  return {
    messenger: "telegram",
    abilities: { textLimit: TEXT_LIMIT, liveText: "draft", editEveryMs: 1000, markup: "html", commandsMenu: true },

    async readWebhook(request) {
      const rejected = (status: number, text: string) => ({ response: new Response(text, { status }), updates: [] as InboundUpdate[] });
      if (!input.webhookSecret || !sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), input.webhookSecret)) return rejected(403, "forbidden");
      const body = await readJsonBody(request);
      if ("error" in body) return body.error === "too_large" ? rejected(413, "payload too large") : rejected(400, "bad request");
      const update = body.json as TelegramUpdate;
      if (typeof update?.update_id !== "number") return rejected(400, "bad request");
      return { response: new Response("ok", { status: 200 }), updates: toInboundUpdates(update, bot) };
    },

    async *poll(signal) {
      try {
        await client.call("deleteWebhook", {}, signal);
        let offset = 0;
        while (!signal.aborted) {
          const updates = await client.call<TelegramUpdate[]>("getUpdates", { offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ALLOWED_UPDATES }, signal);
          for (const update of updates) {
            offset = Math.max(offset, update.update_id + 1);
            yield* toInboundUpdates(update, bot);
          }
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    },

    async send(chat, message) {
      if (message.photo) return sendPhoto(chat, { ...message, photo: message.photo });
      return sendText(chat, message);
    },

    async edit(sent, message) {
      const keyboard = keyboardOf(message.buttons);
      try {
        await client.call("editMessageText", { chat_id: Number(sent.chat.id), message_id: Number(sent.messageId), ...textBody(message), ...(keyboard && { reply_markup: keyboard }) });
      } catch (error) {
        if (error instanceof MessengerApiError && /message is not modified/i.test(error.message)) return;
        throw error;
      }
    },

    async deleteMessage(sent) {
      await client.call("deleteMessage", { chat_id: Number(sent.chat.id), message_id: Number(sent.messageId) });
    },

    async draft(chat, draftId, text) {
      await client.call("sendMessageDraft", { chat_id: chatId(chat), draft_id: draftId, text });
    },

    async answerButton(press, text) {
      await client.call("answerCallbackQuery", { callback_query_id: press.callbackId, ...(text && { text: text.slice(0, ANSWER_TEXT_LIMIT) }) });
    },

    async typing(chat) {
      await client.call("sendChatAction", { chat_id: chatId(chat), action: "typing" });
    },

    async downloadFile(file: InboundFile) {
      const info = await client.call<{ file_path?: string }>("getFile", { file_id: file.fileId });
      if (!info.file_path) throw client.api.error(400, "Telegram не отдал путь к файлу");
      const downloaded = await client.download(info.file_path);
      return {
        bytes: downloaded.bytes,
        name: file.name ?? info.file_path.split("/").pop() ?? "file",
        mediaType: file.mediaType ?? downloaded.mediaType ?? "application/octet-stream",
      };
    },

    async setCommands(commands, scope) {
      const target = { type: scope === "private" ? "all_private_chats" : "all_group_chats" };
      // Пустой список — снять меню области: Telegram покажет меню общей области, если его задали (например, в BotFather).
      if (commands.length === 0) await client.call("deleteMyCommands", { scope: target });
      else await client.call("setMyCommands", { commands, scope: target });
    },

    async sendVoice(chat, voice) {
      const audio = { bytes: voice.audio, name: "voice.ogg", mediaType: "audio/ogg" };
      try {
        const result = await client.upload<{ message_id: number }>("sendVoice", { chat_id: String(chat.id), voice: audio, duration: String(Math.round(voice.durationMs / 1000)) });
        return sentOf(chat, result);
      } catch (error) {
        // Голосовые запрещены настройками человека: тот же звук уходит файлом. Повторы и блокировку решает очередь.
        if (error instanceof MessengerRateLimitError || error instanceof MessengerBlockedError || !(error instanceof MessengerApiError) || error.status !== 400) throw error;
        const result = await client.upload<{ message_id: number }>("sendDocument", { chat_id: String(chat.id), document: audio });
        return sentOf(chat, result);
      }
    },

    linkUrl: (code) => `https://t.me/${bot.username}?start=${encodeURIComponent(code)}`,
  };
}
