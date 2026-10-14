import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessengerApiError, MessengerBlockedError, MessengerRateLimitError, MessengerWindowClosedError } from "../../src/messenger-api";
import { vkBot } from "../../src/vk/index";
import { createVkAdapter } from "../../src/vk/vk-adapter";
import { createVkClient } from "../../src/vk/vk-client";
import { collectPolled, oggOpusBytes } from "../fake-apis/rig";
import { createVkRig, type FakeVk, VK_CONFIRMATION, VK_GROUP_ID, VK_GROUP_PEER, VK_GROUP_SCREEN_NAME, VK_SECRET, VK_TOKEN } from "../fake-apis/vk";
import { describeAdapterContract } from "./adapter-contract";

const makeBot = (api: { baseUrl: string }, receive: Parameters<typeof vkBot>[0]["receive"]) =>
  vkBot({ token: VK_TOKEN, groupId: VK_GROUP_ID, groupScreenName: VK_GROUP_SCREEN_NAME, receive, api });

describeAdapterContract("VK", () => createVkRig((api, receive) => makeBot(api, receive).adapter));

describe("VK: особенности", () => {
  let rig: Awaited<ReturnType<typeof createVkRig>>;
  let fake: FakeVk;
  beforeEach(async () => {
    rig = await createVkRig((api, receive) => makeBot(api, receive).adapter);
    fake = rig.fake;
  });
  afterEach(async () => {
    await rig.close();
  });

  const privateChat = () => rig.chats.annaPrivate;
  const callsOf = (method: string) => fake.state.calls.filter((call) => call.method === method);
  const callback = (body: unknown) => rig.adapter.readWebhook(new Request("http://app/vk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  describe("бот", () => {
    it("id бота — номер сообщества", () => {
      expect(makeBot({ baseUrl: fake.url }, { callback: { secret: VK_SECRET, confirmation: VK_CONFIRMATION } })).toMatchObject({ messenger: "vk", botId: String(VK_GROUP_ID), receive: "webhook" });
      expect(makeBot({ baseUrl: fake.url }, { longPoll: true })).toMatchObject({ messenger: "vk", botId: String(VK_GROUP_ID), receive: "polling" });
    });

    it("возможности: простой текст, правка живьём, меню команд нет, кусок помещается в правку (≤ 4096)", () => {
      expect(rig.adapter.abilities).toMatchObject({ liveText: "edit", markup: "plain", commandsMenu: false });
      expect(rig.adapter.abilities.textLimit).toBeLessThanOrEqual(4096);
    });

    it("ссылка на бота: vk.me/<группа>?ref=<метка>", () => {
      expect(rig.adapter.linkUrl("Code_123")).toBe(`https://vk.me/${VK_GROUP_SCREEN_NAME}?ref=Code_123`);
    });

    it("setCommands у VK ничего не делает", async () => {
      await rig.adapter.setCommands([{ command: "new", description: "Новый" }], "private");
      expect(fake.state.calls).toEqual([]);
    });

    it("каждый запрос: токен в заголовке, версия API, токен в тексте ошибки спрятан", async () => {
      await rig.adapter.send(privateChat(), { text: "привет", markup: "plain" });
      const [call] = callsOf("messages.send");
      expect(call?.headers.authorization).toBe(`Bearer ${VK_TOKEN}`);
      expect(call?.params.v).toMatch(/^5\.\d+$/);
      fake.failNext("messages.send", { code: 10, message: `internal ${VK_TOKEN}` });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerApiError);
      expect((error as Error).message).not.toContain(VK_TOKEN);
    });
  });

  describe("Callback API", () => {
    it("confirmation: в ответ — строка подтверждения из настроек", async () => {
      const { response, updates } = await callback({ type: "confirmation", group_id: VK_GROUP_ID, secret: VK_SECRET });
      expect(await response.text()).toBe(VK_CONFIRMATION);
      expect(response.status).toBe(200);
      expect(updates).toEqual([]);
    });

    it("confirmation с чужим или пустым секретом — отказ, строку подтверждения не отдаём", async () => {
      for (const body of [{ secret: "wrong-secret" }, { secret: "" }, {}]) {
        const { response, updates } = await callback({ type: "confirmation", group_id: VK_GROUP_ID, ...body });
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain(VK_CONFIRMATION);
        expect(updates).toEqual([]);
      }
    });

    it("секрет не задан — бот не создаётся: без секрета подделку не отличить от VK", () => {
      // undefined и не строка — из незаданной переменной окружения или конфига на JavaScript.
      for (const secret of ["", "   ", undefined, null, 42]) {
        expect(() => makeBot({ baseUrl: fake.url }, { callback: { secret: secret as string, confirmation: VK_CONFIRMATION } })).toThrow(/vk: для Callback API нужен секретный ключ/);
      }
    });

    it("пустой секрет в адаптере — не совпадение: ни confirmation, ни событие не проходят", async () => {
      const adapter = createVkAdapter({ client: createVkClient({ token: VK_TOKEN, api: { baseUrl: fake.url } }), groupId: VK_GROUP_ID, groupScreenName: VK_GROUP_SCREEN_NAME, receive: { callback: { secret: "", confirmation: VK_CONFIRMATION } } });
      const read = (body: unknown) => adapter.readWebhook(new Request("http://app/vk", { method: "POST", body: JSON.stringify(body) }));
      for (const body of [{ type: "confirmation", group_id: VK_GROUP_ID }, { type: "confirmation", group_id: VK_GROUP_ID, secret: "" }, fake.callbackBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" }, "")]) {
        const { response, updates } = await read(body);
        expect(response.status).toBe(403);
        expect(updates).toEqual([]);
      }
    });

    it("событие: ответ строго `ok`", async () => {
      const { response, updates } = await callback(fake.callbackBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" }));
      expect(await response.text()).toBe("ok");
      expect(response.status).toBe(200);
      expect(updates).toHaveLength(1);
    });

    it("секрет — в теле: чужой или пустой — отказ, обновлений нет", async () => {
      for (const secret of ["wrong-secret", ""]) {
        const { response, updates } = await callback(fake.callbackBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" }, secret));
        expect(response.status).toBe(403);
        expect(updates).toEqual([]);
      }
    });

    it("событие чужого сообщества пропускается, но отвечаем `ok`", async () => {
      const body = { ...fake.callbackBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" }), group_id: 1 };
      const { response, updates } = await callback(body);
      expect(await response.text()).toBe("ok");
      expect(updates).toEqual([]);
    });

    it("ключ повтора — event_id", async () => {
      const body = fake.callbackBody({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      const { updates } = await callback(body);
      expect(updates[0]?.key).toBe(`vk:${VK_GROUP_ID}:${body.event_id}`);
    });

    it("сообщение от самого сообщества пропускается", async () => {
      const body = fake.callbackBody({ type: "text", chat: privateChat(), from: rig.anna, text: "эхо" }) as { object: { message: { from_id: number } } };
      body.object.message.from_id = -VK_GROUP_ID;
      const { updates } = await callback(body);
      expect(updates).toEqual([]);
    });

    it("имя человека берётся через users.get один раз", async () => {
      await rig.deliver({ type: "text", chat: privateChat(), from: rig.anna, text: "раз" });
      await rig.deliver({ type: "text", chat: privateChat(), from: rig.anna, text: "два" });
      expect(callsOf("users.get")).toHaveLength(1);
    });

    it("users.get не ответил — имя по номеру, обновление не теряется", async () => {
      fake.failNext("users.get", { code: 10, message: "internal" });
      const [update] = await rig.deliver({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      expect(update?.account.name).toBe(`id${rig.anna.id}`);
    });
  });

  describe("Long Poll", () => {
    const pollOne = async () => {
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "привет" });
      return collectPolled(makeBot({ baseUrl: fake.url }, { longPoll: true }).adapter, 1);
    };

    it("getLongPollServer → a_check с ключом, ts и ожиданием не больше 90", async () => {
      const [update] = await pollOne();
      expect(update).toMatchObject({ kind: "text", text: "привет" });
      expect(callsOf("groups.getLongPollServer")[0]?.params.group_id).toBe(String(VK_GROUP_ID));
      const request = fake.state.lpRequests[0];
      expect(request?.key).toBe("lpkey-1");
      expect(Number(request?.wait)).toBeGreaterThan(0);
      expect(Number(request?.wait)).toBeLessThanOrEqual(90);
    });

    it("Long Poll включается в настройках сообщества (на случай, если ещё не включён)", async () => {
      await pollOne();
      expect(fake.state.lpSettings).toMatchObject({ enabled: "1", message_new: "1", message_event: "1", message_allow: "1", message_deny: "1" });
    });

    it("не включился (нет прав) — опрос всё равно идёт", async () => {
      fake.failNext("groups.setLongPollSettings", { code: 15, message: "Access denied" });
      const [update] = await pollOne();
      expect(update?.text).toBe("привет");
    });

    it("ts идёт следом за последним ответом", async () => {
      const bot = makeBot({ baseUrl: fake.url }, { longPoll: true });
      const controller = new AbortController();
      const iterator = bot.adapter.poll(controller.signal)[Symbol.asyncIterator]();
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "раз" });
      await iterator.next();
      fake.enqueue({ type: "text", chat: privateChat(), from: rig.anna, text: "два" });
      const second = await iterator.next();
      expect(second.value).toMatchObject({ text: "два" });
      controller.abort();
      await iterator.return?.(undefined);
      expect(fake.state.lpRequests.map((request) => request.ts)).toEqual(expect.arrayContaining(["0", "1"]));
    });

    it("failed 1: берём новый ts из ответа, сервер не запрашиваем заново", async () => {
      fake.state.lpFailure = 1;
      const [update] = await pollOne();
      expect(update?.text).toBe("привет");
      expect(fake.state.lpServerCalls).toBe(1);
    });

    it("failed 2: ключ устарел — запрашиваем сервер заново", async () => {
      fake.state.lpFailure = 2;
      const [update] = await pollOne();
      expect(update?.text).toBe("привет");
      expect(fake.state.lpServerCalls).toBe(2);
    });

    it("failed 3: данные потеряны — сервер и ts заново", async () => {
      fake.state.lpFailure = 3;
      const [update] = await pollOne();
      expect(update?.text).toBe("привет");
      expect(fake.state.lpServerCalls).toBe(2);
    });
  });

  describe("отправка", () => {
    it("messages.send: random_id не ноль и каждый раз новый, простой текст", async () => {
      await rig.adapter.send(privateChat(), { text: "раз", markup: "plain" });
      await rig.adapter.send(privateChat(), { text: "два", markup: "plain" });
      const ids = callsOf("messages.send").map((call) => call.params.random_id);
      expect(ids.every((id) => id && id !== "0")).toBe(true);
      expect(new Set(ids).size).toBe(2);
      expect(callsOf("messages.send")[0]?.params).toMatchObject({ peer_id: "100", message: "раз" });
    });

    it("разметка не передаётся: VK её не знает", async () => {
      await rig.adapter.send(privateChat(), { text: "<b>x</b>", markup: "plain" });
      expect(callsOf("messages.send")[0]?.params.parse_mode).toBeUndefined();
      expect(callsOf("messages.send")[0]?.params.format_data).toBeUndefined();
    });

    it("кнопки: inline-клавиатура с callback и payload", async () => {
      await rig.adapter.send(privateChat(), { text: "Выбрать", markup: "plain", buttons: [[{ id: "b0000001", text: "Да" }, { id: "b0000002", text: "Нет", url: "https://app.example/x" }]] });
      const keyboard = JSON.parse(callsOf("messages.send")[0]?.params.keyboard ?? "{}") as { inline: boolean; buttons: Array<Array<{ action: { type: string; payload?: string; link?: string } }>> };
      expect(keyboard.inline).toBe(true);
      expect(keyboard.buttons[0]?.[0]?.action.type).toBe("callback");
      expect(keyboard.buttons[0]?.[1]?.action).toMatchObject({ type: "open_link", link: "https://app.example/x" });
    });

    it("правка: messages.edit с peer_id и message_id; в 4000 знаков укладывается", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "а", markup: "plain" });
      await rig.adapter.edit(sent, { text: "б".repeat(4000), markup: "plain" });
      expect(callsOf("messages.edit")[0]?.params).toMatchObject({ peer_id: "100", message_id: sent.messageId });
      expect(rig.outgoing[0]?.text).toHaveLength(4000);
    });

    it("удаление: messages.delete для всех по peer_id и message_ids", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "Ищу в интернете…", markup: "plain" });
      await rig.adapter.deleteMessage?.(sent);
      expect(callsOf("messages.delete")[0]?.params).toMatchObject({ peer_id: "100", message_ids: sent.messageId, delete_for_all: "1" });
      expect(rig.outgoing).toEqual([]);
    });

    it("правка без поля кнопок их не трогает", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "а", markup: "plain", buttons: [[{ id: "b0000001", text: "Да" }]] });
      await rig.adapter.edit(sent, { text: "б", markup: "plain" });
      expect(rig.outgoing[0]?.buttons.flat()).toHaveLength(1);
    });

    it("6 — слишком часто: MessengerRateLimitError с паузой", async () => {
      fake.failNext("messages.send", { code: 6, message: "Too many requests per second" });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerRateLimitError);
      expect((error as MessengerRateLimitError).retryAfterMs).toBeGreaterThan(0);
    });

    it("901, 902 и 993 — писать нельзя: MessengerBlockedError", async () => {
      for (const code of [901, 902, 993]) {
        fake.failNext("messages.send", { code, message: "Can't send messages for users without permission" });
        await expect(rig.adapter.send(privateChat(), { text: "x", markup: "plain" })).rejects.toBeInstanceOf(MessengerBlockedError);
      }
    });

    it("950 — окно ответа закрыто (писать первым нельзя): MessengerWindowClosedError, не блокировка (061)", async () => {
      fake.failNext("messages.send", { code: 950, message: "Can't send message, reply timed out" });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerWindowClosedError);
      expect(error).not.toBeInstanceOf(MessengerBlockedError);
      expect((error as Error).message).toContain("950");
    });

    it("прочая ошибка API — MessengerApiError с кодом в тексте", async () => {
      fake.failNext("messages.send", { code: 914, message: "Message is too long" });
      const error = await rig.adapter.send(privateChat(), { text: "x", markup: "plain" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MessengerApiError);
      expect(error).not.toBeInstanceOf(MessengerBlockedError);
      expect((error as Error).message).toContain("914");
    });

    it("картинка: сервер загрузки → загрузка → сохранение → вложение", async () => {
      await rig.adapter.send(privateChat(), { text: "схема", markup: "plain", photo: { bytes: new Uint8Array([1, 2, 3]), name: "a.png" } });
      expect(callsOf("photos.getMessagesUploadServer")).toHaveLength(1);
      expect(callsOf("photos.saveMessagesPhoto")).toHaveLength(1);
      expect(callsOf("messages.send")[0]?.params.attachment).toMatch(/^photo-?\d+_\d+/);
    });

    it("картинка по ссылке: VK ссылок не берёт — скачиваем и загружаем", async () => {
      const path = "/files/remote.png";
      fake.state.files.set(path, { bytes: new Uint8Array([9, 9, 9]), type: "image/png" });
      await rig.adapter.send(privateChat(), { text: "", markup: "plain", photo: { url: `${fake.url}${path}` } });
      expect([...(rig.outgoing[0]?.bytes ?? [])]).toEqual([9, 9, 9]);
    });

    it("«печатает…»: messages.setActivity с типом typing", async () => {
      await rig.adapter.typing(privateChat());
      expect(callsOf("messages.setActivity")[0]?.params).toMatchObject({ peer_id: "100", type: "typing" });
    });
  });

  describe("кнопки на входе", () => {
    it("message_event: ответ — sendMessageEventAnswer с event_id, user_id, peer_id; текст — всплывашкой", async () => {
      const sent = await rig.adapter.send(privateChat(), { text: "Выбрать", markup: "plain", buttons: [[{ id: "b0000001", text: "Да" }]] });
      const [update] = await rig.deliver({ type: "press", chat: privateChat(), from: rig.anna, data: rig.outgoing[0]?.buttons[0]?.[0]?.data ?? "", messageId: sent.messageId });
      expect(update).toMatchObject({ kind: "button", buttonId: "b0000001" });
      const press = { chat: update?.chat as NonNullable<typeof update>["chat"], account: update?.account as NonNullable<typeof update>["account"], buttonId: "b0000001", callbackId: update?.callbackId ?? "" };
      await rig.adapter.answerButton(press, "Готово");
      expect(fake.state.eventAnswers).toEqual([{ callbackId: update?.callbackId, userId: rig.anna.id, peerId: "100", text: "Готово" }]);
    });

    it("текст всплывашки длиннее 90 знаков обрезается", async () => {
      const press = { chat: privateChat(), account: { messenger: "vk" as const, botId: String(VK_GROUP_ID), externalUserId: "100", name: "Анна" }, buttonId: "b0000001", callbackId: "ev1" };
      await rig.adapter.answerButton(press, "я".repeat(200));
      expect(fake.state.eventAnswers[0]?.text?.length).toBeLessThanOrEqual(90);
    });
  });

  describe("входящие", () => {
    it("ссылка vk.me/…?ref=: старт с меткой; кнопка «Начать»: старт без метки", async () => {
      const [withRef] = await rig.deliver({ type: "start", from: rig.anna, payload: "scenario_1" });
      expect(withRef).toMatchObject({ kind: "start", startPayload: "scenario_1" });
      const [plain] = await rig.deliver({ type: "start", from: rig.anna });
      expect(plain).toMatchObject({ kind: "start" });
      expect(plain?.startPayload).toBeUndefined();
    });

    it("беседа: peer_id ≥ 2·10⁹ — группа, личный диалог — личный чат", async () => {
      const [group] = await rig.deliver({ type: "text", chat: rig.chats.group, from: rig.boris, text: "всем" });
      expect(group?.chat).toEqual({ id: String(VK_GROUP_PEER), type: "group" });
      const [direct] = await rig.deliver({ type: "text", chat: privateChat(), from: rig.anna, text: "мне" });
      expect(direct?.chat.type).toBe("private");
    });

    it("в группе кнопку нажал участник: чат — беседа", async () => {
      const [update] = await rig.deliver({ type: "press", chat: rig.chats.group, from: rig.boris, data: JSON.stringify({ b: "b0000001" }), messageId: "5" });
      expect(update).toMatchObject({ kind: "button", chat: { id: String(VK_GROUP_PEER), type: "group" }, account: { externalUserId: rig.boris.id } });
    });

    it("голосовое: берётся ogg-ссылка, длина в миллисекундах", async () => {
      const [update] = await rig.deliver({ type: "voice", chat: privateChat(), from: rig.anna, audio: oggOpusBytes(5000), durationMs: 5000 });
      expect(update?.files?.[0]).toMatchObject({ mediaType: "audio/ogg", durationMs: 5000 });
    });

    it("нет ogg-ссылки — берётся mp3", async () => {
      const body = fake.callbackBody({ type: "voice", chat: privateChat(), from: rig.anna, audio: oggOpusBytes(1000), durationMs: 1000 }) as { object: { message: { attachments: Array<{ audio_message: Record<string, string | undefined> }> } } };
      const voice = body.object.message.attachments[0]?.audio_message;
      if (voice) {
        voice.link_mp3 = `${fake.url}/files/x.mp3`;
        delete voice.link_ogg;
      }
      fake.state.files.set("/files/x.mp3", { bytes: new Uint8Array([1, 2]), type: "audio/mpeg" });
      const { updates } = await callback(body);
      expect(updates[0]?.files?.[0]?.mediaType).toBe("audio/mpeg");
      const file = updates[0]?.files?.[0];
      const downloaded = await rig.adapter.downloadFile(file as NonNullable<typeof file>);
      expect([...downloaded.bytes]).toEqual([1, 2]);
    });

    it("message_allow и message_deny: личный чат человека", async () => {
      const [allowed] = await rig.deliver({ type: "allowed", from: rig.anna });
      expect(allowed).toMatchObject({ kind: "allowed", chat: { id: "100", type: "private" } });
    });

    it("в беседу пригласили кого-то другого — не наше событие", async () => {
      const body = fake.callbackBody({ type: "bot_added", chat: rig.chats.group, by: rig.boris }) as { object: { message: { action: { member_id: number } } } };
      body.object.message.action.member_id = 4242;
      const { updates } = await callback(body);
      expect(updates).toEqual([]);
    });

    it("упоминание [club777|…] вырезается из текста", async () => {
      const [update] = await rig.deliver({ type: "text", chat: rig.chats.group, from: rig.boris, text: "/connect", mentionsBot: true });
      expect(update).toMatchObject({ kind: "command", text: "/connect", group: { mentioned: true } });
    });

    it("упоминание другого сообщества — не наше", async () => {
      const body = fake.callbackBody({ type: "text", chat: rig.chats.group, from: rig.boris, text: "x" }) as { object: { message: { text: string } } };
      body.object.message.text = "[club1|@other] привет";
      const { updates } = await callback(body);
      expect(updates[0]?.group?.mentioned).toBe(false);
    });
  });

  describe("голос на выходе", () => {
    it("три шага: сервер загрузки audio_message → загрузка → docs.save → вложение doc", async () => {
      await rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(2000), durationMs: 2000 });
      expect(callsOf("docs.getMessagesUploadServer")[0]?.params).toMatchObject({ type: "audio_message", peer_id: "100" });
      expect(callsOf("docs.save")).toHaveLength(1);
      expect(callsOf("messages.send")[0]?.params.attachment).toMatch(/^doc-?\d+_\d+/);
    });

    it("отказ: тот же звук уходит документом, а не теряется", async () => {
      rig.rejectNextVoice();
      await rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(2000), durationMs: 2000 });
      expect(callsOf("docs.getMessagesUploadServer").map((call) => call.params.type)).toEqual(["audio_message", "doc"]);
    });

    it("закрытое окно на голосовом не прячется за запасным путём (061)", async () => {
      fake.failNext("messages.send", { code: 950, message: "Can't send message, reply timed out" });
      await expect(rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(1000), durationMs: 1000 })).rejects.toBeInstanceOf(MessengerWindowClosedError);
      expect(callsOf("docs.getMessagesUploadServer")).toHaveLength(1);
    });

    it("запрет писать на голосовом не прячется за запасным путём", async () => {
      fake.failNext("messages.send", { code: 901, message: "Can't send messages for users without permission" });
      await expect(rig.adapter.sendVoice(privateChat(), { audio: oggOpusBytes(1000), durationMs: 1000 })).rejects.toBeInstanceOf(MessengerBlockedError);
      expect(callsOf("docs.getMessagesUploadServer")).toHaveLength(1);
    });
  });
});
