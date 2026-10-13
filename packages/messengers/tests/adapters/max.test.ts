import { setTimeout as realSleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessengerApiError, MessengerBlockedError, MessengerMarkupError, MessengerRateLimitError } from "../../src/messenger-api";
import { maxBot } from "../../src/max/index";
import { toInboundUpdates } from "../../src/max/max-inbound";
import { collectPolled, oggOpusBytes } from "../fake-apis/rig";
import { createMaxRig, type FakeMax, MAX_BOT_NAME, MAX_GROUP_CHAT, MAX_SECRET, MAX_TOKEN } from "../fake-apis/max";
import { describeAdapterContract } from "./adapter-contract";

const makeBot = (api: { baseUrl: string }, receive: Parameters<typeof maxBot>[0]["receive"]) => maxBot({ token: MAX_TOKEN, botName: MAX_BOT_NAME, receive, api });

describeAdapterContract("MAX", () => createMaxRig((api, receive) => makeBot(api, receive).adapter));

describe("MAX: особенности", () => {
  let rig: Awaited<ReturnType<typeof createMaxRig>>;
  let fake: FakeMax;
  beforeEach(async () => {
    rig = await createMaxRig((api, receive) => makeBot(api, receive).adapter);
    fake = rig.fake;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rig.close();
  });

  const privateChat = () => rig.chats.annaPrivate;
  /** Ждёт `promise`, двигая поддельные часы: сеть живая, пауза повтора — поддельная. */
  async function withFastClock<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    const watched = promise.finally(() => {
      done = true;
    });
    watched.catch(() => undefined);
    while (!done) {
      await vi.advanceTimersByTimeAsync(1000);
      // Настоящая пауза (модуль, а не глобальный таймер): сеть успевает ответить, а часы сетевых таймаутов не убегают вперёд.
      await realSleep(5);
    }
    return watched;
  }
  const callsOf = (method: string, path: string) => fake.state.requests.filter((request) => request.method === method && request.path === path);
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    rig.adapter.readWebhook(new Request("http://app/max", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  describe("бот", () => {
    it("id бота — его имя, способ приёма — как настроен", () => {
      expect(makeBot({ baseUrl: fake.url }, { webhook: { secret: MAX_SECRET } })).toMatchObject({ messenger: "max", botId: MAX_BOT_NAME, receive: "webhook" });
      expect(makeBot({ baseUrl: fake.url }, { polling: true })).toMatchObject({ messenger: "max", botId: MAX_BOT_NAME, receive: "polling" });
    });

    it("возможности: 4000 знаков, правка живьём, html, меню команд", () => {
      expect(rig.adapter.abilities).toMatchObject({ textLimit: 4000, liveText: "edit", markup: "html", commandsMenu: true });
    });

    it("ссылка на бота: max.ru/<бот>?start=<метка>", () => {
      expect(rig.adapter.linkUrl("Code_123")).toBe(`https://max.ru/${MAX_BOT_NAME}?start=Code_123`);
    });

    it("токен — в заголовке Authorization, в тексте ошибки его нет", async () => {
      await rig.adapter.send(privateChat(), { text: "привет", markup: "plain" });
      expect(callsOf("POST", "/messages")[0]?.headers.authorization).toBe(MAX_TOKEN);
      fake.failNext("POST /messages", { status: 500, code: "internal", message: `boom ${MAX_TOKEN}` });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerApiError);
      expect((error as Error).message).not.toContain(MAX_TOKEN);
    });
  });

  describe("вебхук", () => {
    it("без секрета и с чужим секретом обновление не принимается", async () => {
      const body = fake.webhookBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      for (const headers of [{} as Record<string, string>, { "x-max-bot-api-secret": "wrong-secret-0000" }]) {
        const { response, updates } = await post(body, headers);
        expect(response.status).toBe(403);
        expect(updates).toEqual([]);
      }
    });

    it("с верным секретом — 200 и обновление; ключ — mid сообщения", async () => {
      const body = fake.webhookBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" }) as unknown as { message: { body: { mid: string } } };
      const { response, updates } = await post(body, { "x-max-bot-api-secret": MAX_SECRET });
      expect(response.status).toBe(200);
      expect(updates[0]?.key).toBe(`max:${MAX_BOT_NAME}:${body.message.body.mid}`);
    });

    it("ключ нажатия кнопки — callback_id", async () => {
      const body = fake.webhookBody({ type: "press", chat: privateChat(), from: rig.anna, data: "b0000001", messageId: "mid.1" }) as unknown as { callback: { callback_id: string } };
      const { updates } = await post(body, { "x-max-bot-api-secret": MAX_SECRET });
      expect(updates[0]).toMatchObject({ kind: "button", buttonId: "b0000001", callbackId: body.callback.callback_id, key: `max:${MAX_BOT_NAME}:${body.callback.callback_id}` });
    });

    it("неизвестный вид обновления принимается и пропускается", async () => {
      const { response, updates } = await post({ update_type: "chat_title_changed", timestamp: 1 }, { "x-max-bot-api-secret": MAX_SECRET });
      expect(response.status).toBe(200);
      expect(updates).toEqual([]);
    });

    it("тело не JSON — 400", async () => {
      const { response } = await rig.adapter.readWebhook(new Request("http://app/max", { method: "POST", headers: { "x-max-bot-api-secret": MAX_SECRET }, body: "{{{" }));
      expect(response.status).toBe(400);
    });

    it("registerWebhook: POST /subscriptions с адресом, секретом и видами событий", async () => {
      const bot = makeBot({ baseUrl: fake.url }, { webhook: { secret: MAX_SECRET } });
      await bot.registerWebhook("https://app.example/api/messengers/max");
      expect(fake.state.subscriptions).toMatchObject([{ url: "https://app.example/api/messengers/max", secret: MAX_SECRET }]);
      expect(fake.state.subscriptions[0]?.update_types).toEqual(expect.arrayContaining(["message_created", "message_callback", "bot_started", "bot_stopped", "bot_added", "bot_removed"]));
    });

    it("секрет подписки короче 5 знаков MAX не принимает — понятная ошибка при запуске", () => {
      expect(() => makeBot({ baseUrl: fake.url }, { webhook: { secret: "abc" } })).toThrow(/секрет/i);
    });
  });

  describe("опрос", () => {
    it("marker идёт следом за последним ответом", async () => {
      const bot = makeBot({ baseUrl: fake.url }, { polling: true });
      const controller = new AbortController();
      const iterator = bot.adapter.poll(controller.signal)[Symbol.asyncIterator]();
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "раз" });
      expect((await iterator.next()).value).toMatchObject({ text: "раз" });
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "два" });
      expect((await iterator.next()).value).toMatchObject({ text: "два" });
      controller.abort();
      await iterator.return?.(undefined);
      expect(fake.state.markers[0]).toBe(0);
      expect(fake.state.markers).toContain(1);
    });

    it("подписка, оставшаяся от вебхука, перед опросом снимается", async () => {
      fake.state.subscriptions = [{ url: "https://old.example/hook" }];
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      const updates = await collectPolled(makeBot({ baseUrl: fake.url }, { polling: true }).adapter, 1);
      expect(updates).toHaveLength(1);
      expect(fake.state.subscriptions).toEqual([]);
    });

    it("остановка опроса — конец без ошибки", async () => {
      const controller = new AbortController();
      const reading = (async () => {
        const seen: unknown[] = [];
        for await (const update of makeBot({ baseUrl: fake.url }, { polling: true }).adapter.poll(controller.signal)) seen.push(update);
        return seen;
      })();
      setTimeout(() => controller.abort(), 50);
      await expect(reading).resolves.toEqual([]);
    });
  });

  describe("отправка", () => {
    it("POST /messages: chat_id в запросе, текст и format: html в теле", async () => {
      await rig.adapter.send(privateChat(), { text: "<b>важно</b>", markup: "html" });
      const [call] = callsOf("POST", "/messages");
      expect(call?.query.chat_id).toBe(privateChat().id);
      expect(call?.body).toMatchObject({ text: "<b>важно</b>", format: "html" });
    });

    it("простой текст уходит без format", async () => {
      await rig.adapter.send(privateChat(), { text: "a < b", markup: "plain" });
      expect((callsOf("POST", "/messages")[0]?.body as { format?: string }).format).toBeUndefined();
    });

    it("групповой чат с минусом в номере идёт как есть", async () => {
      await rig.adapter.send(rig.chats.group, { text: "всем", markup: "plain" });
      expect(callsOf("POST", "/messages")[0]?.query.chat_id).toBe(MAX_GROUP_CHAT);
    });

    it("кнопки: inline_keyboard с callback и link", async () => {
      await rig.adapter.send(privateChat(), { text: "Выбрать", markup: "plain", buttons: [[{ id: "b0000001", text: "Да" }, { id: "b0000002", text: "Открыть", url: "https://app.example/x" }]] });
      const body = callsOf("POST", "/messages")[0]?.body as { attachments: Array<{ type: string; payload: { buttons: Array<Array<{ type: string; payload?: string; url?: string }>> } }> };
      expect(body.attachments[0]?.type).toBe("inline_keyboard");
      expect(body.attachments[0]?.payload.buttons[0]?.map((button) => button.type)).toEqual(["callback", "link"]);
      expect(rig.outgoing[0]?.buttons[0]?.[1]).toMatchObject({ text: "Открыть", url: "https://app.example/x" });
    });

    it("403 chat.denied: человек остановил бота — MessengerBlockedError", async () => {
      fake.state.denied.add(privateChat().id);
      await expect(rig.adapter.send(privateChat(), { text: "x", markup: "plain" })).rejects.toBeInstanceOf(MessengerBlockedError);
    });

    it("429: сколько ждать — из Retry-After", async () => {
      fake.failNext("POST /messages", { status: 429, code: "too.many.requests", message: "slow down", headers: { "retry-after": "2" } });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerRateLimitError);
      expect((error as MessengerRateLimitError).retryAfterMs).toBe(2000);
    });

    it("429 без Retry-After: пауза по умолчанию", async () => {
      fake.failNext("POST /messages", { status: 429, code: "too.many.requests", message: "slow down" });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect((error as MessengerRateLimitError).retryAfterMs).toBeGreaterThan(0);
    });

    it("разметку не разобрали — MessengerMarkupError", async () => {
      fake.failNext("POST /messages", { status: 400, code: "proto.payload", message: "Invalid html markup" });
      await expect(rig.adapter.send(privateChat(), { text: "<b>", markup: "html" })).rejects.toBeInstanceOf(MessengerMarkupError);
    });

    it("прочая ошибка 400 — обычная MessengerApiError", async () => {
      fake.failNext("POST /messages", { status: 400, code: "proto.payload", message: "text: size must be <= 4000" });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerApiError);
      expect(error).not.toBeInstanceOf(MessengerMarkupError);
    });
  });

  describe("правка", () => {
    it("PUT /messages: message_id в запросе; без кнопок поле attachments не посылается", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "а", markup: "plain" });
      await rig.adapter.edit(sent, { text: "б", markup: "plain" });
      const [call] = callsOf("PUT", "/messages");
      expect(call?.query.message_id).toBe(sent.messageId);
      expect(call?.body).toMatchObject({ text: "б" });
      expect("attachments" in (call?.body as object)).toBe(false);
    });

    it("удаление: DELETE /messages с message_id", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "Ищу в интернете…", markup: "plain" });
      await rig.adapter.deleteMessage?.(sent);
      expect(callsOf("DELETE", "/messages")[0]?.query.message_id).toBe(sent.messageId);
      expect(rig.outgoing).toEqual([]);
    });

    it("правка сообщения с картинкой не стирает картинку", async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const sent = await rig.adapter.send(privateChat(), { text: "схема", markup: "plain", photo: { bytes, name: "a.png" } });
      await rig.adapter.edit(sent, { text: "схема 2", markup: "plain" });
      expect(rig.outgoing[0]?.kind).toBe("photo");
      expect([...(rig.outgoing[0]?.bytes ?? [])]).toEqual([1, 2, 3]);
    });

    it("кнопки: новый набор заменяет старый, пустой набор убирает", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "а", markup: "plain", buttons: [[{ id: "b0000001", text: "Да" }]] });
      await rig.adapter.edit(sent, { text: "а", markup: "plain", buttons: [[{ id: "b0000002", text: "Другое" }]] });
      expect(rig.outgoing[0]?.buttons.flat().map((button) => button.text)).toEqual(["Другое"]);
      await rig.adapter.edit(sent, { text: "а", markup: "plain", buttons: [] });
      expect(rig.outgoing[0]?.buttons).toEqual([]);
    });

    it("html при правке: format: html", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "а", markup: "plain" });
      await rig.adapter.edit(sent, { text: "<b>б</b>", markup: "html" });
      expect(callsOf("PUT", "/messages")[0]?.body).toMatchObject({ format: "html" });
    });
  });

  describe("кнопки на входе", () => {
    it("POST /answers: callback_id в запросе; текст — в notification", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "Выбрать", markup: "plain", buttons: [[{ id: "b0000001", text: "Да" }]] });
      const [update] = await rig.deliver({ type: "press", chat: privateChat(), from: rig.anna, data: rig.outgoing[0]?.buttons[0]?.[0]?.data ?? "", messageId: sent.messageId });
      const press = { chat: update?.chat as NonNullable<typeof update>["chat"], account: update?.account as NonNullable<typeof update>["account"], buttonId: "b0000001", callbackId: update?.callbackId ?? "" };
      await rig.adapter.answerButton(press, "Готово");
      const [call] = callsOf("POST", "/answers");
      expect(call?.query.callback_id).toBe(update?.callbackId);
      expect(call?.body).toMatchObject({ notification: "Готово" });
    });
  });

  describe("файлы и повтор «файл ещё не готов»", () => {
    const sendPhoto = () => rig.adapter.send(privateChat(), { text: "схема", markup: "plain", photo: { bytes: new Uint8Array([1, 2, 3]), name: "a.png" } });

    it("картинка: POST /uploads?type=image → загрузка → вложение с токеном", async () => {
      await sendPhoto();
      expect(callsOf("POST", "/uploads")[0]?.query.type).toBe("image");
      const body = callsOf("POST", "/messages")[0]?.body as { attachments: Array<{ type: string; payload: { token?: string } }> };
      expect(body.attachments[0]).toMatchObject({ type: "image" });
      expect(body.attachments[0]?.payload.token).toBeTruthy();
    });

    it("attachment.not.ready: повтор с паузами, пока файл не обработан", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      fake.state.notReady = 2;
      await expect(withFastClock(sendPhoto())).resolves.toMatchObject({ chat: privateChat() });
      expect(callsOf("POST", "/messages")).toHaveLength(3);
      expect(rig.outgoing).toHaveLength(1);
    });

    it("файл так и не стал готов — ошибка, а не вечное ожидание", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      fake.state.notReady = 100;
      const error = await withFastClock(sendPhoto().catch((reason: unknown) => reason));
      expect(error).toBeInstanceOf(MessengerApiError);
      expect((error as Error).message).toContain("attachment.not.ready");
      expect(callsOf("POST", "/messages").length).toBeLessThan(15);
    });

    it("картинка по ссылке: MAX её не берёт — скачиваем и загружаем", async () => {
      fake.state.files.set("/files/remote.png", { bytes: new Uint8Array([7, 7]), type: "image/png" });
      await rig.adapter.send(privateChat(), { text: "", markup: "plain", photo: { url: `${fake.url}/files/remote.png` } });
      expect([...(rig.outgoing[0]?.bytes ?? [])]).toEqual([7, 7]);
    });
  });

  describe("входящие", () => {
    it("bot_started с payload: старт с меткой", async () => {
      const [update] = await rig.deliver({ type: "start", from: rig.anna, payload: "scenario_1" });
      expect(update).toMatchObject({ kind: "start", startPayload: "scenario_1", chat: privateChat() });
    });

    it("события бота одного вида в одну секунду из разных чатов и от разных людей — разные ключи повтора", () => {
      const keyOf = (update_type: string, chat_id: number, user_id: number) =>
        toInboundUpdates({ update_type, timestamp: 1_700_000_000, chat_id, user: { user_id, name: "Кто-то" } }, { botName: MAX_BOT_NAME })[0]?.key;
      for (const type of ["bot_started", "bot_stopped", "bot_added", "bot_removed"]) {
        const keys = [keyOf(type, 1, 10), keyOf(type, 2, 10), keyOf(type, 1, 11)];
        expect(new Set(keys).size, type).toBe(3);
        expect(keyOf(type, 1, 10), type).toBe(keys[0]);
      }
    });

    it("bot_stopped — blocked; повторный bot_started — start", async () => {
      const [stopped] = await rig.deliver({ type: "blocked", from: rig.anna });
      expect(stopped?.kind).toBe("blocked");
      const [again] = await rig.deliver({ type: "allowed", from: rig.anna });
      expect(again?.kind).toBe("start");
    });

    it("голосовое с готовой расшифровкой: текст приходит вместе с файлом", async () => {
      const [update] = await rig.deliver({ type: "voice", chat: privateChat(), from: rig.anna, audio: oggOpusBytes(2000), durationMs: 2000, transcription: "  привет, мир " });
      expect(update).toMatchObject({ kind: "voice", transcription: "привет, мир" });
      expect(update?.files).toHaveLength(1);
    });

    it("голосовое без расшифровки: только файл", async () => {
      const [update] = await rig.deliver({ type: "voice", chat: privateChat(), from: rig.anna, audio: oggOpusBytes(2000), durationMs: 2000 });
      expect(update?.transcription).toBeUndefined();
      expect(update?.files).toHaveLength(1);
    });

    it("ответ на сообщение другого бота — не ответ нам", async () => {
      const body = fake.webhookBody({ type: "text", chat: rig.chats.group, from: rig.boris, text: "ну?", repliesToBot: true }) as unknown as { message: { link: { sender: { username: string } } } };
      body.message.link.sender.username = "someone_else_bot";
      const { updates } = await post(body, { "x-max-bot-api-secret": MAX_SECRET });
      expect(updates[0]?.group?.replyToBot).toBe(false);
    });

    it("упоминание вырезается из текста, где бы оно ни стояло", async () => {
      const body = fake.webhookBody({ type: "text", chat: rig.chats.group, from: rig.boris, text: "x" }) as unknown as { message: { body: { text: string } } };
      body.message.body.text = `эй @${MAX_BOT_NAME} ответь`;
      const { updates } = await post(body, { "x-max-bot-api-secret": MAX_SECRET });
      expect(updates[0]).toMatchObject({ text: "эй ответь", group: { mentioned: true } });
    });

    it("в групповом сообщении нажатие кнопки: чат из сообщения, человек из нажатия", async () => {
      const [update] = await rig.deliver({ type: "press", chat: rig.chats.group, from: rig.boris, data: "b0000001", messageId: "mid.9" });
      expect(update).toMatchObject({ kind: "button", chat: { id: MAX_GROUP_CHAT, type: "group" }, account: { externalUserId: rig.boris.id } });
    });
  });

  describe("голос на выходе, команды, «печатает…»", () => {
    it("голосовое: POST /uploads?type=audio → вложение audio", async () => {
      await rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(2000), durationMs: 2000 });
      expect(callsOf("POST", "/uploads")[0]?.query.type).toBe("audio");
      expect(rig.outgoing[0]?.kind).toBe("voice");
    });

    it("отказ: тот же звук уходит файлом", async () => {
      rig.rejectNextVoice();
      await rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(2000), durationMs: 2000 });
      expect(callsOf("POST", "/uploads").map((call) => call.query.type)).toEqual(["audio", "file"]);
      expect(rig.outgoing[0]?.kind).toBe("audio-file");
    });

    it("запрет писать на голосовом не прячется за запасным путём", async () => {
      fake.state.denied.add(privateChat().id);
      await expect(rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(1000), durationMs: 1000 })).rejects.toBeInstanceOf(MessengerBlockedError);
      expect(callsOf("POST", "/uploads")).toHaveLength(1);
    });

    it("PATCH /me/commands: имена без косой черты, только для личных чатов", async () => {
      await rig.adapter.setCommands([{ command: "new", description: "Новый чат" }], "private");
      expect(fake.state.commands).toEqual([{ name: "new", description: "Новый чат" }]);
      await rig.adapter.setCommands([{ command: "connect", description: "Подключить" }], "group");
      expect(callsOf("PATCH", "/me/commands")).toHaveLength(1);
    });

    it("пустой список — меню личных чатов снимается", async () => {
      await rig.adapter.setCommands([{ command: "help", description: "Помощь" }], "private");
      await rig.adapter.setCommands([], "private");
      expect(fake.state.commands).toEqual([]);
    });

    it("«печатает…»: POST /chats/<id>/actions с typing_on", async () => {
      await rig.adapter.typing(privateChat());
      expect(callsOf("POST", `/chats/${privateChat().id}/actions`)[0]?.body).toEqual({ action: "typing_on" });
    });
  });
});
