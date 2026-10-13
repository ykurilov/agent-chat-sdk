import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessengerApiError, MessengerBlockedError, MessengerMarkupError, MessengerRateLimitError } from "../../src/messenger-api";
import { telegramBot } from "../../src/telegram/index";
import { collectPolled, oggOpusBytes } from "../fake-apis/rig";
import { createTelegramRig, TELEGRAM_BOT_ID, TELEGRAM_SECRET, TELEGRAM_TOKEN, TELEGRAM_USERNAME, type FakeTelegram } from "../fake-apis/telegram";
import { describeAdapterContract } from "./adapter-contract";

const makeBot = (api: { baseUrl: string }, receive: Parameters<typeof telegramBot>[0]["receive"]) =>
  telegramBot({ token: TELEGRAM_TOKEN, username: TELEGRAM_USERNAME, receive, api });

describeAdapterContract("Telegram", () => createTelegramRig((api, receive) => makeBot(api, receive).adapter));

describe("Telegram: особенности", () => {
  let rig: Awaited<ReturnType<typeof createTelegramRig>>;
  let fake: FakeTelegram;
  beforeEach(async () => {
    rig = await createTelegramRig((api, receive) => makeBot(api, receive).adapter);
    fake = rig.fake;
  });
  afterEach(async () => {
    await rig.close();
  });

  const privateChat = () => rig.chats.annaPrivate;
  const callsOf = (method: string) => fake.state.requests.filter((request) => request.method === method);

  describe("бот", () => {
    it("id бота — число из токена, способ приёма — как настроен", () => {
      const webhook = makeBot({ baseUrl: fake.url }, { webhook: { secret: TELEGRAM_SECRET } });
      const polling = makeBot({ baseUrl: fake.url }, { polling: true });
      expect(webhook).toMatchObject({ messenger: "telegram", botId: TELEGRAM_BOT_ID, receive: "webhook" });
      expect(polling).toMatchObject({ messenger: "telegram", botId: TELEGRAM_BOT_ID, receive: "polling" });
    });

    it("возможности: 4096 знаков, черновик, html, меню команд", () => {
      expect(rig.adapter.abilities).toMatchObject({ textLimit: 4096, liveText: "draft", markup: "html", commandsMenu: true });
    });

    it("ссылка на бота: t.me/<бот>?start=<метка>", () => {
      expect(rig.adapter.linkUrl("Code_123")).toBe(`https://t.me/${TELEGRAM_USERNAME}?start=Code_123`);
    });

    it("секрет и токен в тексте ошибки не появляются", async () => {
      fake.failNext("sendMessage", { status: 500, description: `boom ${TELEGRAM_TOKEN}` });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerApiError);
      expect((error as Error).message).not.toContain(TELEGRAM_TOKEN);
    });

    it("сбой сети: ошибка без токена", async () => {
      const lost = makeBot({ baseUrl: "http://127.0.0.1:1" }, { polling: true }).adapter;
      const error = await lost.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerApiError);
      expect((error as MessengerApiError).status).toBe(0);
      expect((error as Error).message).not.toContain(TELEGRAM_TOKEN);
    });
  });

  describe("вебхук", () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      rig.adapter.readWebhook(new Request("http://app/telegram", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

    it("без секрета и с чужим секретом обновление не принимается", async () => {
      const body = fake.webhookBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      for (const headers of [{} as Record<string, string>, { "x-telegram-bot-api-secret-token": "wrong-secret-0000" }]) {
        const { response, updates } = await post(body, headers);
        expect(response.status).toBe(403);
        expect(updates).toEqual([]);
      }
    });

    it("с верным секретом — ответ 200 и обновление", async () => {
      const body = fake.webhookBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      const { response, updates } = await post(body, { "x-telegram-bot-api-secret-token": TELEGRAM_SECRET });
      expect(response.status).toBe(200);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.key).toBe(`telegram:${TELEGRAM_BOT_ID}:${(body as { update_id: number }).update_id}`);
    });

    it("обновление, которое боту не нужно, принимается и молча пропускается", async () => {
      const { response, updates } = await post({ update_id: 900, edited_message: { message_id: 1, chat: { id: 1, type: "private" }, text: "x" } }, { "x-telegram-bot-api-secret-token": TELEGRAM_SECRET });
      expect(response.status).toBe(200);
      expect(updates).toEqual([]);
    });

    it("тело не JSON — 400", async () => {
      const { response, updates } = await rig.adapter.readWebhook(new Request("http://app/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": TELEGRAM_SECRET }, body: "{{{" }));
      expect(response.status).toBe(400);
      expect(updates).toEqual([]);
    });

    it("registerWebhook: адрес и секрет уходят в setWebhook", async () => {
      const bot = makeBot({ baseUrl: fake.url }, { webhook: { secret: TELEGRAM_SECRET } });
      await bot.registerWebhook("https://app.example/api/messengers/telegram");
      expect(fake.state.webhook).toEqual({ url: "https://app.example/api/messengers/telegram", secret: TELEGRAM_SECRET });
      const [call] = callsOf("setWebhook");
      expect(call?.body.allowed_updates).toEqual(expect.arrayContaining(["message", "callback_query", "my_chat_member"]));
    });
  });

  describe("опрос", () => {
    it("offset уходит следующим за последним обновлением", async () => {
      const bot = makeBot({ baseUrl: fake.url }, { polling: true });
      const controller = new AbortController();
      const iterator = bot.adapter.poll(controller.signal)[Symbol.asyncIterator]();
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "раз" });
      const first = await iterator.next();
      expect(first.value).toMatchObject({ text: "раз" });
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "два" });
      const second = await iterator.next();
      expect(second.value).toMatchObject({ text: "два" });
      controller.abort();
      await iterator.return?.(undefined);
      expect(fake.state.pollOffsets[0]).toBe(0);
      expect(fake.state.pollOffsets).toContain(2);
    });

    it("вебхук, оставшийся от прошлой жизни, перед опросом снимается", async () => {
      fake.state.webhook = { url: "https://old.example/hook" };
      const bot = makeBot({ baseUrl: fake.url }, { polling: true });
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      const updates = await collectPolled(bot.adapter, 1);
      expect(updates).toHaveLength(1);
      expect(fake.state.webhook).toBeUndefined();
      expect(callsOf("deleteWebhook")).toHaveLength(1);
    });

    it("второй опрос: ответ 409 доходит до вызывающего (аренда опроса ловит его сама)", async () => {
      const bot = makeBot({ baseUrl: fake.url }, { polling: true });
      fake.failNext("getUpdates", { status: 409, description: "Conflict: terminated by other getUpdates request" });
      const error = await collectPolled(bot.adapter, 1).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerApiError);
      expect((error as MessengerApiError).status).toBe(409);
    });

    it("остановка опроса — конец без ошибки", async () => {
      const bot = makeBot({ baseUrl: fake.url }, { polling: true });
      const controller = new AbortController();
      const reading = (async () => {
        const seen: unknown[] = [];
        for await (const update of bot.adapter.poll(controller.signal)) seen.push(update);
        return seen;
      })();
      setTimeout(() => controller.abort(), 50);
      await expect(reading).resolves.toEqual([]);
    });
  });

  describe("отправка", () => {
    it("sendMessage: HTML, чат числом", async () => {
      await rig.adapter.send(privateChat(), { text: "<b>важно</b>", markup: "html" });
      const [call] = callsOf("sendMessage");
      expect(call?.body).toMatchObject({ chat_id: 100, text: "<b>важно</b>", parse_mode: "HTML" });
    });

    it("простой текст уходит без parse_mode", async () => {
      await rig.adapter.send(privateChat(), { text: "a < b", markup: "plain" });
      expect(callsOf("sendMessage")[0]?.body.parse_mode).toBeUndefined();
    });

    it("разметку Telegram не разобрал — MessengerMarkupError", async () => {
      await expect(rig.adapter.send(privateChat(), { text: "<div>x</div>", markup: "html" })).rejects.toBeInstanceOf(MessengerMarkupError);
    });

    it("429: сколько ждать — из retry_after", async () => {
      fake.failNext("sendMessage", { status: 429, description: "Too Many Requests: retry after 3", retryAfter: 3 });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerRateLimitError);
      expect((error as MessengerRateLimitError).retryAfterMs).toBe(3000);
    });

    it("403: человек заблокировал бота или бота выгнали из группы — MessengerBlockedError", async () => {
      fake.failNext("sendMessage", { status: 403, description: "Forbidden: bot was blocked by the user" });
      await expect(rig.adapter.send(privateChat(), { text: "x", markup: "plain" })).rejects.toBeInstanceOf(MessengerBlockedError);
      fake.failNext("sendMessage", { status: 403, description: "Forbidden: bot was kicked from the supergroup chat" });
      await expect(rig.adapter.send(rig.chats.group, { text: "x", markup: "plain" })).rejects.toBeInstanceOf(MessengerBlockedError);
    });

    it("кнопка-ссылка: `url`, а не callback_data", async () => {
      await rig.adapter.send(privateChat(), { text: "Открыть", markup: "plain", buttons: [[{ id: "b0000001", text: "В приложении", url: "https://app.example/chat/1" }]] });
      expect(rig.outgoing[0]?.buttons).toEqual([[{ text: "В приложении", url: "https://app.example/chat/1" }]]);
    });

    it("callback_data — не больше 64 байт; длиннее — ошибка до запроса", async () => {
      await rig.adapter.send(privateChat(), { text: "ok", markup: "plain", buttons: [[{ id: "ж".repeat(32), text: "Да" }]] });
      expect(Buffer.byteLength(rig.outgoing[0]?.buttons[0]?.[0]?.data ?? "")).toBeLessThanOrEqual(64);
      await expect(rig.adapter.send(privateChat(), { text: "x", markup: "plain", buttons: [[{ id: "ж".repeat(33), text: "Нет" }]] })).rejects.toThrow(/64/);
      expect(rig.outgoing).toHaveLength(1);
    });

    it("слишком длинная подпись к картинке: картинка отдельно, текст отдельно", async () => {
      const text = "а".repeat(1500);
      const sent = await rig.adapter.send(privateChat(), { text, markup: "plain", photo: { bytes: new Uint8Array([1, 2, 3]), name: "a.png" }, buttons: [[{ id: "b0000001", text: "Да" }]] });
      expect(rig.outgoing.map((item) => item.kind)).toEqual(["photo", "text"]);
      expect(rig.outgoing[1]).toMatchObject({ text, messageId: sent.messageId });
      expect(rig.outgoing[1]?.buttons.flat()).toHaveLength(1);
    });

    it("картинка по ссылке уходит ссылкой, без загрузки", async () => {
      await rig.adapter.send(privateChat(), { text: "схема", markup: "plain", photo: { url: "https://img.example/a.png" } });
      expect(callsOf("sendPhoto")[0]?.body).toMatchObject({ photo: "https://img.example/a.png", caption: "схема" });
      expect(rig.outgoing[0]?.kind).toBe("photo");
    });
  });

  describe("правка и кнопки", () => {
    it("«сообщение не изменилось» — не ошибка", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "то же", markup: "plain" });
      await expect(rig.adapter.edit(sent, { text: "то же", markup: "plain" })).resolves.toBeUndefined();
      expect(rig.outgoing[0]?.edits).toBe(0);
    });

    it("другие ошибки правки не глотаются", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "a", markup: "plain" });
      await expect(rig.adapter.edit({ ...sent, messageId: "9999" }, { text: "b", markup: "plain" })).rejects.toBeInstanceOf(MessengerApiError);
    });

    it("убрать кнопки: правка без кнопок посылает пустую клавиатуру", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "a", markup: "plain", buttons: [[{ id: "b0000001", text: "Да" }]] });
      await rig.adapter.edit(sent, { text: "a", markup: "plain", buttons: [] });
      expect(rig.outgoing[0]?.buttons).toEqual([]);
    });

    it("удаление: deleteMessage по chat_id и message_id", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "Ищу в интернете…", markup: "plain" });
      await rig.adapter.deleteMessage?.(sent);
      expect(rig.outgoing).toEqual([]);
    });

    it("ответ на нажатие длиннее 200 знаков обрезается", async () => {
      const press = { chat: privateChat(), account: { messenger: "telegram" as const, botId: TELEGRAM_BOT_ID, externalUserId: "100", name: "Анна" }, buttonId: "b0000001", callbackId: "cb1" };
      await rig.adapter.answerButton(press, "я".repeat(300));
      expect(rig.answers[0]?.text?.length).toBeLessThanOrEqual(200);
    });
  });

  describe("черновик", () => {
    it("в личном чате: sendMessageDraft с номером черновика", async () => {
      await rig.adapter.draft?.(privateChat(), 7, "Печатаю…");
      expect(fake.state.drafts).toMatchObject([{ chatId: "100", draftId: 7, text: "Печатаю…" }]);
    });
  });

  describe("входящие", () => {
    it("упоминание другого бота — не упоминание нашего", async () => {
      const [update] = await rig.deliver({ type: "text", chat: rig.chats.group, from: rig.boris, text: "@other_bot привет" });
      expect(update?.group?.mentioned).toBe(false);
      expect(update?.text).toBe("@other_bot привет");
    });

    it("упоминание в середине фразы вырезается", async () => {
      const body = fake.webhookBody({ type: "text", chat: rig.chats.group, from: rig.boris, text: "x" }) as unknown as { message: { text: string; entities?: unknown[] } };
      body.message.text = "эй @test_bot ответь";
      body.message.entities = [{ type: "mention", offset: 3, length: 9 }];
      const { updates } = await rig.adapter.readWebhook(new Request("http://app/t", { method: "POST", headers: { "x-telegram-bot-api-secret-token": TELEGRAM_SECRET }, body: JSON.stringify(body) }));
      expect(updates[0]).toMatchObject({ text: "эй ответь", group: { mentioned: true } });
    });

    it("в группе пишет другой человек — ответ не на сообщение бота", async () => {
      const body = fake.webhookBody({ type: "text", chat: rig.chats.group, from: rig.boris, text: "ну?" }) as unknown as { message: Record<string, unknown> };
      body.message.reply_to_message = { message_id: 1, from: { id: 555, is_bot: false, first_name: "Кто-то" }, chat: { id: -500, type: "supergroup" }, date: 1 };
      const { updates } = await rig.adapter.readWebhook(new Request("http://app/t", { method: "POST", headers: { "x-telegram-bot-api-secret-token": TELEGRAM_SECRET }, body: JSON.stringify(body) }));
      expect(updates[0]?.group).toEqual({ mentioned: false, replyToBot: false });
    });

    it("команда с именем бота остаётся командой: /new@test_bot", async () => {
      const [update] = await rig.deliver({ type: "text", chat: privateChat(), from: rig.anna, text: "/new@test_bot" });
      expect(update).toMatchObject({ kind: "command", text: "/new@test_bot" });
    });

    it("голосовое: длина в миллисекундах", async () => {
      const [update] = await rig.deliver({ type: "voice", chat: privateChat(), from: rig.anna, audio: oggOpusBytes(4000), durationMs: 4000 });
      expect(update?.files?.[0]?.durationMs).toBe(4000);
    });

    it("файл больше 20 МБ не скачивается: getFile отказывает", async () => {
      const [update] = await rig.deliver({ type: "file", chat: privateChat(), from: rig.anna, name: "big.bin", mediaType: "application/octet-stream", bytes: new Uint8Array(21 * 1024 * 1024) });
      const file = update?.files?.[0];
      expect(file?.size).toBe(21 * 1024 * 1024);
      await expect(rig.adapter.downloadFile(file as NonNullable<typeof file>)).rejects.toBeInstanceOf(MessengerApiError);
    });
  });

  describe("голос и меню команд", () => {
    it("sendVoice: длина в секундах, поле voice", async () => {
      await rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(2400), durationMs: 2400 });
      expect(callsOf("sendVoice")[0]?.body).toMatchObject({ chat_id: "100", duration: "2" });
    });

    it("отказ в голосовом: звук уходит документом, чат тот же", async () => {
      rig.rejectNextVoice();
      await rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(1000), durationMs: 1000 });
      expect(callsOf("sendDocument")).toHaveLength(1);
    });

    it("429 на голосовом не превращается в файл: повтор решает очередь", async () => {
      fake.failNext("sendVoice", { status: 429, description: "Too Many Requests: retry after 1", retryAfter: 1 });
      await expect(rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(1000), durationMs: 1000 })).rejects.toBeInstanceOf(MessengerRateLimitError);
      expect(callsOf("sendDocument")).toHaveLength(0);
    });

    it("setMyCommands: область личных и групповых чатов", async () => {
      await rig.adapter.setCommands([{ command: "new", description: "Новый" }], "private");
      await rig.adapter.setCommands([{ command: "connect", description: "Подключить" }], "group");
      expect(callsOf("setMyCommands").map((call) => (call.body.scope as { type: string }).type)).toEqual(["all_private_chats", "all_group_chats"]);
    });

    it("пустой список — меню снимается deleteMyCommands в той же области", async () => {
      await rig.adapter.setCommands([], "private");
      await rig.adapter.setCommands([], "group");
      expect(callsOf("setMyCommands")).toHaveLength(0);
      expect(callsOf("deleteMyCommands").map((call) => (call.body.scope as { type: string }).type)).toEqual(["all_private_chats", "all_group_chats"]);
      expect(fake.state.deletedCommandScopes).toEqual(["private", "group"]);
    });
  });
});
