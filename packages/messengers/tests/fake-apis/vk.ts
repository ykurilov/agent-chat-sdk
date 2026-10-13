import type { MessengerAdapter } from "../../src/messenger-adapter";
import { type AdapterRig, anna, boris, collectPolled, type HumanEvent, isOggOpus, listen, type Outgoing, type Person, type RawRequest, type RawResponse } from "./rig";

export const VK_TOKEN = "vk1.a.fake-community-token-bbbbbbbb";
export const VK_GROUP_ID = 777;
export const VK_GROUP_SCREEN_NAME = "test_group";
export const VK_SECRET = "vk-callback-secret-1234";
export const VK_CONFIRMATION = "c0nf1rm";
export const VK_GROUP_PEER = 2_000_000_001;
const MAX_SEND_TEXT = 9000;
const MAX_EDIT_TEXT = 4096;
const MAX_PAYLOAD = 255;

type VkEvent = { type: string; event_id: string; v: string; object: unknown; group_id: number };
interface Stored extends Outgoing {
  randomId: string;
}

/** Поддельный API VK: `random_id`, 9000/4096 знаков, ошибки 6, 901, 993, Long Poll с `failed` 1/2/3, загрузка файлов в два шага. */
export async function startFakeVk(options: { token?: string } = {}) {
  const token = options.token ?? VK_TOKEN;
  const state = {
    nextId: 1,
    nextEventId: 1,
    messages: [] as Stored[],
    calls: [] as Array<{ method: string; params: Record<string, string>; headers: RawRequest["headers"] }>,
    eventAnswers: [] as Array<{ callbackId: string; userId: string; peerId: string; text?: string }>,
    activities: [] as string[],
    uploads: new Map<string, { kind: "photo" | "audio_message" | "doc"; bytes: Uint8Array; name: string }>(),
    savedDocs: new Map<string, { type: "audio_message" | "doc"; bytes: Uint8Array }>(),
    savedPhotos: new Map<string, Uint8Array>(),
    files: new Map<string, { bytes: Uint8Array; type: string }>(),
    names: new Map<string, string>(),
    failures: new Map<string, Array<{ code: number; message: string }>>(),
    randomIds: new Map<string, string>(),
    rejectVoice: false,
    // Long Poll
    lpKey: "lpkey-1",
    lpEvents: [] as VkEvent[],
    lpRequests: [] as Array<{ key: string; ts: string; wait: string }>,
    lpServerCalls: 0,
    lpFailure: undefined as 1 | 2 | 3 | undefined,
    lpSettings: undefined as Record<string, string> | undefined,
  };
  let baseUrl = "";

  const err = (code: number, message: string): RawResponse => ({ json: { error: { error_code: code, error_msg: message, request_params: [] } } });
  const ok = (response: unknown): RawResponse => ({ json: { response } });

  function toStored(peerId: string, kind: Outgoing["kind"], params: Record<string, string>, extra: Partial<Stored> = {}): Stored {
    const keyboard = params.keyboard ? (JSON.parse(params.keyboard) as { buttons: Array<Array<{ action: { type: string; label: string; payload?: string; link?: string } }>> }) : undefined;
    const message: Stored = {
      chatId: peerId,
      messageId: String(state.nextId++),
      kind,
      text: params.message ?? "",
      format: "plain",
      buttons: (keyboard?.buttons ?? []).map((row) => row.map((button) => ({ text: button.action.label, ...(button.action.payload !== undefined && { data: button.action.payload }), ...(button.action.link && { url: button.action.link }) }))),
      edits: 0,
      randomId: params.random_id ?? "",
      ...extra,
    };
    state.messages.push(message);
    return message;
  }

  function checkKeyboard(raw: string | undefined): RawResponse | undefined {
    if (!raw) return undefined;
    const keyboard = JSON.parse(raw) as { buttons: Array<Array<{ action: { payload?: string } }>> };
    for (const button of keyboard.buttons.flat()) {
      if (button.action.payload !== undefined && button.action.payload.length > MAX_PAYLOAD) return err(911, "Keyboard format is invalid: payload too long");
    }
    return undefined;
  }

  async function method(name: string, params: Record<string, string>): Promise<RawResponse> {
    const failure = state.failures.get(name)?.shift();
    if (failure) return err(failure.code, failure.message);
    switch (name) {
      case "messages.send": {
        const peerId = params.peer_id;
        if (!peerId) return err(100, "One of the parameters specified was missing or invalid: peer_id");
        if (!params.random_id || params.random_id === "0") return err(100, "One of the parameters specified was missing or invalid: random_id");
        const duplicate = state.randomIds.get(`${peerId}:${params.random_id}`);
        if (duplicate) return ok(Number(duplicate));
        const attachments = params.attachment ? params.attachment.split(",") : [];
        if (!params.message && attachments.length === 0) return err(100, "One of the parameters specified was missing or invalid: message is empty");
        if ((params.message ?? "").length > MAX_SEND_TEXT) return err(914, "Message is too long");
        const keyboardProblem = checkKeyboard(params.keyboard);
        if (keyboardProblem) return keyboardProblem;
        const doc = attachments.find((item) => item.startsWith("doc"));
        const photo = attachments.find((item) => item.startsWith("photo"));
        let kind: Outgoing["kind"] = "text";
        let bytes: Uint8Array | undefined;
        if (doc) {
          const saved = state.savedDocs.get(doc);
          if (!saved) return err(100, "One of the parameters specified was missing or invalid: attachment");
          kind = saved.type === "audio_message" ? "voice" : "audio-file";
          bytes = saved.bytes;
        } else if (photo) {
          bytes = state.savedPhotos.get(photo);
          if (!bytes) return err(100, "One of the parameters specified was missing or invalid: attachment");
          kind = "photo";
        }
        const message = toStored(peerId, kind, params, bytes ? { bytes } : {});
        state.randomIds.set(`${peerId}:${params.random_id}`, message.messageId);
        return ok(Number(message.messageId));
      }
      case "messages.edit": {
        const message = state.messages.find((item) => item.chatId === params.peer_id && item.messageId === params.message_id);
        if (!message) return err(100, "One of the parameters specified was missing or invalid: message_id");
        if ((params.message ?? "").length > MAX_EDIT_TEXT) return err(914, "Message is too long");
        const keyboardProblem = checkKeyboard(params.keyboard);
        if (keyboardProblem) return keyboardProblem;
        message.text = params.message ?? message.text;
        const keyboard = params.keyboard ? (JSON.parse(params.keyboard) as { buttons: Array<Array<{ action: { label: string; payload?: string; link?: string } }>> }) : undefined;
        if (params.keyboard !== undefined) {
          message.buttons = (keyboard?.buttons ?? []).map((row) => row.map((button) => ({ text: button.action.label, ...(button.action.payload !== undefined && { data: button.action.payload }) })));
        }
        message.edits++;
        return ok(1);
      }
      case "messages.delete": {
        const index = state.messages.findIndex((item) => item.chatId === params.peer_id && item.messageId === params.message_ids);
        if (index < 0) return err(100, "One of the parameters specified was missing or invalid: message_ids");
        state.messages.splice(index, 1);
        return ok({ [params.message_ids ?? ""]: 1 });
      }
      case "messages.setActivity":
        if (params.type !== "typing") return err(100, "One of the parameters specified was missing or invalid: type");
        state.activities.push(params.peer_id ?? "");
        return ok(1);
      case "messages.sendMessageEventAnswer": {
        let text: string | undefined;
        if (params.event_data) {
          const data = JSON.parse(params.event_data) as { type: string; text?: string };
          if (data.type !== "show_snackbar") return err(100, "One of the parameters specified was missing or invalid: event_data");
          if ((data.text ?? "").length > 90) return err(100, "event_data text is too long");
          text = data.text;
        }
        state.eventAnswers.push({ callbackId: params.event_id ?? "", userId: params.user_id ?? "", peerId: params.peer_id ?? "", ...(text !== undefined && { text }) });
        return ok(1);
      }
      case "users.get": {
        const ids = (params.user_ids ?? "").split(",").filter(Boolean);
        return ok(
          ids.map((id) => {
            const [first = "", ...rest] = (state.names.get(id) ?? `Пользователь ${id}`).split(" ");
            return { id: Number(id), first_name: first, last_name: rest.join(" ") };
          }),
        );
      }
      case "groups.getLongPollServer":
        state.lpServerCalls++;
        // Журнал событий поддельного сервера общий и идёт с нуля: то, что человек написал до начала опроса, не теряется.
        return ok({ key: state.lpKey, server: `${baseUrl}/lp`, ts: "0" });
      case "groups.setLongPollSettings":
        state.lpSettings = params;
        return ok(1);
      case "photos.getMessagesUploadServer":
        return ok({ upload_url: `${baseUrl}/upload/photo`, album_id: -64, group_id: VK_GROUP_ID });
      case "photos.saveMessagesPhoto": {
        const uploaded = state.uploads.get(`photo:${params.photo}`);
        if (!uploaded) return err(100, "One of the parameters specified was missing or invalid: photo");
        const id = state.nextId++;
        state.savedPhotos.set(`photo-${VK_GROUP_ID}_${id}`, uploaded.bytes);
        return ok([{ id, owner_id: -VK_GROUP_ID, access_key: "" }]);
      }
      case "docs.getMessagesUploadServer":
        if (params.type !== "audio_message" && params.type !== "doc") return err(100, "One of the parameters specified was missing or invalid: type");
        return ok({ upload_url: `${baseUrl}/upload/${params.type}` });
      case "docs.save": {
        const uploaded = state.uploads.get(`file:${params.file}`);
        if (!uploaded) return err(100, "One of the parameters specified was missing or invalid: file");
        if (uploaded.kind === "audio_message" && state.rejectVoice) {
          state.rejectVoice = false;
          return err(100, "Voice messages are not allowed for this community");
        }
        const id = state.nextId++;
        const type = uploaded.kind === "audio_message" ? "audio_message" : "doc";
        state.savedDocs.set(`doc-${VK_GROUP_ID}_${id}`, { type, bytes: uploaded.bytes });
        return ok({ type, [type]: { id, owner_id: -VK_GROUP_ID, access_key: "" } });
      }
      default:
        return err(3, "Unknown method passed");
    }
  }

  const server = await listen(async (request) => {
    if (request.path === "/lp") return longPoll(request);
    if (request.path.startsWith("/upload/")) return upload(request);
    if (request.path.startsWith("/files/")) {
      const file = state.files.get(decodeURIComponent(request.path));
      return file ? { bytes: file.bytes, headers: { "content-type": file.type } } : { status: 404, text: "not found" };
    }
    if (!request.path.startsWith("/method/")) return { status: 404, text: "not found" };
    const name = request.path.slice("/method/".length);
    const form = await request.form();
    const params: Record<string, string> = {};
    for (const [key, value] of request.query.entries()) params[key] = value;
    if (form) for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;
    state.calls.push({ method: name, params, headers: request.headers });
    if (request.headers.authorization !== `Bearer ${token}` && params.access_token !== token) return err(5, "User authorization failed: invalid access_token (4)");
    if (!params.v) return err(100, "One of the parameters specified was missing or invalid: v");
    return method(name, params);
  });
  baseUrl = server.url;

  async function upload(request: RawRequest): Promise<RawResponse> {
    const kind = request.path.slice("/upload/".length) as "photo" | "audio_message" | "doc";
    const form = await request.form();
    const field = kind === "photo" ? "photo" : "file";
    const file = form?.get(field);
    if (!(file instanceof Blob)) return { json: { error: "no file" } };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "audio_message" && !isOggOpus(bytes)) return { json: { error: "wrong audio_message format: Ogg with Opus required" } };
    const handle = `h${state.nextId++}`;
    state.uploads.set(`${field}:${handle}`, { kind, bytes, name: file instanceof File ? file.name : "" });
    return kind === "photo" ? { json: { server: 1, photo: handle, hash: "hash" } } : { json: { file: handle } };
  }

  async function longPoll(request: RawRequest): Promise<RawResponse> {
    const key = request.query.get("key") ?? "";
    const ts = request.query.get("ts") ?? "0";
    state.lpRequests.push({ key, ts, wait: request.query.get("wait") ?? "" });
    if (request.query.get("act") !== "a_check") return { json: { failed: 3 } };
    const injected = state.lpFailure;
    if (injected) {
      state.lpFailure = undefined;
      if (injected === 1) return { json: { failed: 1, ts } };
      if (injected === 2) {
        state.lpKey = `lpkey-${state.lpServerCalls + 2}`;
        return { json: { failed: 2 } };
      }
      return { json: { failed: 3 } };
    }
    if (key !== state.lpKey) return { json: { failed: 2 } };
    const from = Number(ts);
    const deadline = Date.now() + 150;
    while (state.lpEvents.length <= from && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    return { json: { ts: String(state.lpEvents.length), updates: state.lpEvents.slice(from) } };
  }

  // ---- люди пишут боту ----
  const peerOf = (chat: { id: string }) => Number(chat.id);
  const remember = (person: Person) => state.names.set(person.id, person.name);

  function toEvent(event: HumanEvent): VkEvent {
    const event_id = `ev${state.nextEventId++}`;
    const wrap = (type: string, object: unknown): VkEvent => ({ type, event_id, v: "5.199", object, group_id: VK_GROUP_ID });
    const messageNew = (peerId: number, fromId: number, extra: Record<string, unknown>) =>
      wrap("message_new", { message: { id: state.nextId++, date: 1_700_000_000, peer_id: peerId, from_id: fromId, text: "", random_id: 0, conversation_message_id: 1, attachments: [], ...extra }, client_info: {} });
    switch (event.type) {
      case "text": {
        remember(event.from);
        const text = event.mentionsBot ? `[club${VK_GROUP_ID}|@${VK_GROUP_SCREEN_NAME}] ${event.text}` : event.text;
        return messageNew(peerOf(event.chat), Number(event.from.id), {
          text,
          ...(event.repliesToBot && { reply_message: { id: 1, from_id: -VK_GROUP_ID, peer_id: peerOf(event.chat), text: "", date: 1 } }),
        });
      }
      case "start":
        remember(event.from);
        return event.payload
          ? messageNew(Number(event.from.id), Number(event.from.id), { text: "Начать", ref: event.payload, ref_source: "link" })
          : messageNew(Number(event.from.id), Number(event.from.id), { text: "Начать", payload: JSON.stringify({ command: "start" }) });
      case "press":
        remember(event.from);
        return wrap("message_event", { user_id: Number(event.from.id), peer_id: peerOf(event.chat), event_id, payload: JSON.parse(event.data) as unknown, conversation_message_id: Number(event.messageId) });
      case "voice": {
        remember(event.from);
        const path = `/files/voice-${state.nextId++}.ogg`;
        state.files.set(path, { bytes: event.audio, type: "audio/ogg" });
        return messageNew(peerOf(event.chat), Number(event.from.id), {
          attachments: [{ type: "audio_message", audio_message: { id: 1, owner_id: Number(event.from.id), duration: Math.round(event.durationMs / 1000), link_ogg: `${baseUrl}${path}`, link_mp3: `${baseUrl}${path}.mp3`, access_key: "k" } }],
        });
      }
      case "file": {
        remember(event.from);
        const path = `/files/${state.nextId++}/${event.name}`;
        state.files.set(path, { bytes: event.bytes, type: event.mediaType });
        const isPhoto = event.name === "photo.jpg";
        const attachment = isPhoto
          ? { type: "photo", photo: { id: 1, owner_id: 1, sizes: [{ type: "s", url: `${baseUrl}${path}?small`, width: 75, height: 75 }, { type: "x", url: `${baseUrl}${path}`, width: 800, height: 800 }] } }
          : { type: "doc", doc: { id: 1, owner_id: 1, title: event.name, ext: event.name.split(".").pop(), size: event.bytes.length, url: `${baseUrl}${path}` } };
        return messageNew(peerOf(event.chat), Number(event.from.id), { text: event.caption ?? "", attachments: [attachment] });
      }
      case "bot_added":
      case "bot_removed":
        remember(event.by);
        return messageNew(peerOf(event.chat), Number(event.by.id), { action: { type: event.type === "bot_added" ? "chat_invite_user" : "chat_kick_user", member_id: -VK_GROUP_ID } });
      case "blocked":
        return wrap("message_deny", { user_id: Number(event.from.id) });
      case "allowed":
        return wrap("message_allow", { user_id: Number(event.from.id), key: "" });
    }
  }

  return {
    url: server.url,
    token,
    state,
    close: server.close,
    enqueue(event: HumanEvent) {
      const vkEvent = toEvent(event);
      state.lpEvents.push(vkEvent);
      return vkEvent;
    },
    /** Тело Callback API (без секрета: его добавляет тот, кто вызывает). */
    callbackBody(event: HumanEvent, secret: string | undefined = VK_SECRET) {
      return { ...toEvent(event), ...(secret !== undefined && { secret }) };
    },
    failNext(methodName: string, failure: { code: number; message: string }) {
      state.failures.set(methodName, [...(state.failures.get(methodName) ?? []), failure]);
    },
    names: state.names,
  };
}

export type FakeVk = Awaited<ReturnType<typeof startFakeVk>>;

/** Поддельный VK как `AdapterRig` для общих тестов. */
export async function createVkRig(createAdapter: (api: { baseUrl: string }, receive: { callback: { secret: string; confirmation: string } } | { longPoll: true }) => MessengerAdapter): Promise<AdapterRig & { fake: FakeVk }> {
  const fake = await startFakeVk();
  const api = { baseUrl: fake.url };
  const callbackAdapter = createAdapter(api, { callback: { secret: VK_SECRET, confirmation: VK_CONFIRMATION } });
  const pollAdapter = createAdapter(api, { longPoll: true });
  return {
    messenger: "vk",
    botId: String(VK_GROUP_ID),
    adapter: callbackAdapter,
    anna,
    boris,
    chats: { annaPrivate: { id: anna.id, type: "private" }, group: { id: String(VK_GROUP_PEER), type: "group" } },
    fake,
    async deliver(event) {
      const { updates } = await callbackAdapter.readWebhook(new Request("http://app/vk/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fake.callbackBody(event)) }));
      return updates;
    },
    // Секрет VK — в теле: тело-заглушка без него, но предел размера проверяется раньше секрета.
    signedWebhook: (body) => new Request("http://app/vk/callback", { method: "POST", headers: { "content-type": "application/json" }, body }),
    async poll(events) {
      for (const event of events) fake.enqueue(event);
      return collectPolled(pollAdapter, events.length);
    },
    get outgoing() {
      return fake.state.messages;
    },
    get answers() {
      return fake.state.eventAnswers;
    },
    commands: [],
    commandScopes: [],
    allowedArrivesAsStart: false,
    get typing() {
      return fake.state.activities;
    },
    rejectNextVoice() {
      fake.state.rejectVoice = true;
    },
    close: fake.close,
  };
}
