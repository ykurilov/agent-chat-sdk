import type { MessengerAdapter } from "../../src/messenger-adapter";
import { type AdapterRig, anna, boris, collectPolled, type HumanEvent, isOggOpus, listen, type Outgoing, type Person, type RawRequest, type RawResponse } from "./rig";

export const TELEGRAM_TOKEN = "123456:fake-telegram-token-aaaaaaaa";
export const TELEGRAM_BOT_ID = "123456";
export const TELEGRAM_USERNAME = "test_bot";
export const TELEGRAM_SECRET = "tg-webhook-secret-1234";
const GROUP_ID = -500;
const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type Update = Record<string, unknown> & { update_id: number };
interface Stored extends Outgoing {
  raw: Record<string, unknown>;
}
interface Failure {
  status: number;
  description: string;
  retryAfter?: number;
}

/** Поддельный Bot API Telegram: предел длины, 429 с `retry_after`, 403 «заблокирован», 409 на второй опрос, голос только Ogg/Opus. */
export async function startFakeTelegram(options: { token?: string } = {}) {
  const token = options.token ?? TELEGRAM_TOKEN;
  const state = {
    updates: [] as Update[],
    nextUpdateId: 1,
    nextMessageId: 1,
    messages: [] as Stored[],
    requests: [] as Array<{ method: string; body: Record<string, unknown>; headers: RawRequest["headers"] }>,
    callbackAnswers: [] as Array<{ callbackId: string; text?: string }>,
    commands: [] as Array<{ scope: "private" | "group"; commands: Array<{ command: string; description: string }> }>,
    /** Области, где меню снято (`deleteMyCommands`). */
    deletedCommandScopes: [] as Array<"private" | "group">,
    actions: [] as string[],
    drafts: [] as Array<{ chatId: string; draftId: number; text: string; at: number }>,
    files: new Map<string, { bytes: Uint8Array; path: string }>(),
    webhook: undefined as { url: string; secret?: string } | undefined,
    /** Ответы на следующие вызовы метода: очередь ошибок. */
    failures: new Map<string, Failure[]>(),
    pollers: 0,
    pollOffsets: [] as number[],
    rejectVoice: false,
  };

  const fail = (status: number, description: string, extra: Record<string, unknown> = {}): RawResponse => ({
    status,
    json: { ok: false, error_code: status, description, ...extra },
  });
  const ok = (result: unknown): RawResponse => ({ json: { ok: true, result } });

  function storeMessage(chatId: string, kind: Outgoing["kind"], raw: Record<string, unknown>, extra: Partial<Stored> = {}): Stored {
    const markup = raw.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>> } | undefined;
    const message: Stored = {
      chatId,
      messageId: String(state.nextMessageId++),
      kind,
      text: String(raw.text ?? raw.caption ?? ""),
      format: raw.parse_mode === "HTML" ? "html" : "plain",
      buttons: (markup?.inline_keyboard ?? []).map((row) => row.map((button) => ({ text: button.text, ...(button.callback_data && { data: button.callback_data }), ...(button.url && { url: button.url }) }))),
      edits: 0,
      raw,
      ...extra,
    };
    state.messages.push(message);
    return message;
  }

  function checkButtons(markup: unknown): RawResponse | undefined {
    const rows = (markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined)?.inline_keyboard ?? [];
    for (const button of rows.flat()) {
      if (button.callback_data !== undefined && Buffer.byteLength(button.callback_data) > 64) return fail(400, "Bad Request: BUTTON_DATA_INVALID");
    }
    return undefined;
  }

  async function method(name: string, body: Record<string, unknown>, request: RawRequest): Promise<RawResponse> {
    state.requests.push({ method: name, body, headers: request.headers });
    const failure = state.failures.get(name)?.shift();
    if (failure) return fail(failure.status, failure.description, failure.retryAfter ? { parameters: { retry_after: failure.retryAfter } } : {});
    const chatId = String(body.chat_id ?? "");
    switch (name) {
      case "getUpdates": {
        state.pollers++;
        try {
          if (state.pollers > 1) return fail(409, "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running");
          if (state.webhook) return fail(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first");
          const offset = Number(body.offset ?? 0);
          state.pollOffsets.push(offset);
          state.updates = state.updates.filter((update) => update.update_id >= offset);
          const wait = Date.now() + Math.min(Number(body.timeout ?? 0), 1) * 200;
          while (state.updates.length === 0 && Date.now() < wait) await new Promise((resolve) => setTimeout(resolve, 5));
          return ok(state.updates);
        } finally {
          state.pollers--;
        }
      }
      case "setWebhook":
        state.webhook = { url: String(body.url), ...(body.secret_token !== undefined && { secret: String(body.secret_token) }) };
        return ok(true);
      case "deleteWebhook":
        state.webhook = undefined;
        return ok(true);
      case "sendMessage": {
        const text = String(body.text ?? "");
        if (!text) return fail(400, "Bad Request: message text is empty");
        if (text.length > MAX_TEXT) return fail(400, "Bad Request: message is too long");
        if (body.parse_mode === "HTML" && /<(?!\/?(b|i|u|s|code|pre|a|blockquote|tg-spoiler)\b)[a-z]/i.test(text)) return fail(400, "Bad Request: can't parse entities: Unsupported start tag");
        const buttonProblem = checkButtons(body.reply_markup);
        if (buttonProblem) return buttonProblem;
        const message = storeMessage(chatId, "text", body);
        return ok({ message_id: Number(message.messageId), chat: { id: Number(chatId) } });
      }
      case "editMessageText": {
        const message = state.messages.find((item) => item.chatId === chatId && item.messageId === String(body.message_id));
        if (!message) return fail(400, "Bad Request: message to edit not found");
        const text = String(body.text ?? "");
        if (text.length > MAX_TEXT) return fail(400, "Bad Request: message is too long");
        if (text === message.text && JSON.stringify(body.reply_markup ?? null) === JSON.stringify(message.raw.reply_markup ?? null)) return fail(400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message");
        const buttonProblem = checkButtons(body.reply_markup);
        if (buttonProblem) return buttonProblem;
        const markup = body.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>> } | undefined;
        message.text = text;
        message.format = body.parse_mode === "HTML" ? "html" : "plain";
        message.raw = body;
        // Без reply_markup Telegram убирает кнопки.
        message.buttons = (markup?.inline_keyboard ?? []).map((row) => row.map((button) => ({ text: button.text, ...(button.callback_data && { data: button.callback_data }) })));
        message.edits++;
        return ok({ message_id: Number(message.messageId) });
      }
      case "deleteMessage": {
        const index = state.messages.findIndex((item) => item.chatId === chatId && item.messageId === String(body.message_id));
        if (index < 0) return fail(400, "Bad Request: message to delete not found");
        state.messages.splice(index, 1);
        return ok(true);
      }
      case "editMessageReplyMarkup": {
        const message = state.messages.find((item) => item.chatId === chatId && item.messageId === String(body.message_id));
        if (!message) return fail(400, "Bad Request: message to edit not found");
        message.buttons = [];
        return ok(true);
      }
      case "sendMessageDraft": {
        if (Number(chatId) < 0) return fail(400, "Bad Request: draft messages are not available in group chats");
        if (!body.draft_id) return fail(400, "Bad Request: draft_id must be non-zero");
        if (String(body.text ?? "").length > MAX_TEXT) return fail(400, "Bad Request: message is too long");
        state.drafts.push({ chatId, draftId: Number(body.draft_id), text: String(body.text ?? ""), at: Date.now() });
        return ok(true);
      }
      case "answerCallbackQuery":
        state.callbackAnswers.push({ callbackId: String(body.callback_query_id), ...(body.text !== undefined && { text: String(body.text) }) });
        return ok(true);
      case "sendChatAction":
        if (body.action !== "typing") return fail(400, "Bad Request: wrong action");
        state.actions.push(chatId);
        return ok(true);
      case "setMyCommands": {
        const type = (body.scope as { type?: string } | undefined)?.type;
        const commands = (body.commands as Array<{ command: string; description: string }>) ?? [];
        if (commands.length > 100) return fail(400, "Bad Request: too many commands");
        state.commands.push({ scope: type === "all_group_chats" ? "group" : "private", commands });
        return ok(true);
      }
      case "deleteMyCommands": {
        const type = (body.scope as { type?: string } | undefined)?.type;
        state.deletedCommandScopes.push(type === "all_group_chats" ? "group" : "private");
        return ok(true);
      }
      case "getFile": {
        const file = state.files.get(String(body.file_id));
        if (!file) return fail(400, "Bad Request: invalid file_id");
        if (file.bytes.length > MAX_FILE_BYTES) return fail(400, "Bad Request: file is too big");
        return ok({ file_id: String(body.file_id), file_path: file.path, file_size: file.bytes.length });
      }
      default:
        return fail(404, "Not Found");
    }
  }

  async function upload(name: "sendPhoto" | "sendVoice" | "sendAudio" | "sendDocument", request: RawRequest): Promise<RawResponse> {
    const form = await request.form();
    if (!form) return fail(400, "Bad Request: multipart expected");
    const body: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) if (typeof value === "string") body[key] = value;
    if (typeof body.reply_markup === "string") body.reply_markup = JSON.parse(body.reply_markup);
    state.requests.push({ method: name, body, headers: request.headers });
    const failure = state.failures.get(name)?.shift();
    if (failure) return fail(failure.status, failure.description, failure.retryAfter ? { parameters: { retry_after: failure.retryAfter } } : {});
    const field = name === "sendPhoto" ? "photo" : name === "sendVoice" ? "voice" : name === "sendAudio" ? "audio" : "document";
    const file = form.get(field);
    // Картинку Telegram принимает и ссылкой, и файлом.
    if (name === "sendPhoto" && typeof file === "string" && /^https?:\/\//.test(file)) {
      const message = storeMessage(String(body.chat_id), "photo", body);
      return ok({ message_id: Number(message.messageId), chat: { id: Number(body.chat_id) } });
    }
    if (!(file instanceof Blob)) return fail(400, `Bad Request: there is no ${field} in the request`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (name === "sendVoice" && !isOggOpus(bytes)) return fail(400, "Bad Request: wrong file type: voice must be OGG with OPUS");
    if (name === "sendVoice" && state.rejectVoice) {
      state.rejectVoice = false;
      return fail(400, "Bad Request: VOICE_MESSAGES_FORBIDDEN");
    }
    if (name === "sendPhoto" && String(body.caption ?? "").length > MAX_CAPTION) return fail(400, "Bad Request: message caption is too long");
    const kind = name === "sendPhoto" ? "photo" : name === "sendVoice" ? "voice" : "audio-file";
    const message = storeMessage(String(body.chat_id), kind, body, { bytes });
    return ok({ message_id: Number(message.messageId), chat: { id: Number(body.chat_id) } });
  }

  const server = await listen(async (request) => {
    const prefix = `/bot${token}/`;
    if (request.path.startsWith(`/file/bot${token}/`)) {
      const path = decodeURIComponent(request.path.slice(`/file/bot${token}/`.length));
      const file = [...state.files.values()].find((item) => item.path === path);
      return file ? { bytes: file.bytes, headers: { "content-type": "application/octet-stream" } } : { status: 404, text: "not found" };
    }
    if (!request.path.startsWith(prefix)) return fail(401, "Unauthorized");
    const name = request.path.slice(prefix.length);
    if (name === "sendPhoto" || name === "sendVoice" || name === "sendAudio" || name === "sendDocument") return upload(name, request);
    return method(name, (request.json as Record<string, unknown> | undefined) ?? {}, request);
  });

  // ---- люди пишут боту ----
  const user = (person: Person) => ({ id: Number(person.id), is_bot: false, first_name: person.name, ...(person.username && { username: person.username }) });
  const chatOf = (chat: { id: string; type: "private" | "group" }) => ({ id: Number(chat.id), type: chat.type === "private" ? "private" : "supergroup" });

  function toUpdate(event: HumanEvent): Update {
    const update_id = state.nextUpdateId++;
    const messageId = state.nextMessageId++;
    const base = (chat: { id: string; type: "private" | "group" }, from: Person) => ({ message_id: messageId, date: 1_700_000_000, chat: chatOf(chat), from: user(from) });
    switch (event.type) {
      case "text": {
        const entities: unknown[] = [];
        let text = event.text;
        if (event.mentionsBot) {
          text = `@${TELEGRAM_USERNAME} ${text}`;
          entities.push({ type: "mention", offset: 0, length: TELEGRAM_USERNAME.length + 1 });
        }
        const command = /^\/[A-Za-z0-9_]+(@\S+)?/.exec(text);
        if (command) entities.push({ type: "bot_command", offset: 0, length: command[0].length });
        return {
          update_id,
          message: {
            ...base(event.chat, event.from),
            text,
            ...(entities.length > 0 && { entities }),
            ...(event.repliesToBot && { reply_to_message: { message_id: 1, from: { id: Number(TELEGRAM_BOT_ID), is_bot: true, first_name: "Bot", username: TELEGRAM_USERNAME }, chat: chatOf(event.chat), date: 1 } }),
          },
        };
      }
      case "start": {
        const text = event.payload ? `/start ${event.payload}` : "/start";
        const chat = { id: event.from.id, type: "private" as const };
        return { update_id, message: { ...base(chat, event.from), text, entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
      }
      case "press":
        return {
          update_id,
          callback_query: {
            id: `cb${update_id}`,
            from: user(event.from),
            chat_instance: "ci",
            data: event.data,
            message: { message_id: Number(event.messageId), date: 1, chat: chatOf(event.chat) },
          },
        };
      case "voice": {
        const fileId = `voice-${update_id}`;
        state.files.set(fileId, { bytes: event.audio, path: `voice/file_${update_id}.oga` });
        return {
          update_id,
          message: { ...base(event.chat, event.from), voice: { file_id: fileId, file_unique_id: fileId, duration: Math.round(event.durationMs / 1000), mime_type: "audio/ogg", file_size: event.audio.length } },
        };
      }
      case "file": {
        const fileId = `file-${update_id}`;
        state.files.set(fileId, { bytes: event.bytes, path: `documents/file_${update_id}_${event.name}` });
        const isPhoto = event.mediaType.startsWith("image/") && event.name === "photo.jpg";
        const media = isPhoto
          ? { photo: [{ file_id: `${fileId}-small`, file_unique_id: "s", width: 90, height: 90, file_size: 10 }, { file_id: fileId, file_unique_id: "b", width: 800, height: 800, file_size: event.bytes.length }] }
          : { document: { file_id: fileId, file_unique_id: fileId, file_name: event.name, mime_type: event.mediaType, file_size: event.bytes.length } };
        return { update_id, message: { ...base(event.chat, event.from), ...media, ...(event.caption && { caption: event.caption }) } };
      }
      case "bot_added":
      case "bot_removed":
        return {
          update_id,
          my_chat_member: {
            chat: chatOf(event.chat),
            from: user(event.by),
            date: 1,
            old_chat_member: { user: { id: Number(TELEGRAM_BOT_ID), is_bot: true, first_name: "Bot" }, status: event.type === "bot_added" ? "left" : "member" },
            new_chat_member: { user: { id: Number(TELEGRAM_BOT_ID), is_bot: true, first_name: "Bot" }, status: event.type === "bot_added" ? "member" : "left" },
          },
        };
      case "blocked":
      case "allowed":
        return {
          update_id,
          my_chat_member: {
            chat: { id: Number(event.from.id), type: "private" },
            from: user(event.from),
            date: 1,
            old_chat_member: { user: { id: Number(TELEGRAM_BOT_ID), is_bot: true, first_name: "Bot" }, status: event.type === "blocked" ? "member" : "kicked" },
            new_chat_member: { user: { id: Number(TELEGRAM_BOT_ID), is_bot: true, first_name: "Bot" }, status: event.type === "blocked" ? "kicked" : "member" },
          },
        };
    }
  }

  return {
    url: server.url,
    token,
    state,
    close: server.close,
    /** Положить событие на сервер для опроса. */
    enqueue(event: HumanEvent) {
      const update = toUpdate(event);
      state.updates.push(update);
      return update;
    },
    /** Событие как тело вебхука. */
    webhookBody(event: HumanEvent) {
      return toUpdate(event);
    },
    /** Следующий вызов метода кончится ошибкой. */
    failNext(methodName: string, failure: Failure) {
      state.failures.set(methodName, [...(state.failures.get(methodName) ?? []), failure]);
    },
  };
}

export type FakeTelegram = Awaited<ReturnType<typeof startFakeTelegram>>;

/** Поддельный Telegram как `AdapterRig` для общих тестов. */
export async function createTelegramRig(createAdapter: (api: { baseUrl: string }, receive: { webhook: { secret: string } } | { polling: true }) => MessengerAdapter): Promise<AdapterRig & { fake: FakeTelegram }> {
  const fake = await startFakeTelegram();
  const api = { baseUrl: fake.url };
  const webhookAdapter = createAdapter(api, { webhook: { secret: TELEGRAM_SECRET } });
  const pollingAdapter = createAdapter(api, { polling: true });
  const privateChat = { id: anna.id, type: "private" as const };
  const groupChat = { id: String(GROUP_ID), type: "group" as const };
  return {
    messenger: "telegram",
    botId: TELEGRAM_BOT_ID,
    adapter: webhookAdapter,
    anna,
    boris,
    chats: { annaPrivate: privateChat, group: groupChat },
    fake,
    async deliver(event) {
      const body = fake.webhookBody(event);
      const { updates } = await webhookAdapter.readWebhook(
        new Request("http://app/telegram/webhook", {
          method: "POST",
          headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": TELEGRAM_SECRET },
          body: JSON.stringify(body),
        }),
      );
      return updates;
    },
    signedWebhook: (body) =>
      new Request("http://app/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": TELEGRAM_SECRET }, body }),
    async poll(events) {
      for (const event of events) fake.enqueue(event);
      return collectPolled(pollingAdapter, events.length);
    },
    get outgoing() {
      return fake.state.messages;
    },
    get answers() {
      return fake.state.callbackAnswers;
    },
    get commands() {
      return fake.state.commands;
    },
    commandScopes: ["private", "group"],
    allowedArrivesAsStart: false,
    get typing() {
      return fake.state.actions;
    },
    rejectNextVoice() {
      fake.state.rejectVoice = true;
    },
    close: fake.close,
  };
}

export type { Failure as TelegramFailure };
