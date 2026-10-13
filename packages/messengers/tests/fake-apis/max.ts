import type { MessengerAdapter } from "../../src/messenger-adapter";
import { type AdapterRig, anna, boris, collectPolled, type HumanEvent, listen, type Outgoing, type Person, type RawRequest, type RawResponse } from "./rig";

export const MAX_TOKEN = "max-fake-bot-token-cccccccc";
export const MAX_BOT_NAME = "test_max_bot";
export const MAX_SECRET = "max-webhook-secret-1234";
export const MAX_GROUP_CHAT = "-5001";
const MAX_TEXT = 4000;
const MAX_BUTTON_PAYLOAD = 1024;
const MAX_COMMANDS = 32;
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

interface Stored extends Outgoing {
  /** Что осталось у сообщения из вложений: `image`, `file`, `audio`, `inline_keyboard`. */
  attachmentTypes: string[];
}
type MaxUpdate = Record<string, unknown> & { update_type: string; timestamp: number };

/** Поддельный MAX: 4000 знаков, правка без `attachments` не трогает вложения, `attachment.not.ready`, 403 `chat.denied`, подписка и опрос. */
export async function startFakeMax(options: { token?: string } = {}) {
  const token = options.token ?? MAX_TOKEN;
  const state = {
    nextId: 1,
    nextCallback: 1,
    messages: [] as Stored[],
    requests: [] as Array<{ method: string; path: string; query: Record<string, string>; body: unknown; headers: RawRequest["headers"] }>,
    answers: [] as Array<{ callbackId: string; text?: string; body: unknown }>,
    actions: [] as string[],
    commands: [] as Array<{ name: string; description: string }>,
    subscriptions: [] as Array<{ url: string; secret?: string; update_types?: string[] }>,
    uploads: new Map<string, { type: string; bytes: Uint8Array }>(),
    tokens: new Map<string, { type: string; bytes: Uint8Array }>(),
    files: new Map<string, { bytes: Uint8Array; type: string }>(),
    updates: [] as MaxUpdate[],
    markers: [] as number[],
    editBodies: [] as Array<Record<string, unknown>>,
    /** Столько следующих отправок с вложением получат `attachment.not.ready`. */
    notReady: 0,
    /** Чаты, в которые писать нельзя: человек остановил бота. */
    denied: new Set<string>(),
    rejectVoice: false,
    failures: new Map<string, Array<{ status: number; code: string; message: string; headers?: Record<string, string> }>>(),
  };
  let baseUrl = "";

  const err = (status: number, code: string, message: string, headers?: Record<string, string>): RawResponse => ({ status, json: { code, message }, ...(headers && { headers }) });

  function chatIdOf(request: RawRequest): string {
    return request.query.get("chat_id") ?? "";
  }

  function toStored(chatId: string, body: Record<string, unknown>, kind: Outgoing["kind"], bytes?: Uint8Array): Stored {
    const attachments = (body.attachments as Array<{ type: string; payload?: { buttons?: Array<Array<{ type: string; text: string; payload?: string; url?: string }>> } }> | undefined) ?? [];
    const keyboard = attachments.find((item) => item.type === "inline_keyboard");
    const message: Stored = {
      chatId,
      messageId: `mid.${state.nextId++}`,
      kind,
      text: String(body.text ?? ""),
      format: body.format === "html" ? "html" : "plain",
      buttons: (keyboard?.payload?.buttons ?? []).map((row) => row.map((button) => ({ text: button.text, ...(button.payload !== undefined && { data: button.payload }), ...(button.url && { url: button.url }) }))),
      edits: 0,
      attachmentTypes: attachments.map((item) => item.type),
      ...(bytes && { bytes }),
    };
    state.messages.push(message);
    return message;
  }

  async function handle(request: RawRequest): Promise<RawResponse> {
    const query = Object.fromEntries(request.query.entries());
    state.requests.push({ method: request.method, path: request.path, query, body: request.json, headers: request.headers });
    const failure = state.failures.get(`${request.method} ${request.path}`)?.shift();
    if (failure) return err(failure.status, failure.code, failure.message, failure.headers);
    const body = (request.json ?? {}) as Record<string, unknown>;
    const route = `${request.method} ${request.path}`;
    switch (route) {
      case "GET /me":
        return { json: { user_id: 999, name: "Бот", username: MAX_BOT_NAME, is_bot: true } };
      case "GET /subscriptions":
        return { json: { subscriptions: state.subscriptions.map((item) => ({ url: item.url, time: 1, update_types: item.update_types })) } };
      case "POST /subscriptions": {
        const url = String(body.url ?? "");
        if (!url.startsWith("https://")) return err(400, "proto.payload", "Webhook URL must be HTTPS");
        if (body.secret !== undefined && !/^[A-Za-z0-9_-]{5,256}$/.test(String(body.secret))) return err(400, "proto.payload", "Invalid secret");
        state.subscriptions = state.subscriptions.filter((item) => item.url !== url);
        state.subscriptions.push({ url, ...(body.secret !== undefined && { secret: String(body.secret) }), ...(body.update_types !== undefined && { update_types: body.update_types as string[] }) });
        return { json: { success: true } };
      }
      case "DELETE /subscriptions":
        state.subscriptions = state.subscriptions.filter((item) => item.url !== query.url);
        return { json: { success: true } };
      case "GET /updates": {
        if (state.subscriptions.length > 0) return err(400, "proto.payload", "Long polling is unavailable while a webhook subscription is active");
        const marker = Number(query.marker ?? 0);
        state.markers.push(marker);
        const deadline = Date.now() + 150;
        while (state.updates.length <= marker && Date.now() < deadline) await realSleep(5);
        return { json: { updates: state.updates.slice(marker), marker: state.updates.length } };
      }
      case "POST /messages": {
        const chatId = chatIdOf(request);
        if (!chatId) return err(400, "proto.payload", "chat_id or user_id is required");
        if (state.denied.has(chatId)) return err(403, "chat.denied", "Forbidden: bot was stopped by the user");
        const text = String(body.text ?? "");
        if (text.length > MAX_TEXT) return err(400, "proto.payload", "text: size must be <= 4000");
        if (body.format !== undefined && body.format !== "html" && body.format !== "markdown") return err(400, "proto.payload", "Invalid format");
        const attachments = (body.attachments as Array<{ type: string; payload?: { token?: string; buttons?: Array<Array<{ payload?: string }>> } }> | undefined) ?? [];
        if (!text && attachments.length === 0) return err(400, "proto.payload", "text or attachments required");
        for (const item of attachments) {
          for (const button of item.payload?.buttons?.flat() ?? []) {
            if (button.payload !== undefined && button.payload.length > MAX_BUTTON_PAYLOAD) return err(400, "proto.payload", "button payload too long");
          }
        }
        const media = attachments.find((item) => item.type !== "inline_keyboard");
        let kind: Outgoing["kind"] = "text";
        let bytes: Uint8Array | undefined;
        if (media) {
          if (state.notReady > 0) {
            state.notReady--;
            return err(400, "attachment.not.ready", "Key: errors.process.attachment.file.not.processed");
          }
          const uploaded = state.tokens.get(media.payload?.token ?? "");
          if (!uploaded) return err(400, "proto.payload", "unknown attachment token");
          bytes = uploaded.bytes;
          kind = media.type === "image" ? "photo" : media.type === "audio" ? "voice" : "audio-file";
          if (media.type === "audio" && state.rejectVoice) {
            state.rejectVoice = false;
            return err(400, "proto.payload", "audio attachment is not supported here");
          }
        }
        const stored = toStored(chatId, body, kind, bytes);
        return { json: { message: { recipient: { chat_id: Number(chatId) }, body: { mid: stored.messageId, seq: 1, text, attachments: [] } } } };
      }
      case "DELETE /messages": {
        const index = state.messages.findIndex((item) => item.messageId === query.message_id);
        if (index < 0) return err(404, "proto.payload", "message not found");
        state.messages.splice(index, 1);
        return { json: { success: true } };
      }
      case "PUT /messages": {
        const message = state.messages.find((item) => item.messageId === query.message_id);
        if (!message) return err(404, "proto.payload", "message not found");
        const text = String(body.text ?? "");
        if (text.length > MAX_TEXT) return err(400, "proto.payload", "text: size must be <= 4000");
        state.editBodies.push(body);
        message.text = text;
        message.format = body.format === "html" ? "html" : "plain";
        // Нет `attachments` — вложения и кнопки остаются; `[]` стирает всё.
        if (Array.isArray(body.attachments)) {
          const attachments = body.attachments as Array<{ type: string; payload?: { buttons?: Array<Array<{ text: string; payload?: string; url?: string }>> } }>;
          const keyboard = attachments.find((item) => item.type === "inline_keyboard");
          message.buttons = (keyboard?.payload?.buttons ?? []).map((row) => row.map((button) => ({ text: button.text, ...(button.payload !== undefined && { data: button.payload }), ...(button.url && { url: button.url }) })));
          message.attachmentTypes = attachments.map((item) => item.type);
          if (!attachments.some((item) => item.type !== "inline_keyboard")) delete message.bytes;
        }
        message.edits++;
        return { json: { success: true } };
      }
      case "POST /answers": {
        if (body.notification === undefined && body.message === undefined) return err(400, "proto.payload", "message or notification required");
        state.answers.push({ callbackId: String(query.callback_id), ...(typeof body.notification === "string" && body.notification !== "" && { text: body.notification }), body });
        return { json: { success: true } };
      }
      case "POST /uploads": {
        const type = String(query.type ?? "");
        if (!["image", "video", "audio", "file"].includes(type)) return err(400, "proto.payload", "Invalid upload type");
        const id = state.nextId++;
        const upload = { url: `${baseUrl}/upload/${type}/${id}`, ...(type === "audio" || type === "video" ? { token: `tk-${id}` } : {}) };
        state.uploads.set(String(id), { type, bytes: new Uint8Array() });
        return { json: upload };
      }
      case "PATCH /me/commands": {
        const commands = (body.commands as Array<{ name: string; description: string }>) ?? [];
        if (commands.length > MAX_COMMANDS) return err(400, "proto.payload", "too many commands");
        state.commands = commands;
        return { json: { success: true } };
      }
      default: {
        const action = /^\/chats\/([^/]+)\/actions$/.exec(request.path);
        if (request.method === "POST" && action) {
          if (body.action !== "typing_on") return err(400, "proto.payload", "Invalid action");
          state.actions.push(decodeURIComponent(action[1] ?? ""));
          return { json: { success: true } };
        }
        return err(404, "not.found", "Not found");
      }
    }
  }

  const server = await listen(async (request) => {
    if (request.path.startsWith("/files/")) {
      const file = state.files.get(decodeURIComponent(request.path));
      return file ? { bytes: file.bytes, headers: { "content-type": file.type } } : { status: 404, text: "not found" };
    }
    if (request.path.startsWith("/upload/")) {
      const [, , type, id] = request.path.split("/");
      const upload = state.uploads.get(id ?? "");
      const form = await request.form();
      const file = form?.get("data");
      if (!upload || !(file instanceof Blob)) return err(400, "proto.payload", "no file");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const tokenValue = `tk-${id}`;
      state.tokens.set(tokenValue, { type: type ?? "", bytes });
      if (type === "image") return { json: { photos: { p1: { token: tokenValue } } } };
      if (type === "file") return { json: { token: tokenValue } };
      return { json: { retval: "1" } };
    }
    if (request.headers.authorization !== token) return err(401, "verify.token", "Invalid access_token");
    return handle(request);
  });
  baseUrl = server.url;

  // ---- люди пишут боту ----
  const userOf = (person: Person) => ({ user_id: Number(person.id), name: person.name, ...(person.username && { username: person.username }), is_bot: false });
  const chatTypeOf = (chat: { type: "private" | "group" }) => (chat.type === "private" ? "dialog" : "chat");

  function toUpdate(event: HumanEvent): MaxUpdate {
    const timestamp = 1_700_000_000_000 + state.nextId++;
    const recipient = (chat: { id: string; type: "private" | "group" }) => ({ chat_id: Number(chat.id), chat_type: chatTypeOf(chat) });
    const created = (chat: { id: string; type: "private" | "group" }, from: Person, body: Record<string, unknown>, extra: Record<string, unknown> = {}): MaxUpdate => ({
      update_type: "message_created",
      timestamp,
      message: { sender: userOf(from), recipient: recipient(chat), timestamp, body: { mid: `mid.in${state.nextId++}`, seq: 1, text: "", attachments: [], ...body }, ...extra },
      user_locale: "ru",
    });
    switch (event.type) {
      case "text": {
        const text = event.mentionsBot ? `@${MAX_BOT_NAME} ${event.text}` : event.text;
        return created(event.chat, event.from, { text }, event.repliesToBot ? { link: { type: "reply", sender: { user_id: 999, name: "Бот", username: MAX_BOT_NAME, is_bot: true }, chat_id: Number(event.chat.id), message: { mid: "mid.1", seq: 1, text: "" } } } : {});
      }
      case "start":
        return { update_type: "bot_started", timestamp, chat_id: Number(event.from.id) + 5000, user: userOf(event.from), ...(event.payload && { payload: event.payload }), user_locale: "ru" };
      case "press":
        return {
          update_type: "message_callback",
          timestamp,
          callback: { callback_id: `cb${state.nextCallback++}`, timestamp, payload: event.data, user: userOf(event.from) },
          message: { recipient: recipient(event.chat), timestamp, body: { mid: event.messageId, seq: 1, text: "", attachments: [] } },
          user_locale: "ru",
        };
      case "voice": {
        const path = `/files/voice-${state.nextId++}.ogg`;
        state.files.set(path, { bytes: event.audio, type: "audio/ogg" });
        return created(event.chat, event.from, { attachments: [{ type: "audio", payload: { url: `${baseUrl}${path}`, token: "t", ...(event.transcription !== undefined && { transcription: event.transcription }) } }] });
      }
      case "file": {
        const path = `/files/${state.nextId++}/${event.name}`;
        state.files.set(path, { bytes: event.bytes, type: event.mediaType });
        const attachment = event.name === "photo.jpg" ? { type: "image", payload: { url: `${baseUrl}${path}`, token: "t", photo_id: 1 } } : { type: "file", payload: { url: `${baseUrl}${path}`, token: "t" }, filename: event.name, size: event.bytes.length };
        return created(event.chat, event.from, { text: event.caption ?? "", attachments: [attachment] });
      }
      case "bot_added":
      case "bot_removed":
        return { update_type: event.type, timestamp, chat_id: Number(event.chat.id), user: userOf(event.by), is_channel: false };
      case "blocked":
        return { update_type: "bot_stopped", timestamp, chat_id: Number(event.from.id) + 5000, user: userOf(event.from), user_locale: "ru" };
      case "allowed":
        return { update_type: "bot_started", timestamp, chat_id: Number(event.from.id) + 5000, user: userOf(event.from), user_locale: "ru" };
    }
  }

  return {
    url: server.url,
    token,
    state,
    close: server.close,
    enqueue(event: HumanEvent) {
      const update = toUpdate(event);
      state.updates.push(update);
      return update;
    },
    webhookBody(event: HumanEvent) {
      return toUpdate(event);
    },
    failNext(route: string, failure: { status: number; code: string; message: string; headers?: Record<string, string> }) {
      state.failures.set(route, [...(state.failures.get(route) ?? []), failure]);
    },
  };
}

export type FakeMax = Awaited<ReturnType<typeof startFakeMax>>;

/** Поддельный MAX как `AdapterRig` для общих тестов. */
export async function createMaxRig(createAdapter: (api: { baseUrl: string }, receive: { webhook: { secret: string } } | { polling: true }) => MessengerAdapter): Promise<AdapterRig & { fake: FakeMax }> {
  const fake = await startFakeMax();
  const api = { baseUrl: fake.url };
  const webhookAdapter = createAdapter(api, { webhook: { secret: MAX_SECRET } });
  const pollAdapter = createAdapter(api, { polling: true });
  return {
    messenger: "max",
    botId: MAX_BOT_NAME,
    adapter: webhookAdapter,
    anna,
    boris,
    chats: { annaPrivate: { id: String(Number(anna.id) + 5000), type: "private" }, group: { id: MAX_GROUP_CHAT, type: "group" } },
    fake,
    async deliver(event) {
      const { updates } = await webhookAdapter.readWebhook(
        new Request("http://app/max/webhook", { method: "POST", headers: { "content-type": "application/json", "x-max-bot-api-secret": MAX_SECRET }, body: JSON.stringify(fake.webhookBody(event)) }),
      );
      return updates;
    },
    signedWebhook: (body) => new Request("http://app/max/webhook", { method: "POST", headers: { "content-type": "application/json", "x-max-bot-api-secret": MAX_SECRET }, body }),
    async poll(events) {
      for (const event of events) fake.enqueue(event);
      return collectPolled(pollAdapter, events.length);
    },
    get outgoing() {
      return fake.state.messages;
    },
    get answers() {
      return fake.state.answers;
    },
    get commands() {
      return fake.state.commands.length > 0 ? [{ scope: "private" as const, commands: fake.state.commands.map((item) => ({ command: item.name, description: item.description })) }] : [];
    },
    commandScopes: ["private"],
    allowedArrivesAsStart: true,
    get typing() {
      return fake.state.actions;
    },
    rejectNextVoice() {
      fake.state.rejectVoice = true;
    },
    close: fake.close,
  };
}
