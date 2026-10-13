import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverAnswer } from "../src/answer-delivery";
import { createButtonActions } from "../src/button-actions";
import type { AnswerChunk } from "../src/chat-port";
import { createMessengers } from "../src/create-messengers";
import { maxBot } from "../src/max";
import type { InboundUpdate } from "../src/messenger-adapter";
import { createTextsLookup, defaultMessengerTexts, type MessengerTexts } from "../src/messenger-texts";
import { createOutboundQueue } from "../src/outbound-queue";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import { telegramBot } from "../src/telegram";
import type { MessengerBot, MessengersOptions } from "../src/types";
import { vkBot } from "../src/vk";
import { account, createFakeAdapter, groupChat, privateChat, update } from "./support/fake-adapter";
import { controlledStream, createFakeChatService, streamOf, textAnswer } from "./support/fake-chat-service";

const BASE = "/api/messengers";
const NOTIFY = "Это бот уведомлений «Мой сервис». Писать сюда не нужно.";

/** Все фразы пустые: строки — "", фразы-функции возвращают "". */
const silence = Object.fromEntries(
  Object.entries(defaultMessengerTexts).map(([name, value]) => [name, typeof value === "function" ? () => "" : ""]),
) as unknown as MessengerTexts;

function setup(overrides: Partial<MessengersOptions> & { bot?: Partial<MessengerBot> } = {}) {
  const { bot: botOverrides, ...options } = overrides;
  const fake = createFakeAdapter();
  const store = createMemoryMessengerStore();
  const chats = createFakeChatService();
  const errors: unknown[] = [];
  const messengers = createMessengers({
    service: chats.service,
    store,
    resolveUser: async (request) => (request.headers.get("x-user") ? { id: request.headers.get("x-user") as string } : null),
    bots: [fake.bot(botOverrides)],
    basePath: BASE,
    logError: (error) => errors.push(error),
    ...options,
  });
  const link = (externalUserId = "100", userId = "anna", name = "Анна") =>
    store.saveLink({ messenger: "telegram", botId: "bot1", externalUserId, userId, name, linkedAt: new Date().toISOString() });
  const post = (updates: InboundUpdate[]) =>
    messengers.handler.fetch(
      new Request(`http://app${BASE}/telegram/webhook`, { method: "POST", headers: { "x-secret": "webhook-secret", "content-type": "application/json" }, body: JSON.stringify({ updates }) }),
    );
  const settle = async () => {
    let finished = false;
    const done = messengers.flush().then(() => {
      finished = true;
    });
    for (let step = 0; step < 100 && !finished; step++) await vi.advanceTimersByTimeAsync(500);
    await done;
  };
  const issueCode = async () => {
    const offer = await messengers.handler.fetch(
      new Request(`http://app${BASE}/links`, { method: "POST", headers: { "x-user": "anna", "content-type": "application/json" }, body: JSON.stringify({ messenger: "telegram" }) }),
    );
    return ((await offer.json()) as { code: string }).code;
  };
  return { fake, store, chats, errors, messengers, link, post, settle, issueCode };
}

const command = (text: string, extra: Partial<InboundUpdate> = {}) => update({ kind: "command", text, ...extra });
const mention = { mentioned: true, replyToBot: false };

describe("фразы бота из настроек", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("без настройки — фразы 0.29.0", async () => {
    const { fake, post, settle } = setup();
    await post([update({ text: "Привет" }), command("/link AAAAAAAAAAAAAAAAAAAAAA")]);
    await settle();
    expect(fake.texts()).toEqual([
      "Чтобы я отвечал, подключите этот аккаунт: в приложении нажмите «Подключить» и откройте ссылку.",
      "Код не подошёл или устарел. Возьмите новую ссылку в приложении.",
    ]);
    expect(defaultMessengerTexts.linked).toBe("Готово: аккаунт подключён.");
    expect(defaultMessengerTexts.writeInPrivate).toBe("Пишите мне в личные сообщения.");
    expect(defaultMessengerTexts.fileRefused("busy")).toBe("Файл не принят: сейчас много загрузок, пришлите чуть позже.");
  });

  it("свои фразы из createMessengers: непривязанному и после привязки", async () => {
    const { fake, post, settle, issueCode } = setup({ texts: { howToConnect: NOTIFY, linked: "Уведомления включены.", linkFailed: "Ссылка устарела." } });
    await post([update({ text: "Привет" }), command("/help"), command("/start"), command("/link AAAAAAAAAAAAAAAAAAAAAA")]);
    await settle();
    await post([command(`/start ${await issueCode()}`)]);
    await settle();
    expect(fake.texts()).toEqual([NOTIFY, NOTIFY, NOTIFY, "Ссылка устарела.", "Уведомления включены."]);
  });

  it("бот перекрывает общую настройку; чего у бота нет — из общей, чего нет и там — по умолчанию", async () => {
    const { fake, post, settle } = setup({
      texts: { howToConnect: "Общая фраза", linkFailed: "Общий отказ" },
      bot: { texts: { howToConnect: "Фраза бота" } },
    });
    await post([update({ text: "Привет" }), command("/link AAAAAAAAAAAAAAAAAAAAAA")]);
    await settle();
    await post([update({ chat: groupChat, text: "@bot", group: mention })]);
    await settle();
    expect(fake.texts()).toEqual(["Фраза бота", "Общий отказ", defaultMessengerTexts.writeInPrivate]);
  });

  it("фраза-функция из настроек получает свои данные", async () => {
    const { fake, chats, link, post, settle } = setup({ texts: { limitReached: (limit) => `Лимит до ${limit.resetsAt ?? "∞"}` } });
    await link();
    chats.service.respond = () => {
      throw new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: "2026-10-06T00:00:00.000Z" });
    };
    await post([update({ text: "Ещё" })]);
    await settle();
    expect(fake.texts()).toEqual(["Лимит до 2026-10-06T00:00:00.000Z"]);
  });

  it("/stop от непривязанного — тот же отказ resolveAccount, что у сообщения; пустой отказ — тишина", async () => {
    const refusing = setup({ resolveAccount: async () => ({ refuse: NOTIFY }) });
    await refusing.post([command("/stop")]);
    await refusing.settle();
    expect(refusing.fake.texts()).toEqual([NOTIFY]);

    const quiet = setup({ resolveAccount: async () => ({ refuse: "" }) });
    await quiet.post([command("/stop"), command("/help"), command("/start"), update({ text: "Привет" })]);
    await quiet.settle();
    expect(quiet.fake.sent).toEqual([]);
    expect(quiet.chats.stops).toEqual([]);
  });

  it("/stop от непривязанного без resolveAccount — настраиваемая howToConnect; пустая — тишина", async () => {
    const custom = setup({ texts: { howToConnect: NOTIFY } });
    await custom.post([command("/stop")]);
    await custom.settle();
    expect(custom.fake.texts()).toEqual([NOTIFY]);

    const quiet = setup({ texts: { howToConnect: "" } });
    await quiet.post([command("/stop")]);
    await quiet.settle();
    expect(quiet.fake.sent).toEqual([]);
  });

  it("кнопка от непривязанного: отказ resolveAccount, пустой — ни сообщения, ни ответа на нажатие", async () => {
    const { fake, post, settle } = setup({ resolveAccount: async () => ({ refuse: "" }) });
    await post([update({ kind: "button", text: undefined, buttonId: "ABCDEFGH", callbackId: "cb1" })]);
    await settle();
    expect(fake.sent).toEqual([]);
    expect(fake.answers).toEqual([]);
  });

  it("все фразы пустые — непривязанному бот молчит на каждом пути (личка, команды, файлы, голос, кнопки, группы)", async () => {
    const off = setup({ texts: silence, conversations: "many", transcribe: async () => ({ text: "x" }) });
    await off.post([
      update({ text: "Привет" }),
      command("/start"),
      command("/start AAAAAAAAAAAAAAAAAAAAAA"),
      command("/link плохой-код"),
      command("/help"),
      command("/new"),
      command("/chats"),
      command("/stop"),
      update({ kind: "voice", text: undefined, files: [{ fileId: "v1", size: 3 }] }),
      update({ kind: "files", text: undefined, files: [{ fileId: "f1", name: "x.pdf", size: 1 }] }),
      update({ kind: "button", text: undefined, buttonId: "ABCDEFGH", callbackId: "cb1" }),
      update({ chat: groupChat, text: "@bot привет", group: mention }),
    ]);
    await off.settle();
    expect(off.fake.sent).toEqual([]);
    expect(off.fake.answers).toEqual([]);
    expect(off.errors).toEqual([]);

    const groups = setup({ texts: silence, groups: {} });
    const stranger = account({ externalUserId: "300", name: "Гость" });
    await groups.post([
      update({ chat: groupChat, kind: "bot_added", text: undefined, account: stranger }),
      command("/connect", { chat: groupChat, account: stranger }),
      command("/disconnect", { chat: groupChat, account: stranger }),
      command("/help", { chat: groupChat, account: stranger }),
      command("/stop", { chat: groupChat, account: stranger }),
      update({ chat: groupChat, text: "@bot привет", group: mention, account: stranger }),
      update({ chat: groupChat, kind: "button", text: undefined, buttonId: "ABCDEFGH", callbackId: "cb2", account: stranger }),
    ]);
    await groups.settle();
    expect(groups.fake.sent).toEqual([]);
    expect(groups.fake.answers).toEqual([]);
  });

  it("пустые фразы и у привязанного: файлы и голос выключены, старая кнопка, лимит — тишина", async () => {
    const { fake, chats, link, post, settle } = setup({ texts: silence });
    await link();
    await post([
      update({ kind: "voice", text: undefined, files: [{ fileId: "v1", size: 3 }] }),
      update({ kind: "files", text: undefined, files: [{ fileId: "f1", name: "x.pdf", size: 1 }] }),
      update({ kind: "button", text: undefined, buttonId: "ABCDEFGH", callbackId: "cb1" }),
      command("/help"),
      command("/stop"),
    ]);
    await settle();
    chats.service.respond = () => {
      throw new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null });
    };
    await post([update({ text: "Ещё" })]);
    await settle();
    expect(fake.sent).toEqual([]);
    expect(fake.answers).toEqual([]);

    // Ответ агента фразой не является: он уходит как обычно.
    chats.service.respond = () => streamOf(textAnswer("Ответ агента"));
    await post([update({ text: "Вопрос" })]);
    await settle();
    expect(fake.texts()).toEqual(["Ответ агента"]);
  });

  it("молчащий бот только для привязки: тишина везде, кроме фразы после удачной привязки", async () => {
    const { fake, post, settle, issueCode } = setup({
      resolveAccount: async () => ({ refuse: "" }),
      bot: { texts: { linkFailed: "", writeInPrivate: "", linked: "Аккаунт привязан." } },
    });
    await post([update({ text: "Привет" }), command("/stop"), command("/link плохой-код"), update({ chat: groupChat, text: "@bot", group: mention })]);
    await settle();
    expect(fake.sent).toEqual([]);
    await post([command(`/start ${await issueCode()}`)]);
    await post([update({ text: "А теперь?" }), command("/stop")]);
    await settle();
    expect(fake.texts()).toEqual(["Аккаунт привязан."]);
  });

  it("telegramBot, vkBot и maxBot принимают свои фразы", () => {
    const texts = { howToConnect: NOTIFY };
    expect(telegramBot({ token: "123:abc", username: "app_bot", receive: { polling: true }, texts }).texts).toEqual(texts);
    expect(vkBot({ token: "t", groupId: 1, groupScreenName: "app", receive: { longPoll: true }, texts }).texts).toEqual(texts);
    expect(maxBot({ token: "t", botName: "app_bot", receive: { polling: true }, texts }).texts).toEqual(texts);
    expect(telegramBot({ token: "123:abc", username: "app_bot", receive: { polling: true } }).texts).toBeUndefined();
  });
});

/** Доставка одного ответа со своими фразами — без шлюза, чтобы видеть сообщение статуса и кнопки. */
function delivery(texts: Partial<MessengerTexts>) {
  const fake = createFakeAdapter();
  const store = createMemoryMessengerStore();
  const service = createFakeChatService();
  const textsOf = createTextsLookup([], texts);
  const queue = createOutboundQueue({ gapMs: fake.adapter.abilities.editEveryMs });
  const buttons = createButtonActions({ store, service: service.service, textsOf });
  const key = { messenger: "telegram", botId: "bot1", externalChatId: "100" } as const;
  const deliver = (stream: ReadableStream<AnswerChunk>, signal?: AbortSignal) =>
    deliverAnswer({ adapter: fake.adapter, chat: privateChat, chatKey: "telegram/bot1/100", queue, buttons, key, chatId: "chat-1", stream, texts: textsOf(key), ...(signal && { signal }) });
  const press = (buttonId: string) => buttons.press({ key, adapter: fake.adapter, ownerId: "anna", press: { chat: privateChat, account: account(), buttonId, callbackId: "cb" } });
  return { fake, service, deliver, press };
}

const toolStart = (toolCallId: string, toolName: string): AnswerChunk => ({ type: "tool-input-start", toolCallId, toolName });
const approvalAnswer = (): AnswerChunk[] => [
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Отправлю письмо." },
  toolStart("c1", "send_email"),
  { type: "tool-input-available", toolCallId: "c1", toolName: "send_email", input: { to: "x@y.z" } },
  { type: "tool-approval-request", approvalId: "ap1", toolCallId: "c1" },
  { type: "finish" },
];

describe("пустые фразы у привязанного: без вечных спиннеров и статусов", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("пустая «accepted» — нажатие своей кнопки подтверждается без текста; неизвестная кнопка с пустой фразой — без ответа", async () => {
    const { fake, service, deliver, press } = delivery({ accepted: "", alreadyAnswered: "" });
    await deliver(streamOf(approvalAnswer()));
    const allow = fake.sent[1]?.message.buttons?.[0]?.[0]?.id as string;
    await press(allow);
    expect(service.approvals).toHaveLength(1);
    expect(fake.answers.map((answer) => answer.text)).toEqual([undefined]);
    expect(fake.texts()).toEqual(["Отправлю письмо.", "Нужно ваше разрешение: send_email."]);
    await press("ABCDEFGH");
    expect(fake.answers).toHaveLength(1);
  });

  it("пустые «done», «stopped», «answerFailed» — сообщение статуса удаляется, а не висит", async () => {
    const quiet = { done: "", stopped: "", answerFailed: "" };

    const finished = delivery(quiet);
    await finished.deliver(streamOf([{ type: "start", messageId: "a1" }, toolStart("c1", "web_search"), { type: "tool-output-available", toolCallId: "c1", output: "ok" }, { type: "finish" }]));
    expect(finished.fake.sent.map((item) => item.message.text)).toEqual(["Ищу в интернете…"]);
    expect(finished.fake.deleted.map((item) => item.messageId)).toEqual([finished.fake.sent[0]?.messageId]);
    expect(finished.fake.texts()).toEqual([]);

    const stopped = delivery(quiet);
    const live = controlledStream();
    const abort = new AbortController();
    const done = stopped.deliver(live.stream, abort.signal);
    live.push({ type: "start", messageId: "a1" }, toolStart("c1", "web_search"));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped.fake.texts()).toEqual(["Ищу в интернете…"]);
    abort.abort();
    expect((await done).status).toBe("stopped");
    expect(stopped.fake.texts()).toEqual([]);

    const failed = delivery(quiet);
    await failed.deliver(streamOf([{ type: "start", messageId: "a1" }, toolStart("c1", "web_search"), { type: "error", errorText: "boom" }]));
    expect(failed.fake.deleted).toHaveLength(1);
    expect(failed.fake.texts()).toEqual([]);
  });

  it("адаптер не умеет удалять — статус остаётся как есть, ошибок нет", async () => {
    const { fake, deliver } = delivery({ done: "" });
    delete (fake.adapter as { deleteMessage?: unknown }).deleteMessage;
    const outcome = await deliver(streamOf([{ type: "start", messageId: "a1" }, toolStart("c1", "web_search"), { type: "finish" }]));
    expect(outcome.status).toBe("finished");
    expect(fake.texts()).toEqual(["Ищу в интернете…"]);
  });

  it("сообщения с кнопками не глушатся: пустой вопрос разрешения, заголовок /chats и вопрос задачи — фраза по умолчанию", async () => {
    const texts = createTextsLookup([], { chatsTitle: "", approvalQuestion: () => "", taskApprovalQuestion: () => "" })({ messenger: "telegram", botId: "bot1" });
    expect(texts.chatsTitle).toBe(defaultMessengerTexts.chatsTitle);
    expect(texts.approvalQuestion("send_email")).toBe(defaultMessengerTexts.approvalQuestion("send_email"));
    expect(texts.taskApprovalQuestion("Отчёт", "send_email")).toBe(defaultMessengerTexts.taskApprovalQuestion("Отчёт", "send_email"));

    const { fake, deliver } = delivery({ approvalQuestion: () => "" });
    await deliver(streamOf(approvalAnswer()));
    expect(fake.texts()).toEqual(["Отправлю письмо.", "Нужно ваше разрешение: send_email."]);
    expect(fake.sent[1]?.message.buttons).toBeDefined();

    const chats = setup({ conversations: "many", texts: { chatsTitle: "" } });
    await chats.link();
    await chats.chats.service.createChat("anna", { origin: "web" });
    await chats.post([command("/chats")]);
    await chats.settle();
    expect(chats.fake.texts()).toEqual([defaultMessengerTexts.chatsTitle]);
    expect(chats.fake.sent[0]?.message.buttons?.length).toBeGreaterThan(0);
  });
});
