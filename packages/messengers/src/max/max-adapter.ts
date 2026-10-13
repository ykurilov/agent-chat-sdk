import { timingSafeEqual } from "node:crypto";
import { readJsonBody } from "../bounded-body";
import type { Button, ExternalChat, InboundFile, InboundUpdate, MessengerAdapter, OutboundMessage, SentMessage } from "../messenger-adapter";
import { MessengerApiError, MessengerBlockedError, MessengerRateLimitError } from "../messenger-api";
import type { MaxClient } from "./max-client";
import { type MaxBotIdentity, type MaxUpdate, toInboundUpdates } from "./max-inbound";

const TEXT_LIMIT = 4000;
const POLL_TIMEOUT_SECONDS = 30;
/** Файл после загрузки обрабатывается не сразу: сколько раз и с какими паузами спрашиваем, прежде чем сдаться. */
const NOT_READY_ATTEMPTS = 8;
const NOT_READY_PAUSE_MS = 500;
const NOT_READY_PAUSE_MAX_MS = 3000;

export const MAX_UPDATE_TYPES = ["message_created", "message_callback", "bot_started", "bot_stopped", "bot_added", "bot_removed"];

type UploadType = "image" | "file" | "audio";
type Attachment = { type: string; payload: Record<string, unknown> };

function keyboardOf(buttons: Button[][]): Attachment {
  return {
    type: "inline_keyboard",
    payload: {
      buttons: buttons
        .filter((row) => row.length > 0)
        .map((row) => row.map((button) => (button.url ? { type: "link", text: button.text, url: button.url } : { type: "callback", text: button.text, payload: button.id }))),
    },
  };
}

function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isNotReady = (error: unknown) => error instanceof MessengerApiError && /attachment\.not\.ready|attachment\.file\.not\.processed/i.test(error.message);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** MAX как `MessengerAdapter`. `webhookSecret` нет — вебхук не принимается (бот работает опросом). */
export function createMaxAdapter(input: { client: MaxClient; bot: MaxBotIdentity; webhookSecret?: string }): MessengerAdapter {
  const { client, bot } = input;

  async function upload(type: UploadType, file: { bytes: Uint8Array; name: string; mediaType?: string }): Promise<Attachment> {
    const slot = await client.call<{ url: string; token?: string }>("POST", "/uploads", { query: { type } });
    const uploaded = await client.uploadFile<{ token?: string; photos?: Record<string, { token?: string }> }>(slot.url, file);
    // Где лежит токен, зависит от вида файла: у картинок — в ответе загрузки по каждому размеру, у файлов — там же одним полем, у звука — в ответе на запрос адреса.
    const token = type === "image" ? Object.values(uploaded.photos ?? {})[0]?.token : type === "file" ? uploaded.token : slot.token;
    if (!token) throw client.api.error(200, `MAX не вернул токен загруженного файла (${type})`);
    return { type, payload: { token } };
  }

  async function uploadPhoto(photo: NonNullable<OutboundMessage["photo"]>): Promise<Attachment> {
    if ("url" in photo) {
      const downloaded = await client.download(photo.url);
      return upload("image", { bytes: downloaded.bytes, name: photo.url.split("?")[0]?.split("/").pop() || "photo", ...(downloaded.mediaType && { mediaType: downloaded.mediaType }) });
    }
    return upload("image", { bytes: photo.bytes, name: photo.name });
  }

  /** Отправка; пока MAX обрабатывает вложение, отвечает «ещё не готов» — повторяем с растущей паузой. */
  async function post(chat: ExternalChat, message: { text: string; format?: "html"; attachments: Attachment[] }): Promise<SentMessage> {
    const body = { text: message.text, ...(message.format && { format: message.format }), ...(message.attachments.length > 0 && { attachments: message.attachments }) };
    for (let attempt = 1; ; attempt++) {
      try {
        const reply = await client.call<{ message: { body: { mid: string } } }>("POST", "/messages", { query: { chat_id: chat.id }, body });
        return { chat, messageId: reply.message.body.mid };
      } catch (error) {
        if (!isNotReady(error) || attempt >= NOT_READY_ATTEMPTS) throw error;
        await sleep(Math.min(NOT_READY_PAUSE_MS * attempt, NOT_READY_PAUSE_MAX_MS));
      }
    }
  }

  return {
    messenger: "max",
    abilities: { textLimit: TEXT_LIMIT, liveText: "edit", editEveryMs: 1000, markup: "html", commandsMenu: true },

    async readWebhook(request) {
      const rejected = (status: number, text: string) => ({ response: new Response(text, { status }), updates: [] as InboundUpdate[] });
      if (!input.webhookSecret || !sameSecret(request.headers.get("x-max-bot-api-secret"), input.webhookSecret)) return rejected(403, "forbidden");
      const body = await readJsonBody(request);
      if ("error" in body) return body.error === "too_large" ? rejected(413, "payload too large") : rejected(400, "bad request");
      const update = body.json as MaxUpdate;
      if (typeof update?.update_type !== "string") return rejected(400, "bad request");
      return { response: new Response("ok", { status: 200 }), updates: toInboundUpdates(update, bot) };
    },

    async *poll(signal) {
      try {
        // Пока подписка на вебхук жива, MAX не отдаёт обновления опросом: снимаем все подписки.
        const { subscriptions } = await client.call<{ subscriptions?: Array<{ url: string }> }>("GET", "/subscriptions", { signal });
        for (const subscription of subscriptions ?? []) await client.call("DELETE", "/subscriptions", { query: { url: subscription.url }, signal });
        let marker: number | undefined;
        while (!signal.aborted) {
          const reply = await client.call<{ updates?: MaxUpdate[]; marker?: number | null }>("GET", "/updates", {
            query: { marker, timeout: POLL_TIMEOUT_SECONDS, limit: 100, types: MAX_UPDATE_TYPES.join(",") },
            signal,
          });
          if (typeof reply.marker === "number") marker = reply.marker;
          for (const update of reply.updates ?? []) yield* toInboundUpdates(update, bot);
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    },

    async send(chat, message) {
      const attachments: Attachment[] = [];
      if (message.photo) attachments.push(await uploadPhoto(message.photo));
      if (message.buttons && message.buttons.some((row) => row.length > 0)) attachments.push(keyboardOf(message.buttons));
      return post(chat, { text: message.text, ...(message.markup === "html" && { format: "html" as const }), attachments });
    },

    async edit(sent, message) {
      // Без поля `attachments` MAX оставляет вложения как есть (картинка не пропадёт); пустой список стирает и кнопки, и вложения.
      const attachments = message.buttons === undefined ? undefined : message.buttons.some((row) => row.length > 0) ? [keyboardOf(message.buttons)] : [];
      await client.call("PUT", "/messages", {
        query: { message_id: sent.messageId },
        body: { text: message.text, ...(message.markup === "html" && { format: "html" }), ...(attachments && { attachments }) },
      });
    },

    async deleteMessage(sent) {
      await client.call("DELETE", "/messages", { query: { message_id: sent.messageId } });
    },

    async answerButton(press, text) {
      await client.call("POST", "/answers", { query: { callback_id: press.callbackId }, body: { notification: text ?? "" } });
    },

    async typing(chat) {
      await client.call("POST", `/chats/${chat.id}/actions`, { body: { action: "typing_on" } });
    },

    async downloadFile(file: InboundFile) {
      const downloaded = await client.download(file.fileId);
      return {
        bytes: downloaded.bytes,
        name: file.name ?? (file.fileId.split("?")[0]?.split("/").pop() || "file"),
        mediaType: file.mediaType ?? downloaded.mediaType ?? "application/octet-stream",
      };
    },

    async setCommands(commands, scope) {
      if (scope !== "private") return;
      await client.call("PATCH", "/me/commands", { body: { commands: commands.map((item) => ({ name: item.command, description: item.description })) } });
    },

    async sendVoice(chat, voice) {
      const file = { bytes: voice.audio, name: "voice.ogg", mediaType: "audio/ogg" };
      try {
        return await post(chat, { text: "", attachments: [await upload("audio", file)] });
      } catch (error) {
        // Голосовое не принято: тот же звук уходит файлом. Блокировку и «слишком часто» решает очередь.
        if (error instanceof MessengerBlockedError || error instanceof MessengerRateLimitError || !(error instanceof MessengerApiError)) throw error;
        return post(chat, { text: "", attachments: [await upload("file", file)] });
      }
    },

    linkUrl: (code) => `https://max.ru/${bot.botName}?start=${encodeURIComponent(code)}`,
  };
}
