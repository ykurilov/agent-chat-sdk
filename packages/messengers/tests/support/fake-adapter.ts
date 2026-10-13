import type {
  BotCommand,
  ButtonPress,
  ExternalAccount,
  ExternalChat,
  InboundFile,
  InboundUpdate,
  MessengerAbilities,
  MessengerAdapter,
  MessengerName,
  OutboundMessage,
  SentMessage,
} from "../../src/messenger-adapter";
import type { MessengerBot } from "../../src/types";

export interface SentRecord {
  chat: ExternalChat;
  message: OutboundMessage;
  messageId: string;
}

/** Поддельный адаптер: пишет каждый вызов, ошибки подкладываются заранее. */
export function createFakeAdapter(options: { messenger?: MessengerName; abilities?: Partial<MessengerAbilities>; files?: Record<string, Uint8Array> } = {}) {
  const messenger = options.messenger ?? "telegram";
  const abilities: MessengerAbilities = { textLimit: 4096, liveText: "edit", editEveryMs: 1000, markup: "html", commandsMenu: true, ...options.abilities };
  let nextId = 1;
  const sent: SentRecord[] = [];
  const edits: Array<{ sent: SentMessage; message: OutboundMessage }> = [];
  const drafts: Array<{ chat: ExternalChat; draftId: number; text: string; at: number }> = [];
  const answers: Array<{ press: ButtonPress; text?: string }> = [];
  const deleted: SentMessage[] = [];
  const typing: Array<{ chat: ExternalChat; at: number }> = [];
  const commands: Array<{ commands: BotCommand[]; scope: "private" | "group" }> = [];
  const voices: Array<{ chat: ExternalChat; voice: { audio: Uint8Array; durationMs: number } }> = [];
  const downloads: InboundFile[] = [];
  /** Ошибки следующих вызовов по виду: первая из очереди бросается вместо вызова. */
  const failures: Record<"send" | "edit" | "draft" | "sendVoice", unknown[]> = { send: [], edit: [], draft: [], sendVoice: [] };
  const pollQueue: InboundUpdate[] = [];
  let pollWake: (() => void) | undefined;
  let polling = 0;

  const takeFailure = (kind: keyof typeof failures) => {
    const failure = failures[kind].shift();
    if (failure !== undefined) throw typeof failure === "function" ? (failure as () => unknown)() : failure;
  };

  const adapter: MessengerAdapter & { draft: NonNullable<MessengerAdapter["draft"]> } = {
    messenger,
    abilities,
    async readWebhook(request) {
      if (request.headers.get("x-secret") !== "webhook-secret") return { response: new Response("forbidden", { status: 403 }), updates: [] };
      const body = (await request.json()) as { updates: InboundUpdate[] };
      return { response: new Response("ok"), updates: body.updates };
    },
    async *poll(signal) {
      polling++;
      try {
        while (!signal.aborted) {
          const update = pollQueue.shift();
          if (update) {
            yield update;
            continue;
          }
          await new Promise<void>((resolve) => {
            pollWake = resolve;
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
      } finally {
        polling--;
      }
    },
    async send(chat, message) {
      takeFailure("send");
      const record = { chat, message: structuredClone(message), messageId: `m${nextId++}` };
      sent.push(record);
      return { chat, messageId: record.messageId };
    },
    async edit(target, message) {
      takeFailure("edit");
      edits.push({ sent: target, message: structuredClone(message) });
    },
    async deleteMessage(target) {
      deleted.push(target);
    },
    async draft(chat, draftId, text) {
      takeFailure("draft");
      drafts.push({ chat, draftId, text, at: Date.now() });
    },
    async answerButton(press, text) {
      answers.push({ press, ...(text !== undefined && { text }) });
    },
    async typing(chat) {
      typing.push({ chat, at: Date.now() });
    },
    async downloadFile(file) {
      downloads.push(file);
      return { bytes: options.files?.[file.fileId] ?? new Uint8Array([1, 2, 3]), name: file.name ?? "file.bin", mediaType: file.mediaType ?? "application/octet-stream" };
    },
    async setCommands(list, scope) {
      commands.push({ commands: list, scope });
    },
    async sendVoice(chat, voice) {
      takeFailure("sendVoice");
      voices.push({ chat, voice });
      return { chat, messageId: `v${nextId++}` };
    },
    linkUrl(code) {
      return `https://t.me/test_bot?start=${code}`;
    },
  };

  /** Текст сообщения, каким его видит человек сейчас: последняя правка или исходный. */
  const visibleText = (messageId: string) => {
    const edit = edits.filter((item) => item.sent.messageId === messageId).at(-1);
    return edit?.message.text ?? sent.find((item) => item.messageId === messageId)?.message.text;
  };

  return {
    adapter,
    sent,
    edits,
    drafts,
    answers,
    deleted,
    typing,
    commands,
    voices,
    downloads,
    failures,
    visibleText,
    /** Тексты отправленных и не удалённых сообщений, как они видны сейчас. */
    texts: () => sent.filter((item) => !deleted.some((gone) => gone.messageId === item.messageId)).map((item) => visibleText(item.messageId)),
    pushPoll(update: InboundUpdate) {
      pollQueue.push(update);
      pollWake?.();
    },
    get polling() {
      return polling;
    },
    bot(overrides: Partial<MessengerBot> = {}): MessengerBot {
      return { messenger, botId: "bot1", receive: "webhook", adapter, ...overrides };
    },
  };
}

export type FakeAdapter = ReturnType<typeof createFakeAdapter>;

let updateCounter = 0;

export const privateChat: ExternalChat = { id: "100", type: "private" };
export const groupChat: ExternalChat = { id: "-500", type: "group" };

export function account(overrides: Partial<ExternalAccount> = {}): ExternalAccount {
  return { messenger: "telegram", botId: "bot1", externalUserId: "100", name: "Анна", username: "anna_tg", ...overrides };
}

/** Обновление с уникальным ключом повтора. */
export function update(overrides: Partial<InboundUpdate> = {}): InboundUpdate {
  updateCounter++;
  return { key: `telegram:bot1:${updateCounter}`, account: account(), chat: privateChat, kind: "text", text: "Привет", ...overrides };
}
