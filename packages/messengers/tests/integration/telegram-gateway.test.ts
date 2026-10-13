import { afterEach, describe, expect, it } from "vitest";
import { messengerTexts } from "../../src/messenger-texts";
import type { ChatRequest } from "../../src/types";
import { anna, boris } from "../fake-apis/rig";
import { allChannels, telegramChannel } from "./support/channels";
import { memoryOf, type RealChat, startRealChat } from "./support/real-chat";
import { TURN_COST_USD } from "./support/scripted-model";

const annaChat = { id: anna.id, type: "private" as const };
const say = (chat: RealChat, text: string) => chat.human({ type: "text", chat: annaChat, from: anna, text });

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

describe.each(allChannels)("T070 шлюз на настоящей службе, $name, настройки по умолчанию", ({ open }) => {
  it("сообщение → ответ; второе — в тот же чат; история видна в вебе с origin мессенджера; память пользователя", async () => {
    const channel = await open();
    chat = await startRealChat({ channel });
    await chat.link(anna, "anna");
    const dialog = channel.privateChatOf(anna);
    const sayHere = (text: string) => (chat as RealChat).human({ type: "text", chat: dialog, from: anna, text });

    await sayHere("Привет");
    expect(chat.textsIn(dialog.id)).toEqual(["Ответ 1"]);
    expect(chat.model.lastPromptText()).toContain(memoryOf("anna"));

    await sayHere("Как дела?");
    expect(chat.textsIn(dialog.id)).toEqual(["Ответ 1", "Ответ 2"]);

    const chats = await chat.service.listChats("anna");
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ origin: channel.messenger });
    const listed = (await (await chat.web("GET", "")).json()) as { chats: Array<{ id: string; origin?: string }> };
    expect(listed.chats).toEqual([expect.objectContaining({ id: chats[0]?.id, origin: channel.messenger })]);

    const history = await chat.service.getHistory("anna", chats[0]?.id as string);
    const texts = history.messages.map((message) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""));
    expect(texts).toEqual(["Привет", "Ответ 1", "Как дела?", "Ответ 2"]);
    expect(chat.errors).toEqual([]);
  });

  it("тот же лимит, что в вебе: исчерпан — сообщение со временем сброса, агент не запускается", async () => {
    const channel = await open();
    chat = await startRealChat({ channel, budgetUsd: TURN_COST_USD });
    await chat.link(anna, "anna");
    const webChat = (await (await chat.web("POST", "")).json()) as { id: string };
    const webTurn = await chat.web("POST", `/${webChat.id}/messages`, { message: { id: "w1", role: "user", parts: [{ type: "text", text: "Из веба" }] } });
    await webTurn.text();
    const modelCalls = chat.model.calls.length;

    const dialog = channel.privateChatOf(anna);
    await chat.human({ type: "text", chat: dialog, from: anna, text: "Привет" });
    const [answer] = chat.textsIn(dialog.id);
    expect(answer).toBe(messengerTexts.limitReached({ resetsAt: "2026-11-01T00:00:00.000Z" }));
    expect(answer).toContain("1 ноября в 00:00");
    expect(chat.model.calls.length).toBe(modelCalls);
  });
});

describe("T071 режимы разговора", () => {
  it("«один разговор»: чат удалён в вебе — следующий ответ в новом чате", async () => {
    chat = await startRealChat({ channel: await telegramChannel() });
    await chat.link(anna, "anna");
    await say(chat, "Привет");
    const [first] = await chat.service.listChats("anna");
    expect((await chat.web("DELETE", `/${first?.id}`)).status).toBeLessThan(300);

    await say(chat, "Снова я");
    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1", "Ответ 2"]);
    const chats = await chat.service.listChats("anna");
    expect(chats).toHaveLength(1);
    expect(chats[0]?.id).not.toBe(first?.id);
    expect(chats[0]).toMatchObject({ origin: "telegram" });
  });

  it("«много чатов»: /new начинает новый, /chats выбирает из последних 5", async () => {
    chat = await startRealChat({ channel: await telegramChannel(), messengers: { conversations: "many" } });
    await chat.link(anna, "anna");
    for (let index = 1; index <= 6; index++) {
      if (index > 1) await say(chat, "/new");
      await say(chat, `Тема ${index}`);
    }
    expect(await chat.service.listChats("anna")).toHaveLength(6);

    await say(chat, "/chats");
    const list = chat.channel.outgoing.at(-1);
    expect(list?.text).toBe(messengerTexts.chatsTitle);
    const choices = list?.buttons.flat() ?? [];
    expect(choices.map((button) => button.text)).toEqual(["Тема 6", "Тема 5", "Тема 4", "Тема 3", "Тема 2"]);

    const second = choices[3];
    await chat.human({ type: "press", chat: annaChat, from: anna, data: second?.data as string, messageId: list?.messageId as string });
    expect(chat.textsIn(anna.id).at(-1)).toBe(messengerTexts.chatSelected("Тема 3"));
    await say(chat, "Продолжим");
    const chosen = (await chat.service.listChats("anna")).find((item) => item.title === "Тема 3");
    const history = await chat.service.getHistory("anna", chosen?.id as string);
    expect(history.messages.at(-2)?.parts).toContainEqual(expect.objectContaining({ type: "text", text: "Продолжим" }));
  });
});

describe("T072 правило чата: ссылка с меткой сценария", () => {
  /** Правило приложения: метка `lesson5` — свой чат «Урок 5», агент начинает первым; при идущем разговоре — остаёмся в нём. */
  async function withLessonRule() {
    const requests: ChatRequest[] = [];
    const holder: { chat?: RealChat } = {};
    const real = await startRealChat({
      channel: await telegramChannel(),
      messengers: {
        async chatForConversation(request) {
          requests.push(request);
          const service = holder.chat?.service;
          if (!service) throw new Error("служба ещё не готова");
          if (request.reason === "start_payload" && request.currentChatId) return { chatId: request.currentChatId };
          const created = await service.createChat(request.userId, { origin: "telegram" });
          if (request.startPayload !== "lesson5") return { chatId: created.id };
          await service.renameChat(request.userId, created.id, "Урок 5");
          return { chatId: created.id, agentStarts: "Начни урок 5: поздоровайся и задай первый вопрос." };
        },
      },
    });
    holder.chat = real;
    await real.link(anna, "anna");
    return { real, requests };
  }

  it("метка → приложение создаёт свой чат, агент пишет первым, ответ приходит в мессенджер", async () => {
    const { real, requests } = await withLessonRule();
    chat = real;
    await chat.human({ type: "start", from: anna, payload: "lesson5" });

    expect(requests).toEqual([expect.objectContaining({ userId: "anna", reason: "start_payload", startPayload: "lesson5" })]);
    expect(chat.model.lastPromptText()).toContain("Начни урок 5");
    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1"]);
    const chats = await chat.service.listChats("anna");
    expect(chats).toEqual([expect.objectContaining({ title: "Урок 5", origin: "telegram" })]);

    await say(chat, "Готов");
    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1", "Ответ 2"]);
    expect(await chat.service.listChats("anna")).toHaveLength(1);
  });

  it("метка при уже идущем разговоре — как решит приложение (здесь: остаёмся в текущем чате)", async () => {
    const { real, requests } = await withLessonRule();
    chat = real;
    await say(chat, "Привет");
    const [current] = await chat.service.listChats("anna");

    await chat.human({ type: "start", from: anna, payload: "lesson5" });
    expect(requests.at(-1)).toMatchObject({ reason: "start_payload", startPayload: "lesson5", currentChatId: current?.id });
    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1", messengerTexts.hello]);
    expect(chat.model.calls).toHaveLength(1);
    expect(await chat.service.listChats("anna")).toHaveLength(1);
  });
});

describe("T073 кто пишет: правило приложения", () => {
  it("непривязанный — под пользователем, которого создало приложение; refuse — текст отказа, агент не запускается", async () => {
    const created: string[] = [];
    chat = await startRealChat({
      channel: await telegramChannel(),
      messengers: {
        async resolveAccount(account) {
          if (account.externalUserId === boris.id) return { refuse: "Бот только для учеников школы." };
          const userId = `guest-${account.externalUserId}`;
          if (!created.includes(userId)) created.push(userId);
          return { userId };
        },
      },
    });

    await say(chat, "Здравствуйте");
    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1"]);
    expect(created).toEqual([`guest-${anna.id}`]);
    expect(await chat.service.listChats(`guest-${anna.id}`)).toEqual([expect.objectContaining({ origin: "telegram" })]);
    expect(chat.model.lastPromptText()).toContain(memoryOf(`guest-${anna.id}`));

    await chat.human({ type: "text", chat: { id: boris.id, type: "private" }, from: boris, text: "Привет" });
    expect(chat.textsIn(boris.id)).toEqual(["Бот только для учеников школы."]);
    expect(chat.model.calls).toHaveLength(1);
  });
});
