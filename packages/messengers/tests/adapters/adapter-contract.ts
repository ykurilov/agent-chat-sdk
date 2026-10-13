import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExternalChat, MessengerAdapter, OutboundMessage } from "../../src/messenger-adapter";
import { type AdapterRig, anna, boris, isOggOpus, oggOpusBytes } from "../fake-apis/rig";

const bytesOf = (...values: number[]) => new Uint8Array(values);

/**
 * Общий набор тестов адаптера: одни и те же ожидания для Telegram, VK и MAX.
 * Мессенджеры подставляют свой поддельный сервер (`createRig`), всё остальное — одно и то же.
 */
export function describeAdapterContract(title: string, createRig: () => Promise<AdapterRig>) {
  describe(`${title}: общий договор адаптера`, () => {
    let rig: AdapterRig;
    let adapter: MessengerAdapter;
    let privateChat: ExternalChat;
    let groupChat: ExternalChat;

    beforeEach(async () => {
      rig = await createRig();
      adapter = rig.adapter;
      privateChat = rig.chats.annaPrivate;
      groupChat = rig.chats.group;
    });
    afterEach(async () => {
      await rig.close();
    });

    const plain = (text: string, extra: Partial<OutboundMessage> = {}): OutboundMessage => ({ text, markup: "plain", ...extra });
    const lastOutgoing = () => {
      const message = rig.outgoing.at(-1);
      if (!message) throw new Error("сервер не получил ни одного сообщения");
      return message;
    };

    describe("вход", () => {
      it("личный текст: чат, человек, ключ повтора", async () => {
        const [update] = await rig.deliver({ type: "text", chat: privateChat, from: anna, text: "Привет, бот" });
        expect(update).toMatchObject({
          kind: "text",
          text: "Привет, бот",
          chat: privateChat,
          account: { messenger: rig.messenger, botId: rig.botId, externalUserId: anna.id, name: anna.name },
        });
        expect(update?.group).toBeUndefined();
        expect(update?.key).toContain(rig.botId);
      });

      it("тело вебхука больше 1 МиБ не читается целиком: 413, обновлений нет", async () => {
        const { response, updates } = await rig.adapter.readWebhook(rig.signedWebhook(`{"pad":"${"x".repeat(2 * 1024 * 1024)}"}`));
        expect(response.status).toBe(413);
        expect(updates).toEqual([]);
      });

      it("ключи двух разных сообщений разные", async () => {
        const first = await rig.deliver({ type: "text", chat: privateChat, from: anna, text: "раз" });
        const second = await rig.deliver({ type: "text", chat: privateChat, from: anna, text: "два" });
        expect(first[0]?.key).not.toBe(second[0]?.key);
      });

      it("то же событие по опросу приходит тем же обновлением, что и по вебхуку", async () => {
        const event = { type: "text", chat: privateChat, from: anna, text: "Опрос" } as const;
        const [byWebhook] = await rig.deliver(event);
        const [byPoll] = await rig.poll([event]);
        expect(byPoll).toBeDefined();
        expect({ ...byPoll, key: "" }).toEqual({ ...byWebhook, key: "" });
      });

      it("несколько событий в одном опросе приходят по порядку", async () => {
        const updates = await rig.poll([
          { type: "text", chat: privateChat, from: anna, text: "первое" },
          { type: "text", chat: privateChat, from: anna, text: "второе" },
        ]);
        expect(updates.map((update) => update.text)).toEqual(["первое", "второе"]);
      });

      it("команда с косой чертой — это `command`", async () => {
        const [update] = await rig.deliver({ type: "text", chat: privateChat, from: anna, text: "/new" });
        expect(update).toMatchObject({ kind: "command", text: "/new" });
      });

      it("ссылка на бота с меткой: `start` и метка", async () => {
        const [update] = await rig.deliver({ type: "start", from: anna, payload: "Abc123_x-Y" });
        expect(update).toMatchObject({ kind: "start", startPayload: "Abc123_x-Y", chat: privateChat, account: { externalUserId: anna.id } });
      });

      it("начало разговора без метки: `start` без метки", async () => {
        const [update] = await rig.deliver({ type: "start", from: anna });
        expect(update?.kind).toBe("start");
        expect(update?.startPayload).toBeUndefined();
      });

      it("человек остановил бота — `blocked`, снова разрешил — `allowed`", async () => {
        const [blocked] = await rig.deliver({ type: "blocked", from: anna });
        expect(blocked).toMatchObject({ kind: "blocked", chat: privateChat, account: { externalUserId: anna.id } });
        const [allowed] = await rig.deliver({ type: "allowed", from: anna });
        expect(allowed?.kind).toBe(rig.allowedArrivesAsStart ? "start" : "allowed");
        expect(allowed?.chat).toEqual(privateChat);
      });
    });

    describe("файлы и голос на входе", () => {
      it("документ: имя, вид, размер; байты забираются отдельно", async () => {
        const bytes = bytesOf(1, 2, 3, 4, 5);
        const [update] = await rig.deliver({ type: "file", chat: privateChat, from: anna, name: "отчёт.pdf", mediaType: "application/pdf", bytes, caption: "Посмотри" });
        expect(update).toMatchObject({ kind: "files", text: "Посмотри" });
        const file = update?.files?.[0];
        expect(file).toMatchObject({ name: "отчёт.pdf", mediaType: "application/pdf", size: 5 });
        const downloaded = await adapter.downloadFile(file as NonNullable<typeof file>);
        expect([...downloaded.bytes]).toEqual([...bytes]);
        expect(downloaded.name).toBe("отчёт.pdf");
        expect(downloaded.mediaType).toBe("application/pdf");
      });

      it("фото: приходит как картинка, берётся самый большой размер", async () => {
        const bytes = bytesOf(9, 8, 7);
        const [update] = await rig.deliver({ type: "file", chat: privateChat, from: anna, name: "photo.jpg", mediaType: "image/jpeg", bytes });
        const file = update?.files?.[0];
        expect(update?.kind).toBe("files");
        expect(file?.mediaType).toBe("image/jpeg");
        const downloaded = await adapter.downloadFile(file as NonNullable<typeof file>);
        expect([...downloaded.bytes]).toEqual([...bytes]);
      });

      it("голосовое: `voice`, звук — Ogg с OpusHead, длина", async () => {
        const audio = oggOpusBytes(3000);
        const [update] = await rig.deliver({ type: "voice", chat: privateChat, from: anna, audio, durationMs: 3000 });
        expect(update?.kind).toBe("voice");
        const file = update?.files?.[0];
        expect(file).toBeDefined();
        const downloaded = await adapter.downloadFile(file as NonNullable<typeof file>);
        expect(isOggOpus(downloaded.bytes)).toBe(true);
        expect([...downloaded.bytes]).toEqual([...audio]);
        expect(downloaded.mediaType).toContain("ogg");
      });

      it("если мессенджер сам распознал голос, текст приходит с обновлением (MAX); у остальных его нет", async () => {
        const [update] = await rig.deliver({ type: "voice", chat: privateChat, from: anna, audio: oggOpusBytes(1000), durationMs: 1000, transcription: "купи молоко" });
        expect(update?.transcription).toBe(rig.messenger === "max" ? "купи молоко" : undefined);
      });
    });

    describe("группы", () => {
      it("упоминание бота: `mentioned`, текст без упоминания", async () => {
        const [update] = await rig.deliver({ type: "text", chat: groupChat, from: boris, text: "расскажи анекдот", mentionsBot: true });
        expect(update).toMatchObject({ kind: "text", text: "расскажи анекдот", chat: groupChat, group: { mentioned: true, replyToBot: false }, account: { externalUserId: boris.id, name: boris.name } });
      });

      it("обычное сообщение в группе: не упоминание и не ответ боту", async () => {
        const [update] = await rig.deliver({ type: "text", chat: groupChat, from: boris, text: "всем привет" });
        expect(update?.group).toEqual({ mentioned: false, replyToBot: false });
      });

      it("ответ на сообщение бота: `replyToBot`", async () => {
        const [update] = await rig.deliver({ type: "text", chat: groupChat, from: boris, text: "а подробнее?", repliesToBot: true });
        expect(update?.group).toEqual({ mentioned: false, replyToBot: true });
      });

      it("команда в группе остаётся командой", async () => {
        const [update] = await rig.deliver({ type: "text", chat: groupChat, from: boris, text: "/connect", mentionsBot: false });
        expect(update).toMatchObject({ kind: "command", chat: groupChat });
      });

      it("бот добавлен в группу и удалён из неё", async () => {
        const [added] = await rig.deliver({ type: "bot_added", chat: groupChat, by: boris });
        expect(added).toMatchObject({ kind: "bot_added", chat: groupChat, account: { externalUserId: boris.id } });
        const [removed] = await rig.deliver({ type: "bot_removed", chat: groupChat, by: boris });
        expect(removed).toMatchObject({ kind: "bot_removed", chat: groupChat });
      });

      it("кнопку в группе нажал участник: чат и человек из нажатия", async () => {
        const sent = await adapter.send(groupChat, plain("Разрешить?", { buttons: [[{ id: "ab12cd34", text: "Да" }]] }));
        const [update] = await rig.deliver({ type: "press", chat: groupChat, from: boris, data: lastOutgoing().buttons[0]?.[0]?.data ?? "", messageId: sent.messageId });
        expect(update).toMatchObject({ kind: "button", buttonId: "ab12cd34", chat: groupChat, account: { externalUserId: boris.id } });
      });
    });

    describe("выход", () => {
      it("текст: уходит в нужный чат, номер сообщения возвращается", async () => {
        const sent = await adapter.send(privateChat, plain("Здравствуйте"));
        expect(sent.chat).toEqual(privateChat);
        expect(sent.messageId).toBeTruthy();
        expect(lastOutgoing()).toMatchObject({ chatId: privateChat.id, messageId: sent.messageId, kind: "text", text: "Здравствуйте", format: "plain" });
      });

      it("разметка: html уходит html там, где он есть, и простым текстом там, где нет", async () => {
        await adapter.send(privateChat, { text: "<b>важно</b>", markup: adapter.abilities.markup });
        expect(lastOutgoing().format).toBe(adapter.abilities.markup);
        expect(lastOutgoing().text).toBe("<b>важно</b>");
      });

      it("правка: тот же номер, новый текст", async () => {
        const sent = await adapter.send(privateChat, plain("черновик"));
        await adapter.edit(sent, plain("готово"));
        expect(rig.outgoing).toHaveLength(1);
        expect(lastOutgoing()).toMatchObject({ messageId: sent.messageId, text: "готово", edits: 1 });
      });

      it("кнопки: ряды и подписи на месте, внутри только короткий номер", async () => {
        await adapter.send(privateChat, plain("Выберите", { buttons: [[{ id: "b0000001", text: "Да" }, { id: "b0000002", text: "Нет" }], [{ id: "b0000003", text: "Позже" }]] }));
        const rows = lastOutgoing().buttons;
        expect(rows.map((row) => row.map((button) => button.text))).toEqual([["Да", "Нет"], ["Позже"]]);
        for (const button of rows.flat()) expect(button.data).toContain("b000000");
      });

      it("нажатие кнопки: номер и ответ на нажатие", async () => {
        const sent = await adapter.send(privateChat, plain("Выберите", { buttons: [[{ id: "b0000001", text: "Да" }, { id: "b0000002", text: "Нет" }]] }));
        const data = lastOutgoing().buttons[0]?.[1]?.data ?? "";
        const [update] = await rig.deliver({ type: "press", chat: privateChat, from: anna, data, messageId: sent.messageId });
        expect(update).toMatchObject({ kind: "button", buttonId: "b0000002", chat: privateChat, account: { externalUserId: anna.id } });
        expect(update?.callbackId).toBeTruthy();
        const press = { chat: privateChat, account: update?.account as NonNullable<typeof update>["account"], buttonId: "b0000002", callbackId: update?.callbackId ?? "" };

        await adapter.answerButton(press);
        await adapter.answerButton(press, "Принято.");
        expect(rig.answers).toHaveLength(2);
        expect(rig.answers[0]?.text).toBeUndefined();
        expect(rig.answers[1]?.text).toBe("Принято.");
        expect(rig.answers[0]?.callbackId).toBeTruthy();
      });

      it("правка с новыми кнопками заменяет их, правка с пустым списком убирает", async () => {
        const sent = await adapter.send(privateChat, plain("Выберите", { buttons: [[{ id: "b0000001", text: "Да" }]] }));
        await adapter.edit(sent, plain("Выберите ещё", { buttons: [[{ id: "b0000009", text: "Другое" }]] }));
        expect(lastOutgoing().buttons.flat().map((button) => button.text)).toEqual(["Другое"]);
        await adapter.edit(sent, plain("Выбрано", { buttons: [] }));
        expect(lastOutgoing()).toMatchObject({ text: "Выбрано", buttons: [] });
      });

      it("картинка с подписью", async () => {
        const bytes = bytesOf(137, 80, 78, 71);
        await adapter.send(privateChat, plain("Вот схема", { photo: { bytes, name: "схема.png" } }));
        expect(lastOutgoing()).toMatchObject({ kind: "photo", text: "Вот схема", chatId: privateChat.id });
        expect([...(lastOutgoing().bytes ?? [])]).toEqual([...bytes]);
      });

      it("«печатает…» уходит в нужный чат", async () => {
        await adapter.typing(privateChat);
        expect(rig.typing).toEqual([privateChat.id]);
      });

      it("голосовой ответ: Ogg с OpusHead уходит голосовым", async () => {
        const audio = oggOpusBytes(2000);
        const sent = await adapter.sendVoice(privateChat, { audio, durationMs: 2000 });
        expect(sent.chat).toEqual(privateChat);
        expect(sent.messageId).toBeTruthy();
        expect(lastOutgoing()).toMatchObject({ kind: "voice", chatId: privateChat.id });
        expect(isOggOpus(lastOutgoing().bytes ?? new Uint8Array())).toBe(true);
        expect([...(lastOutgoing().bytes ?? [])]).toEqual([...audio]);
      });

      it("мессенджер отказал в голосовом — тот же звук уходит звуковым файлом", async () => {
        const audio = oggOpusBytes(2000);
        rig.rejectNextVoice();
        const sent = await adapter.sendVoice(privateChat, { audio, durationMs: 2000 });
        expect(rig.outgoing).toHaveLength(1);
        expect(lastOutgoing()).toMatchObject({ kind: "audio-file", chatId: privateChat.id, messageId: sent.messageId });
        expect([...(lastOutgoing().bytes ?? [])]).toEqual([...audio]);
      });
    });

    describe("меню команд", () => {
      it("команды уходят по областям: личные и групповые отдельно (где мессенджер это умеет)", async () => {
        const commands = [{ command: "new", description: "Новый чат" }, { command: "stop", description: "Остановить ответ" }];
        if (!adapter.abilities.commandsMenu) {
          expect(rig.commandScopes).toEqual([]);
          return;
        }
        for (const scope of rig.commandScopes) await adapter.setCommands(commands, scope);
        expect(rig.commands.map((item) => item.scope).sort()).toEqual([...rig.commandScopes].sort());
        for (const item of rig.commands) expect(item.commands).toEqual(commands);
      });
    });

    describe("ссылка на бота", () => {
      it("ссылка привязки — https, с кодом", () => {
        const url = adapter.linkUrl("Code_123-xyz");
        expect(url.startsWith("https://")).toBe(true);
        expect(url).toContain("Code_123-xyz");
      });
    });
  });
}
