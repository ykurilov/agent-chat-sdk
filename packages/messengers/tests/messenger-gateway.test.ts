import { ActionForbiddenError, ChatBusyError, ChatClosedError, SpendingLimitReachedError, TurnRefusedError } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMessengers } from "../src/create-messengers";
import { MessengerRateLimitError } from "../src/messenger-api";
import type { InboundUpdate } from "../src/messenger-adapter";
import { messengerTexts } from "../src/messenger-texts";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { ConversationKey, MessengerBot, MessengersOptions } from "../src/types";
import { account, createFakeAdapter, groupChat, privateChat, update } from "./support/fake-adapter";
import { controlledStream, createFakeChatService, streamOf, textAnswer } from "./support/fake-chat-service";

const NOW = Date.UTC(2026, 9, 5, 12, 0);
const BASE = "/api/messengers";
const key: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: privateChat.id };

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
  const post = (updates: InboundUpdate[], secret = "webhook-secret") =>
    messengers.handler.fetch(
      new Request(`http://app${BASE}/telegram/webhook`, { method: "POST", headers: { "x-secret": secret, "content-type": "application/json" }, body: JSON.stringify({ updates }) }),
    );
  /** Ждёт конца всей работы, двигая поддельные часы (паузы очереди, «печатает…»). */
  const settle = async () => {
    let finished = false;
    const done = messengers.flush().then(() => {
      finished = true;
    });
    for (let step = 0; step < 100 && !finished; step++) await vi.advanceTimersByTimeAsync(500);
    await done;
  };
  return { fake, store, chats, errors, messengers, link, post, settle };
}

describe("шлюз мессенджеров", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("вебхук: чужой секрет — отказ и ничего не обработано; свой — ответ сразу, повтор обновления не обрабатывается", async () => {
    const { fake, chats, link, post, settle } = setup();
    await link();
    expect((await post([update()], "wrong")).status).toBe(403);
    await settle();
    expect(fake.sent).toEqual([]);

    const live = controlledStream();
    chats.service.respond = () => live.stream;
    const message = update({ text: "Как дела?" });
    const response = await post([message]);
    expect(response.status).toBe(200);
    expect(await post([message])).toHaveProperty("status", 200);
    await vi.advanceTimersByTimeAsync(0);
    // Ответ агента ещё идёт, а мессенджер уже получил «ok».
    expect(chats.sent).toHaveLength(1);
    live.push(...textAnswer("Отлично"));
    live.close();
    await settle();
    expect(chats.sent).toHaveLength(1);
    expect(fake.texts()).toEqual(["Отлично"]);
  });

  it("сломанное тело вебхука — 400 и запись в журнал; чужой адрес — 404", async () => {
    const { messengers, errors } = setup();
    const broken = await messengers.handler.fetch(new Request(`http://app${BASE}/telegram/webhook`, { method: "POST", headers: { "x-secret": "webhook-secret" }, body: "{" }));
    expect(broken.status).toBe(400);
    expect(errors).toHaveLength(1);
    expect((await messengers.handler.fetch(new Request(`http://app${BASE}/vk/callback`, { method: "POST" }))).status).toBe(404);
    expect((await messengers.handler.fetch(new Request(`http://app/other`, { method: "POST" }))).status).toBe(404);
    expect(messengers.handler.basePath).toBe(BASE);
  });

  it("непривязанный — как подключиться; привязка через /links и /start <код>; дальше — ответ агента в новом чате", async () => {
    const { fake, chats, store, messengers, post, settle } = setup();
    await post([update({ text: "Привет" })]);
    await settle();
    expect(fake.texts()).toEqual([messengerTexts.howToConnect]);

    const offer = await messengers.handler.fetch(
      new Request(`http://app${BASE}/links`, { method: "POST", headers: { "x-user": "anna", "content-type": "application/json" }, body: JSON.stringify({ messenger: "telegram" }) }),
    );
    const { code } = (await offer.json()) as { code: string };
    await post([update({ kind: "command", text: `/start ${code}` })]);
    await settle();
    expect(fake.texts().at(-1)).toBe(messengerTexts.linked);

    await post([update({ text: "Что нового?" })]);
    await settle();
    expect(chats.sent).toEqual([
      { userId: "anna", chatId: "chat-1", message: { id: expect.any(String), role: "user", parts: [{ type: "text", text: "Что нового?" }] }, options: { channel: "telegram" } },
    ]);
    expect(fake.texts().at(-1)).toBe("Ответ");
    expect(await store.getConversation(key)).toMatchObject({ userId: "anna", currentChatId: "chat-1", type: "private" });
  });

  it("onLinked из настроек: сигнал приходит с записью привязки; его сбой уходит в logError, человеку — «привязано»", async () => {
    const failure = new Error("награда не выдана");
    const onLinked = vi.fn().mockRejectedValue(failure);
    const { fake, errors, store, messengers, post, settle } = setup({ onLinked });
    const offer = await messengers.handler.fetch(
      new Request(`http://app${BASE}/links`, { method: "POST", headers: { "x-user": "anna", "content-type": "application/json" }, body: JSON.stringify({ messenger: "telegram" }) }),
    );
    const { code } = (await offer.json()) as { code: string };
    await post([update({ kind: "command", text: `/start ${code}` })]);
    await settle();
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(onLinked).toHaveBeenCalledWith(await store.findLink("telegram", "bot1", "100"));
    expect(errors).toEqual([failure]);
    expect(fake.texts().at(-1)).toBe(messengerTexts.linked);
  });

  it("сообщения одного разговора — по одному: второе ждёт конца первого ответа", async () => {
    const { fake, chats, link, post, settle } = setup();
    await link();
    const first = controlledStream();
    let calls = 0;
    chats.service.respond = () => (++calls === 1 ? first.stream : streamOf(textAnswer("Второй ответ", "answer-2")));
    await post([update({ text: "Первое" })]);
    await vi.advanceTimersByTimeAsync(0);
    await post([update({ text: "Второе" })]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(chats.sent.map((call) => call.message.parts)).toEqual([[{ type: "text", text: "Первое" }]]);
    first.push(...textAnswer("Первый ответ"));
    first.close();
    await settle();
    expect(chats.sent).toHaveLength(2);
    expect(fake.texts()).toEqual(["Первый ответ", "Второй ответ"]);
  });

  it("/stop во время ответа — сразу, мимо очереди: ход остановлен, «остановлено»; нечего останавливать — так и говорим", async () => {
    const { fake, chats, link, post, settle } = setup();
    await link();
    const live = controlledStream();
    chats.service.respond = () => live.stream;
    await post([update({ text: "Расскажи длинно" })]);
    await vi.advanceTimersByTimeAsync(0);
    live.push({ type: "start", messageId: "a1" }, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "Начало длинного ответа, которое уже видно человеку" });
    await vi.advanceTimersByTimeAsync(100);
    await post([update({ kind: "command", text: "/stop" })]);
    await settle();
    expect(chats.stops).toEqual([{ userId: "anna", chatId: "chat-1" }]);
    expect(fake.texts().at(-1)).toBe(messengerTexts.stopped);

    chats.service.stopResult = false;
    await post([update({ kind: "command", text: "/stop" })]);
    await settle();
    expect(fake.texts().at(-1)).toBe(messengerTexts.nothingToStop);
  });

  it("/help — подсказка режима; /start без кода — приветствие; меню команд ставится при start()", async () => {
    const { fake, link, post, settle, messengers } = setup();
    await link();
    await messengers.start();
    expect(fake.commands.map((item) => [item.scope, item.commands.map((entry) => entry.command)])).toEqual([["private", ["help", "stop"]]]);
    await post([update({ kind: "command", text: "/help" })]);
    await post([update({ kind: "command", text: "/start" })]);
    await settle();
    expect(fake.texts()).toEqual([messengerTexts.helpSingle, messengerTexts.hello]);
  });

  it("blocked и allowed меняют отметку разговора; заблокированный при отправке тоже помечается", async () => {
    const { store, link, post, settle } = setup();
    await link();
    await post([update({ text: "Привет" })]);
    await settle();
    await post([update({ kind: "blocked" })]);
    await settle();
    expect((await store.getConversation(key))?.blocked).toBe(true);
    await post([update({ kind: "allowed" })]);
    await settle();
    expect((await store.getConversation(key))?.blocked).toBe(false);
  });

  it("текущий чат удалён — новый чат по правилу приложения, сообщение уходит туда", async () => {
    const { chats, link, post, settle, fake } = setup();
    await link();
    await post([update({ text: "Раз" })]);
    await settle();
    chats.chats.delete("chat-1");
    await post([update({ text: "Два" })]);
    await settle();
    expect(chats.sent.map((call) => call.chatId)).toEqual(["chat-1", "chat-2"]);
    expect(fake.texts()).toEqual(["Ответ", "Ответ"]);
  });

  it("чат занят чужим ходом — ждём его конца и пробуем снова; лимит расходов — понятный ответ", async () => {
    const { chats, link, post, settle, fake } = setup();
    await link();
    let calls = 0;
    chats.service.respond = () => {
      calls++;
      if (calls === 1) throw new ChatBusyError("chat-1");
      return streamOf(textAnswer("После паузы"));
    };
    await post([update({ text: "Привет" })]);
    await settle();
    expect(calls).toBe(2);
    expect(fake.texts()).toEqual(["После паузы"]);

    chats.service.respond = () => {
      throw new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: "2026-10-06T00:00:00.000Z", timeZone: "Europe/Moscow" });
    };
    await post([update({ text: "Ещё" })]);
    await settle();
    expect(fake.texts().at(-1)).toBe("Лимит расходов исчерпан. Снова можно будет писать 6 октября в 03:00.");

    chats.service.respond = () => {
      throw new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: "2026-10-06T00:00:00.000Z", timeZone: "Europe/Moscow", unit: "messages" });
    };
    await post([update({ text: "И ещё" })]);
    await settle();
    expect(fake.texts().at(-1)).toBe("Лимит сообщений исчерпан. Снова можно будет писать 6 октября в 03:00.");
  });

  it("приложение отказало в ходе — человеку текст отказа, в журнал как сбой не пишется", async () => {
    const { chats, errors, link, post, settle, fake } = setup();
    await link();
    chats.service.respond = () => {
      throw new TurnRefusedError({ code: "lesson_closed", message: "Урок закрыт" });
    };
    await post([update({ text: "Привет" })]);
    await settle();
    expect(fake.texts()).toEqual(["Урок закрыт"]);
    expect(errors).toEqual([]);
  });

  it("чат закрыт или действие запрещено правами — человеку текст, в журнал как сбой не пишется", async () => {
    const { chats, errors, link, post, settle, fake } = setup();
    await link();
    chats.service.respond = () => {
      throw new ChatClosedError({ code: "form_completed", message: "Заявка отправлена." });
    };
    await post([update({ text: "Привет" })]);
    await settle();
    chats.service.turnGate = () => {
      throw new ActionForbiddenError("voice");
    };
    await post([update({ text: "Ещё" })]);
    await settle();
    expect(fake.texts()).toEqual(["Заявка отправлена.", messengerTexts.voiceForbidden]);
    expect(errors).toEqual([]);
  });

  it("отказ приложения приходит до разбора вложений: голосовое не распознаётся (платно), человеку — текст отказа", async () => {
    const transcribe = vi.fn(async () => ({ text: "Позвони маме" }));
    const { chats, errors, link, post, settle, fake } = setup({ transcribe });
    await link();
    chats.service.turnGate = () => {
      throw new TurnRefusedError({ code: "lesson_closed", message: "Урок закрыт" });
    };
    await post([update({ kind: "voice", text: undefined, files: [{ fileId: "v1", size: 3 }] })]);
    await settle();
    expect(transcribe).not.toHaveBeenCalled();
    expect(chats.sent).toEqual([]);
    expect(fake.texts()).toEqual(["Урок закрыт"]);
    expect(errors).toEqual([]);
  });

  it("право voice закрыто: голосовое не скачивается и не распознаётся, человеку — текст отказа", async () => {
    const transcribe = vi.fn(async () => ({ text: "Позвони маме" }));
    const { chats, errors, link, post, settle, fake } = setup({ transcribe });
    await link();
    chats.service.capabilities = { voice: false };
    await post([update({ kind: "voice", text: undefined, files: [{ fileId: "v1", size: 3 }] })]);
    // Мессенджер сам распознал (MAX) — голосовое всё равно голосовое.
    await post([update({ kind: "voice", text: undefined, transcription: "Позвони маме" })]);
    await settle();
    expect(transcribe).not.toHaveBeenCalled();
    expect(fake.downloads).toEqual([]);
    expect(chats.sent).toEqual([]);
    expect(fake.texts()).toEqual([messengerTexts.voiceForbidden, messengerTexts.voiceForbidden]);
    expect(errors).toEqual([]);
  });

  it("право attachments закрыто: файл не скачивается, человеку — текст отказа; текст без файлов идёт как обычно", async () => {
    const attachments = vi.fn(async () => ({ ok: true as const, attachment: { id: "a1", name: "x.pdf", mediaType: "application/pdf", size: 1 } }));
    const { chats, errors, link, post, settle, fake } = setup({ attachments });
    await link();
    chats.service.capabilities = { attachments: false };
    await post([update({ kind: "files", text: "Посмотри", files: [{ fileId: "f1", name: "x.pdf", mediaType: "application/pdf", size: 1 }] })]);
    await settle();
    expect(attachments).not.toHaveBeenCalled();
    expect(fake.downloads).toEqual([]);
    expect(chats.sent).toEqual([]);
    expect(fake.texts()).toEqual([messengerTexts.filesForbidden]);
    await post([update({ text: "А так?" })]);
    await settle();
    expect(chats.sent).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("приложение не даёт завести первый чат (beforeCreateChat): человеку — текст отказа, в журнал не пишем", async () => {
    const { chats, errors, link, post, settle, fake } = setup();
    await link();
    chats.service.createRefusal = { code: "no_seats", message: "Мест нет, напишите завтра." };
    await post([update({ text: "Привет" })]);
    await settle();
    expect(chats.sent).toEqual([]);
    expect(fake.texts()).toEqual(["Мест нет, напишите завтра."]);
    expect(errors).toEqual([]);
  });

  it("/new и /chats в «много чатов»: отказ в новом чате и запрет списка — текстом", async () => {
    const { chats, errors, link, post, settle, fake } = setup({ conversations: "many" });
    await link();
    await post([update({ text: "Привет" })]);
    await settle();
    chats.service.createRefusal = { code: "no_seats", message: "Новый чат завести нельзя." };
    chats.service.capabilities = { chatList: false };
    await post([update({ kind: "command", text: "/new" })]);
    await post([update({ kind: "command", text: "/chats" })]);
    await settle();
    expect(fake.texts().slice(-2)).toEqual(["Новый чат завести нельзя.", messengerTexts.chatListForbidden]);
    expect(errors).toEqual([]);
  });

  it("кнопка подсказки — её текст уходит агенту как сообщение", async () => {
    const { chats, link, post, settle, fake } = setup();
    await link();
    chats.service.respond = () =>
      streamOf([
        { type: "start", messageId: "a1" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Выберите" },
        { type: "text-end", id: "t1" },
        { type: "tool-input-available", toolCallId: "s1", toolName: "suggest_replies", input: { replies: ["Да", "Нет"] } },
        { type: "finish" },
      ]);
    await post([update({ text: "Вопрос" })]);
    await settle();
    const button = fake.sent[0]?.message.buttons?.[0]?.[0];
    expect(button?.text).toBe("Да");
    chats.service.respond = () => streamOf(textAnswer("Принято"));
    await post([update({ kind: "button", text: undefined, buttonId: button?.id, callbackId: "cb1" })]);
    await settle();
    expect(chats.sent.at(-1)?.message.parts).toEqual([{ type: "text", text: "Да" }]);
    expect(fake.texts().at(-1)).toBe("Принято");
  });

  it("ход после результата фона в текущем чате разговора — печатается в мессенджер", async () => {
    const { chats, link, post, settle, fake, messengers } = setup({ taskReadyPing: false });
    await link();
    await post([update({ text: "Привет" })]);
    await settle();
    await messengers.start();
    chats.service.continuation = () => streamOf(textAnswer("Фоновая задача готова", "answer-9"));
    chats.emit({ type: "turn-started", ownerId: "anna", chatId: "chat-1", messageId: "answer-9", trigger: "notice", channel: "web" });
    await settle();
    expect(fake.texts().at(-1)).toBe("Фоновая задача готова");
    // Чужой владелец и человеческий ход — мимо.
    chats.emit({ type: "turn-started", ownerId: "boris", chatId: "chat-1", messageId: "x", trigger: "notice", channel: "web" });
    chats.emit({ type: "turn-started", ownerId: "anna", chatId: "chat-1", messageId: "y", trigger: "human", channel: "web" });
    await settle();
    expect(fake.texts()).toHaveLength(2);
  });

  it("ход сервера кончился раньше подписки (готовый ответ без модели) — ответ берётся из истории", async () => {
    const { chats, link, post, settle, fake, messengers } = setup({ taskReadyPing: false });
    await link();
    await post([update({ text: "Привет" })]);
    await settle();
    await messengers.start();
    chats.service.continuation = null;
    chats.addAnswer("chat-1", "Как успехи с привычкой?");
    const answerId = chats.historyOf("chat-1").at(-1)!.id!;
    chats.emit({ type: "turn-started", ownerId: "anna", chatId: "chat-1", messageId: answerId, trigger: "notice", channel: "web" });
    await settle();
    expect(fake.texts().at(-1)).toBe("Как успехи с привычкой?");
    // Ответа с таким номером нет — тишина.
    chats.emit({ type: "turn-started", ownerId: "anna", chatId: "chat-1", messageId: "нет-такого", trigger: "notice", channel: "web" });
    await settle();
    expect(fake.texts()).toHaveLength(2);
  });

  it("голосовое на входе и голосовые ответы включены — после текста приходит голосовое", async () => {
    const { chats, link, post, settle, fake } = setup({
      transcribe: async () => ({ text: "Позвони маме" }),
      voiceReplies: { speak: async () => ({ audio: new Uint8Array([9]), mediaType: "audio/ogg", durationMs: 1500 }) },
    });
    await link();
    await post([update({ kind: "voice", text: undefined, files: [{ fileId: "v1", size: 3 }] })]);
    await settle();
    expect(chats.sent[0]?.message.parts).toEqual([{ type: "text", text: `[${messengerTexts.voiceMark}] Позвони маме` }]);
    expect(fake.texts()).toEqual(["Ответ"]);
    expect(fake.voices.map((item) => item.voice.durationMs)).toEqual([1500]);
  });

  it("группы выключены — один ответ «пишите в личные»; включены — /connect и ход от плательщика с автором", async () => {
    const off = setup();
    await off.post([update({ chat: groupChat, text: "@test_bot привет", group: { mentioned: true, replyToBot: false } })]);
    await off.settle();
    expect(off.fake.texts()).toEqual([messengerTexts.writeInPrivate]);

    const on = setup({ groups: {} });
    await on.link();
    await on.post([update({ chat: groupChat, kind: "command", text: "/connect" })]);
    await on.settle();
    await on.post([update({ chat: groupChat, account: account({ externalUserId: "200", name: "Борис" }), text: "@test_bot привет", group: { mentioned: true, replyToBot: false } })]);
    await on.settle();
    expect(on.chats.sent).toEqual([
      expect.objectContaining({ userId: "anna", options: { channel: "telegram", group: { allowedTools: [], author: "Борис" } } }),
    ]);
    expect(on.fake.texts()).toEqual([messengerTexts.groupConnected("Анна"), "Ответ"]);
  });

  it("группа: /stop чужого хода от постороннего — отказ; автор хода и подключивший — останавливают", async () => {
    const { fake, chats, link, post, settle } = setup({ groups: {} });
    await link();
    await post([update({ chat: groupChat, kind: "command", text: "/connect" })]);
    await settle();
    const boris = account({ externalUserId: "200", name: "Борис" });
    const gleb = account({ externalUserId: "300", name: "Глеб" });
    const ask = async (author = boris) => {
      const live = controlledStream();
      chats.service.respond = () => live.stream;
      await post([update({ chat: groupChat, account: author, text: "@test_bot расскажи длинно", group: { mentioned: true, replyToBot: false } })]);
      await vi.advanceTimersByTimeAsync(0);
      live.push({ type: "start", messageId: "a1" }, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "Начало ответа" });
      await vi.advanceTimersByTimeAsync(100);
    };

    await ask();
    await post([update({ chat: groupChat, account: gleb, kind: "command", text: "/stop" })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(chats.stops).toEqual([]);
    expect(fake.texts()).toContain(messengerTexts.stopNotYours);
    await post([update({ chat: groupChat, account: boris, kind: "command", text: "/stop" })]);
    await settle();
    expect(chats.stops).toHaveLength(1);
    expect(fake.texts().at(-1)).toBe(messengerTexts.stopped);

    await ask();
    await post([update({ chat: groupChat, kind: "command", text: "/stop" })]);
    await settle();
    expect(chats.stops).toHaveLength(2);
    expect(fake.texts().at(-1)).toBe(messengerTexts.stopped);
  });

  it("бот на опросе: start() запускает опрос, обновления идут тем же путём", async () => {
    const { fake, link, settle, messengers } = setup({ bot: { receive: "polling" } });
    await link();
    await messengers.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.polling).toBe(1);
    fake.pushPoll(update({ text: "Через опрос" }));
    await settle();
    expect(fake.texts()).toEqual(["Ответ"]);
    await messengers.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.polling).toBe(0);
  });

  it("перезапуск: итог, не ушедший до падения сервера, после срока аренды отправляет новая копия — один раз", async () => {
    const crashed = setup();
    await crashed.link();
    crashed.chats.service.keepHistory = true;
    crashed.chats.service.respond = () => streamOf(textAnswer("Отлично"));
    // Мессенджер просит подождать час: итог стоит в очереди, и тут сервер падает.
    crashed.fake.failures.send.push(new MessengerRateLimitError("Too Many Requests", 3_600_000));
    await crashed.post([update({ text: "Как дела?" })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(crashed.fake.sent).toEqual([]);
    crashed.chats.addAnswer("chat-1", "Отлично");

    // Чат общий: новая копия видит в нём сообщение и ответ и второй раз его не задаёт.
    const restarted = setup({ store: crashed.store, service: crashed.chats.service });
    await restarted.messengers.start();
    await restarted.settle();
    // Аренда упавшей копии ещё не истекла: итог её.
    expect(restarted.fake.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await restarted.settle();
    expect(restarted.fake.texts()).toEqual(["Отлично"]);
    expect(crashed.fake.sent).toEqual([]);
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(await crashed.store.takeAbandonedDeliveries({ messenger: "telegram", botId: "bot1" }, "check", later, later, 10)).toEqual([]);
    await restarted.messengers.stop();
  });
});

describe("обновление не теряется при сбое", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const LEASE_EXPIRED = 3 * 60_000;

  it("база не приняла обновление — вебхук отвечает 503, мессенджер повторит; повтор обрабатывается один раз", async () => {
    const { store, chats, errors, link, post, settle, fake } = setup();
    await link();
    const claim = store.claimUpdate.bind(store);
    let down = true;
    store.claimUpdate = async (...args) => {
      if (down) throw new Error("db down");
      return claim(...args);
    };
    const message = update({ text: "Как дела?" });
    expect((await post([message])).status).toBe(503);
    await settle();
    expect(chats.sent).toEqual([]);
    expect(errors).toEqual([new Error("db down")]);

    down = false;
    expect((await post([message])).status).toBe(200);
    expect((await post([message])).status).toBe(200);
    await settle();
    expect(chats.sent).toHaveLength(1);
    expect(fake.texts()).toEqual(["Ответ"]);
  });

  it("обновление, которое база не принимает никогда, — 503 до десяти минут, потом в журнал и пропуск", async () => {
    const { store, errors, link, post, settle, fake } = setup();
    await link();
    const claim = store.claimUpdate.bind(store);
    store.claimUpdate = async (...args) => {
      if (args[0] === "bad") throw new Error("broken update");
      return claim(...args);
    };
    const bad = update({ key: "bad", text: "битое" });
    expect((await post([bad])).status).toBe(503);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect((await post([bad])).status).toBe(503);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await post([bad, update({ text: "Живое" })])).status).toBe(200);
    await settle();
    expect(fake.texts()).toEqual(["Ответ"]);
    expect(errors.at(-1)).toEqual(new Error("messengers: обновление bad не записано за 10 минут попыток — пропущено"));
  });

  it("опрос: битое обновление не держит очередь вечно — через десять минут пропущено, следующие обрабатываются", async () => {
    const { store, errors, link, settle, messengers, fake } = setup({ bot: { receive: "polling" } });
    await link();
    const claim = store.claimUpdate.bind(store);
    let attempts = 0;
    store.claimUpdate = async (...args) => {
      if (args[0] !== "bad") return claim(...args);
      attempts++;
      throw new Error("broken update");
    };
    await messengers.start();
    fake.pushPoll(update({ key: "bad", text: "битое" }));
    fake.pushPoll(update({ text: "Живое" }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fake.texts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    await settle();
    expect(fake.texts()).toEqual(["Ответ"]);
    // Пауза между попытками растёт до 30 секунд: за 10 минут — не 600 попыток, а около двадцати пяти.
    expect(attempts).toBeLessThan(40);
    expect(errors).toContainEqual(new Error("messengers: обновление bad не записано за 10 минут попыток — пропущено"));
    await messengers.stop();
  });

  it("сервер упал после приёма, до обработки — после срока аренды обновление обрабатывает другая копия, один раз", async () => {
    const crashed = setup();
    await crashed.link();
    // Обработка зависла навсегда — так выглядит упавшая копия: обновление записано, ответа нет.
    const gate = crashed.chats.service.assertTurnAllowed.bind(crashed.chats.service);
    let hang = true;
    crashed.chats.service.assertTurnAllowed = (...args) => (hang ? new Promise<void>(() => {}) : gate(...args));
    expect((await crashed.post([update({ text: "Как дела?" })])).status).toBe(200);
    await vi.advanceTimersByTimeAsync(1000);
    hang = false;

    const restarted = setup({ store: crashed.store, service: crashed.chats.service });
    await restarted.messengers.start();
    await restarted.settle();
    // Аренда упавшей копии ещё не истекла: обновление её.
    expect(crashed.chats.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRED);
    await restarted.settle();
    expect(crashed.chats.sent.map((call) => call.message.parts)).toEqual([[{ type: "text", text: "Как дела?" }]]);
    expect(restarted.fake.texts()).toEqual(["Ответ"]);
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRED);
    await restarted.settle();
    expect(crashed.chats.sent).toHaveLength(1);
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(await crashed.store.takeAbandonedUpdates({ messenger: "telegram", botId: "bot1" }, "check", later, later, 10)).toEqual([]);
    await restarted.messengers.stop();
  });

  it("упал посреди ответа: сообщение уже в чате и на него ответили — второго хода нет", async () => {
    const crashed = setup();
    await crashed.link();
    crashed.chats.service.keepHistory = true;
    crashed.chats.service.respond = () => controlledStream().stream;
    await crashed.post([update({ text: "Как дела?" })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(crashed.chats.sent).toHaveLength(1);
    crashed.chats.addAnswer("chat-1");

    const restarted = setup({ store: crashed.store, service: crashed.chats.service });
    await restarted.messengers.start();
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRED);
    await restarted.settle();
    expect(crashed.chats.sent).toHaveLength(1);
    expect(crashed.chats.historyOf("chat-1").map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(restarted.errors).toEqual([]);
    await restarted.messengers.stop();
  });

  it("упал, когда сообщение уже записано, а ответа нет — служба доводит ответ на то же сообщение, файл второй раз не скачивается", async () => {
    const crashed = setup({ attachments: async () => ({ ok: true, attachment: { id: "att-1", name: "отчёт.pdf", mediaType: "application/pdf", size: 2 } }) });
    await crashed.link();
    crashed.chats.service.keepHistory = true;
    crashed.chats.service.respond = () => controlledStream().stream;
    await crashed.post([update({ kind: "files", text: "Посмотри", files: [{ fileId: "f1", name: "отчёт.pdf", mediaType: "application/pdf", size: 2 }] })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(crashed.fake.downloads.map((file) => file.fileId)).toEqual(["f1"]);

    const restarted = setup({ store: crashed.store, service: crashed.chats.service });
    crashed.chats.service.respond = () => streamOf(textAnswer("Готово"));
    await restarted.messengers.start();
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRED);
    await restarted.settle();
    const [first, again] = crashed.chats.sent;
    expect(again?.message).toEqual(first?.message);
    expect(restarted.fake.downloads).toEqual([]);
    expect(crashed.chats.historyOf("chat-1").filter((message) => message.role === "user")).toHaveLength(1);
    expect(restarted.fake.texts()).toEqual(["Готово"]);
    await restarted.messengers.stop();
  });

  it("сбой обработки — повтор через полминуты; не вышло за три повтора — обновление брошено и больше не берётся", async () => {
    const { store, chats, errors, link, post, settle, messengers, fake } = setup();
    await link();
    await messengers.start();
    const findLink = store.findLink.bind(store);
    let failures = 1;
    let calls = 0;
    store.findLink = async (...args) => {
      calls++;
      if (failures-- > 0) throw new Error("db down");
      return findLink(...args);
    };
    await post([update({ text: "Как дела?" })]);
    await settle();
    expect(chats.sent).toEqual([]);
    expect(errors).toEqual([new Error("db down")]);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(chats.sent).toHaveLength(1);
    expect(fake.texts()).toEqual(["Ответ"]);

    failures = Number.POSITIVE_INFINITY;
    calls = 0;
    await post([update({ text: "Снова" })]);
    for (let minute = 0; minute < 10; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await settle();
    }
    expect(calls).toBe(4);
    expect(chats.sent).toHaveLength(1);
    await messengers.stop();
  });
});
