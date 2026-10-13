import { jsonSchema, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { messengerTexts } from "../../src/messenger-texts";
import type { MessengersOptions } from "../../src/types";
import { anna, boris, type Person } from "../fake-apis/rig";
import { allChannels } from "./support/channels";
import { memoryOf, type RealChat, startRealChat } from "./support/real-chat";

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

const removed: string[] = [];
const tools = {
  search: tool({ description: "Поиск", inputSchema: jsonSchema<{ query: string }>({ type: "object", properties: { query: { type: "string" } } }), execute: async () => "нашлось" }),
  remove: tool({
    description: "Удалить файл",
    inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } } }),
    needsApproval: true,
    execute: async ({ path }) => {
      removed.push(path);
      return "удалено";
    },
  }),
  secret: tool({ description: "Только в личных", inputSchema: jsonSchema<{ q: string }>({ type: "object", properties: { q: { type: "string" } } }), execute: async () => "секрет" }),
};

async function groupChat(open: (typeof allChannels)[number]["open"], groups: MessengersOptions["groups"]) {
  removed.length = 0;
  const real = await startRealChat({
    channel: await open(),
    server: { agent: { instructions: "Ты помощник.", tools } },
    ...(groups && { messengers: { groups } }),
  });
  await real.link(anna, "anna");
  return real;
}

const inGroup = (real: RealChat, from: Person, text: string, mentionsBot = false) => real.human({ type: "text", chat: real.channel.group, from, text, mentionsBot });
const groupTexts = (real: RealChat) => real.textsIn(real.channel.group.id);

describe.each(allChannels)("T074 группы на поддельной группе, $name", ({ open }) => {
  it("группы выключены — один раз «пишите мне в личные», агент не запускается", async () => {
    chat = await groupChat(open, undefined);
    await inGroup(chat, anna, "@test_bot привет", true);
    await inGroup(chat, boris, "@test_bot ау", true);
    expect(groupTexts(chat)).toEqual([messengerTexts.writeInPrivate]);
    expect(chat.model.calls).toHaveLength(0);
  });

  it("/connect — плательщик; упоминание — ответ, остальное — тишина; без памяти плательщика; только разрешённые инструменты", async () => {
    chat = await groupChat(open, { allowedTools: ["search", "remove"] });
    await inGroup(chat, anna, "/connect");
    expect(groupTexts(chat)).toEqual([messengerTexts.groupConnected(anna.name)]);

    await inGroup(chat, boris, "просто болтаем");
    expect(chat.model.calls).toHaveLength(0);

    await inGroup(chat, boris, "@test_bot найди отчёт", true);
    expect(groupTexts(chat).at(-1)).toBe("Ответ 1");
    expect(chat.model.lastPromptText()).not.toContain(memoryOf("anna"));
    expect(chat.model.lastPromptText()).toContain(boris.name);
    expect(chat.model.lastToolNames().sort()).toEqual(["remove", "search"]);
    // Расход — на плательщика: группа пишет в его чат.
    expect(await chat.service.listChats("anna")).toEqual([expect.objectContaining({ origin: chat.channel.messenger })]);
  });

  it("подтверждение в группе нажимает только плательщик", async () => {
    chat = await groupChat(open, { allowedTools: ["remove"] });
    await inGroup(chat, anna, "/connect");
    chat.model.script({ tool: { name: "remove", input: { path: "/tmp/a.txt" } } }, { text: "Удалил." });
    await inGroup(chat, boris, "@test_bot удали файл", true);

    const card = chat.channel.outgoing.findLast((message) => message.chatId === chat?.channel.group.id && message.buttons.length > 0);
    const allow = card?.buttons.flat().find((button) => button.text === messengerTexts.allow);
    expect(allow?.data).toBeDefined();

    await chat.human({ type: "press", chat: chat.channel.group, from: boris, data: allow?.data as string, messageId: card?.messageId as string });
    expect(chat.channel.answers.at(-1)?.text).toBe(messengerTexts.onlyPayer(anna.name));
    expect(removed).toEqual([]);

    await chat.human({ type: "press", chat: chat.channel.group, from: anna, data: allow?.data as string, messageId: card?.messageId as string });
    expect(removed).toEqual(["/tmp/a.txt"]);
    expect(groupTexts(chat).at(-1)).toBe("Удалил.");
  });

  it("предел участника: сверх него — одно предупреждение, дальше тишина", async () => {
    chat = await groupChat(open, { perMemberHourly: 2 });
    await inGroup(chat, anna, "/connect");
    for (let index = 0; index < 4; index++) await inGroup(chat, boris, `@test_bot вопрос ${index}`, true);
    expect(chat.model.calls).toHaveLength(2);
    expect(groupTexts(chat).filter((text) => text === messengerTexts.memberLimit)).toHaveLength(1);
  });

  it("/disconnect и удаление бота выключают разговор", async () => {
    chat = await groupChat(open, {});
    await inGroup(chat, anna, "/connect");
    await inGroup(chat, anna, "/disconnect");
    expect(groupTexts(chat).at(-1)).toBe(messengerTexts.groupDisconnected);
    await inGroup(chat, boris, "@test_bot ау", true);
    expect(chat.model.calls).toHaveLength(0);

    await inGroup(chat, anna, "/connect");
    await chat.human({ type: "bot_removed", chat: chat.channel.group, by: anna });
    await inGroup(chat, boris, "@test_bot ау", true);
    expect(chat.model.calls).toHaveLength(0);
    expect(await chat.store.getConversation({ messenger: chat.channel.messenger, botId: chat.channel.bot.botId, externalChatId: chat.channel.group.id })).toMatchObject({ active: false });
  });
});
