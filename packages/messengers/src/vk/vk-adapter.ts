import { randomInt, timingSafeEqual } from "node:crypto";
import { readJsonBody } from "../bounded-body";
import type { Button, ExternalChat, InboundFile, InboundUpdate, MessengerAdapter, OutboundMessage, SentMessage } from "../messenger-adapter";
import { MessengerApiError, MessengerBlockedError, MessengerRateLimitError } from "../messenger-api";
import type { VkClient } from "./vk-client";
import { mediaTypeOfExtension } from "../messenger-files";
import { toInboundUpdates, type VkBotIdentity, type VkEvent } from "./vk-inbound";

/** В сообщение VK влезает 4096 знаков при правке, берём с запасом. */
const TEXT_LIMIT = 4000;
const BUTTON_LABEL_LIMIT = 40;
const SNACKBAR_LIMIT = 90;
const LONG_POLL_WAIT_SECONDS = 25;

type KeyboardButton = { action: { type: "callback"; label: string; payload: string } | { type: "open_link"; link: string; label: string } };

function keyboardOf(buttons: Button[][]): string {
  const rows = buttons
    .filter((row) => row.length > 0)
    .map((row) =>
      row.map((button): KeyboardButton => {
        const label = button.text.slice(0, BUTTON_LABEL_LIMIT);
        return button.url ? { action: { type: "open_link", link: button.url, label } } : { action: { type: "callback", label, payload: JSON.stringify({ b: button.id }) } };
      }),
    );
  return JSON.stringify({ inline: true, buttons: rows });
}

/** Пустой ожидаемый секрет — не совпадение: иначе событие с `"secret": ""` прошло бы за настоящее. */
function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || expected.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Receive = { callback: { secret: string; confirmation: string } } | { longPoll: true };

interface LongPollServer {
  key: string;
  server: string;
  ts: string;
}

/** VK как `MessengerAdapter`. */
export function createVkAdapter(input: { client: VkClient; groupId: number; groupScreenName: string; receive: Receive }): MessengerAdapter {
  const { client, groupId } = input;
  const names = new Map<string, string>();
  const bot: VkBotIdentity = {
    groupId,
    async nameOf(userId) {
      const id = String(userId);
      const known = names.get(id);
      if (known) return known;
      try {
        const [person] = await client.call<Array<{ first_name?: string; last_name?: string }>>("users.get", { user_ids: id });
        const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim();
        if (name) {
          names.set(id, name);
          return name;
        }
      } catch {
        // Имя — украшение: без него обновление всё равно доходит.
      }
      return `id${id}`;
    },
  };

  async function uploadPhoto(chat: ExternalChat, photo: NonNullable<OutboundMessage["photo"]>): Promise<string> {
    const file = "url" in photo ? { ...(await client.download(photo.url)), name: "photo.jpg" } : { bytes: photo.bytes, name: photo.name };
    const { upload_url } = await client.call<{ upload_url: string }>("photos.getMessagesUploadServer", { peer_id: chat.id });
    const uploaded = await client.uploadFile<{ server: number; photo: string; hash: string }>(upload_url, "photo", file);
    const [saved] = await client.call<Array<{ id: number; owner_id: number; access_key?: string }>>("photos.saveMessagesPhoto", { photo: uploaded.photo, server: uploaded.server, hash: uploaded.hash });
    if (!saved) throw client.api.error(200, "VK не сохранил картинку");
    return `photo${saved.owner_id}_${saved.id}${saved.access_key ? `_${saved.access_key}` : ""}`;
  }

  async function uploadDocument(chat: ExternalChat, type: "audio_message" | "doc", audio: Uint8Array): Promise<string> {
    const { upload_url } = await client.call<{ upload_url: string }>("docs.getMessagesUploadServer", { type, peer_id: chat.id });
    const uploaded = await client.uploadFile<{ file: string }>(upload_url, "file", { bytes: audio, name: "voice.ogg", mediaType: "audio/ogg" });
    const saved = await client.call<Record<string, { id: number; owner_id: number; access_key?: string }> & { type: string }>("docs.save", { file: uploaded.file });
    const doc = saved[saved.type];
    if (!doc) throw client.api.error(200, "VK не сохранил файл");
    return `doc${doc.owner_id}_${doc.id}${doc.access_key ? `_${doc.access_key}` : ""}`;
  }

  async function post(chat: ExternalChat, message: { text: string; buttons?: Button[][]; attachment?: string }): Promise<SentMessage> {
    const id = await client.call<number>("messages.send", {
      peer_id: chat.id,
      random_id: randomInt(1, 2 ** 31 - 1),
      message: message.text,
      ...(message.attachment && { attachment: message.attachment }),
      ...(message.buttons && message.buttons.length > 0 && { keyboard: keyboardOf(message.buttons) }),
    });
    return { chat, messageId: String(id) };
  }

  async function longPollServer(): Promise<LongPollServer> {
    return client.call<LongPollServer>("groups.getLongPollServer", { group_id: groupId });
  }

  return {
    messenger: "vk",
    abilities: { textLimit: TEXT_LIMIT, liveText: "edit", editEveryMs: 1500, markup: "plain", commandsMenu: false },

    async readWebhook(request) {
      const rejected = (status: number, text: string) => ({ response: new Response(text, { status }), updates: [] as InboundUpdate[] });
      if (!("callback" in input.receive)) return rejected(403, "forbidden");
      const { secret, confirmation } = input.receive.callback;
      const body = await readJsonBody(request);
      if ("error" in body) return body.error === "too_large" ? rejected(413, "payload too large") : rejected(400, "bad request");
      const event = body.json as VkEvent;
      if (typeof event?.type !== "string") return rejected(400, "bad request");
      // Строку подтверждения VK просит при настройке адреса и кладёт в этот запрос тот же секрет — сверяем,
      // иначе строку получит любой, кто знает номер сообщества.
      if (event.type === "confirmation") {
        if (event.group_id !== groupId || !sameSecret(event.secret, secret)) return rejected(403, "forbidden");
        return { response: new Response(confirmation, { status: 200 }), updates: [] };
      }
      if (!sameSecret(event.secret, secret)) return rejected(403, "forbidden");
      return { response: new Response("ok", { status: 200 }), updates: await toInboundUpdates(event, bot) };
    },

    async *poll(signal) {
      try {
        // Long Poll мог быть выключен в настройках сообщества; не вышло (нет прав) — не страшно, возможно, он уже включён.
        await client
          .call("groups.setLongPollSettings", { group_id: groupId, enabled: 1, message_new: 1, message_event: 1, message_allow: 1, message_deny: 1 }, signal)
          .catch((error: unknown) => {
            if (signal.aborted) throw error;
          });
        let server = await longPollServer();
        let ts = server.ts;
        while (!signal.aborted) {
          const url = `${server.server}?act=a_check&key=${encodeURIComponent(server.key)}&ts=${encodeURIComponent(ts)}&wait=${LONG_POLL_WAIT_SECONDS}`;
          const reply = await client.getJson<{ ts?: string; updates?: VkEvent[]; failed?: number }>(url, signal);
          if (reply.failed === 1) {
            if (reply.ts !== undefined) ts = String(reply.ts);
            continue;
          }
          if (reply.failed === 2) {
            server = { ...(await longPollServer()), ts };
            continue;
          }
          if (reply.failed !== undefined) {
            server = await longPollServer();
            ts = server.ts;
            continue;
          }
          if (reply.ts !== undefined) ts = String(reply.ts);
          for (const event of reply.updates ?? []) yield* await toInboundUpdates(event, bot);
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    },

    async send(chat, message) {
      const attachment = message.photo ? await uploadPhoto(chat, message.photo) : undefined;
      return post(chat, { text: message.text, ...(message.buttons && { buttons: message.buttons }), ...(attachment && { attachment }) });
    },

    async edit(sent, message) {
      await client.call("messages.edit", {
        peer_id: sent.chat.id,
        message_id: sent.messageId,
        message: message.text,
        ...(message.buttons !== undefined && { keyboard: keyboardOf(message.buttons) }),
      });
    },

    async deleteMessage(sent) {
      await client.call("messages.delete", { peer_id: sent.chat.id, message_ids: sent.messageId, delete_for_all: 1 });
    },

    async answerButton(press, text) {
      await client.call("messages.sendMessageEventAnswer", {
        event_id: press.callbackId,
        user_id: press.account.externalUserId,
        peer_id: press.chat.id,
        ...(text && { event_data: JSON.stringify({ type: "show_snackbar", text: text.slice(0, SNACKBAR_LIMIT) }) }),
      });
    },

    async typing(chat) {
      await client.call("messages.setActivity", { peer_id: chat.id, type: "typing" });
    },

    async downloadFile(file: InboundFile) {
      const downloaded = await client.download(file.fileId);
      return {
        bytes: downloaded.bytes,
        name: file.name ?? file.fileId.split("?")[0]?.split("/").pop() ?? "file",
        mediaType: file.mediaType ?? downloaded.mediaType ?? mediaTypeOfExtension(file.name?.split(".").pop()) ?? "application/octet-stream",
      };
    },

    async setCommands() {
      // У VK нет меню команд.
    },

    async sendVoice(chat, voice) {
      try {
        return await post(chat, { text: "", attachment: await uploadDocument(chat, "audio_message", voice.audio) });
      } catch (error) {
        // Голосовые не принимаются: тот же звук уходит файлом. Блокировку и «слишком часто» решает очередь.
        if (error instanceof MessengerBlockedError || error instanceof MessengerRateLimitError || !(error instanceof MessengerApiError)) throw error;
        return post(chat, { text: "", attachment: await uploadDocument(chat, "doc", voice.audio) });
      }
    },

    linkUrl: (code) => `https://vk.me/${input.groupScreenName}?ref=${encodeURIComponent(code)}`,
  };
}
