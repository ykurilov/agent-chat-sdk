import { jsonSchema, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { messengerTexts } from "../../src/messenger-texts";
import { anna } from "../fake-apis/rig";
import { telegramChannel } from "./support/channels";
import { type RealChat, startRealChat } from "./support/real-chat";

const annaChat = { id: anna.id, type: "private" as const };

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

const removed: string[] = [];
const remove = tool({
  description: "Удалить файл",
  inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } } }),
  needsApproval: true,
  execute: async ({ path }) => {
    removed.push(path);
    return "удалено";
  },
});

async function cardsChat() {
  removed.length = 0;
  const real = await startRealChat({ channel: await telegramChannel(), server: { agent: { instructions: "Ты помощник.", tools: { remove }, widgets: { basic: true } } } });
  await real.link(anna, "anna");
  return real;
}

const say = (real: RealChat, text: string) => real.human({ type: "text", chat: annaChat, from: anna, text });
const annaTexts = (real: RealChat) => real.textsIn(annaChat.id);
type Outgoing = RealChat["channel"]["outgoing"][number];
const lastCard = (real: RealChat) => real.channel.outgoing.findLast((message) => message.chatId === annaChat.id && message.buttons.length > 0) as Outgoing;
const buttonOf = (card: Outgoing, text: string) => card.buttons.flat().find((button) => button.text === text);
const press = (real: RealChat, card: Outgoing, text: string) =>
  real.human({ type: "press", chat: annaChat, from: anna, data: buttonOf(card, text)?.data as string, messageId: card.messageId });

/** Состояние вызова инструмента в истории чата: виджет закрыт, когда у вызова есть результат. */
async function toolStateOf(real: RealChat, toolCallId: string) {
  const [first] = await real.service.listChats("anna");
  const history = await real.service.getHistory("anna", first?.id as string);
  const part = history.messages.flatMap((message) => message.parts).find((item) => "toolCallId" in item && item.toolCallId === toolCallId);
  return part && "state" in part ? part.state : undefined;
}

describe("T078 подтверждения и виджеты кнопками на настоящей службе", () => {
  it("«Разрешить» выполняет инструмент и продолжает ход; второе нажатие — «уже отвечено», инструмент один раз", async () => {
    chat = await cardsChat();
    chat.model.script({ tool: { name: "remove", input: { path: "/tmp/a.txt" } } }, { text: "Удалил." });
    await say(chat, "Удали файл");
    const card = lastCard(chat);
    expect(card.text).toBe(messengerTexts.approvalQuestion("remove"));

    await press(chat, card, messengerTexts.allow);
    expect(removed).toEqual(["/tmp/a.txt"]);
    expect(annaTexts(chat).at(-1)).toBe("Удалил.");

    await press(chat, card, messengerTexts.allow);
    expect(chat.channel.answers.at(-1)?.text).toBe(messengerTexts.alreadyAnswered);
    expect(removed).toEqual(["/tmp/a.txt"]);
    expect(chat.errors).toEqual([]);
  });

  it("«Запретить» — инструмент не выполняется, ход продолжается", async () => {
    chat = await cardsChat();
    chat.model.script({ tool: { name: "remove", input: { path: "/tmp/a.txt" } } }, { text: "Не стал удалять." });
    await say(chat, "Удали файл");
    await press(chat, lastCard(chat), messengerTexts.deny);
    expect(removed).toEqual([]);
    expect(annaTexts(chat).at(-1)).toBe("Не стал удалять.");
  });

  it("выбор варианта кнопкой — ответ виджету и продолжение хода; повторное нажатие не считается", async () => {
    chat = await cardsChat();
    chat.model.script({ tool: { name: "ask_choice", id: "w1", input: { question: "Какой цвет?", options: ["Красный", "Синий"] } } }, { text: "Выбран синий." });
    await say(chat, "Подбери цвет");
    const card = lastCard(chat);
    expect(card.text).toBe("Какой цвет?");

    await press(chat, card, "Синий");
    expect(annaTexts(chat).at(-1)).toBe("Выбран синий.");
    expect(chat.model.lastPromptText()).toContain("Синий");
    expect(await toolStateOf(chat, "w1")).toBe("output-available");

    const calls = chat.model.calls.length;
    await press(chat, card, "Красный");
    expect(chat.channel.answers.at(-1)?.text).toBe(messengerTexts.alreadyAnswered);
    expect(chat.model.calls).toHaveLength(calls);
  });

  it("форма — текстом; ответ сообщением закрывает виджет и уходит агенту", async () => {
    chat = await cardsChat();
    const fields = [{ name: "name", label: "Имя", kind: "text", required: true }];
    chat.model.script({ tool: { name: "ask_form", id: "f1", input: { title: "Заявка", fields } } }, { text: "Спасибо, Анна." });
    await say(chat, "Хочу оставить заявку");
    expect(annaTexts(chat).at(-1)).toContain("Заявка");
    expect(annaTexts(chat).at(-1)).toContain(messengerTexts.answerByMessage);

    await say(chat, "Анна");
    expect(annaTexts(chat).at(-1)).toBe("Спасибо, Анна.");
    expect(chat.model.lastPromptText()).toContain("Анна");
    expect(await toolStateOf(chat, "f1")).toBe("output-available");
    expect(chat.errors).toEqual([]);
  });
});
