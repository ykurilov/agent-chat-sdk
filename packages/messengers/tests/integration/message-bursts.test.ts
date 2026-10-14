import { vi } from "vitest";
import { afterEach, describe, expect, it } from "vitest";
import { anna } from "../fake-apis/rig";
import { telegramChannel } from "./support/channels";
import { type RealChat, startRealChat } from "./support/real-chat";

// Склейка пачки в мессенджере: человек пишет несколько сообщений подряд — бот отвечает одним ответом.

const annaChat = { id: anna.id, type: "private" as const };

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

/** Тексты сообщений человека в последнем запросе к модели. */
function lastUserTexts(current: RealChat): string {
  const prompt = current.model.calls.at(-1)?.prompt ?? [];
  const last = prompt.findLast((message) => message.role === "user");
  return typeof last?.content === "string" ? last.content : (last?.content ?? []).map((part) => ("text" in part ? part.text : "")).join("");
}

describe("склейка пачки сообщений в мессенджере", () => {
  it("три сообщения за пару секунд — один ответ; в истории — три сообщения человека", async () => {
    chat = await startRealChat({ channel: await telegramChannel() });
    await chat.link(anna, "anna");
    for (const text of ["привет", "у меня вопрос", "вот ссылка"]) {
      await chat.deliver({ type: "text", chat: annaChat, from: anna, text });
      await vi.advanceTimersByTimeAsync(1000);
    }
    await chat.settle();

    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1"]);
    expect(chat.model.calls).toHaveLength(1);
    expect(lastUserTexts(chat)).toMatch(/^привет\n\nу меня вопрос\n\nвот ссылка/);
    const [only] = await chat.service.listChats("anna");
    const { messages } = await chat.service.getHistory("anna", only!.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "user", "user", "assistant"]);
    expect(chat.errors).toEqual([]);
  });

  it("сообщения, пока бот отвечает, — после ответа один ответ на всё накопленное", async () => {
    chat = await startRealChat({ channel: await telegramChannel() });
    await chat.link(anna, "anna");
    const release = chat.model.holdNextAnswer();
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "первый вопрос" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(chat.model.calls).toHaveLength(1);

    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "и ещё" });
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "и вот это" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chat.model.calls).toHaveLength(1);
    release();
    await chat.settle();

    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1", "Ответ 2"]);
    expect(lastUserTexts(chat)).toMatch(/^и ещё\n\nи вот это/);
    expect(chat.errors).toEqual([]);
  });

  it("/stop, пока пачка ждёт тишины, — хода нет: «Остановил.», сообщения в истории", async () => {
    chat = await startRealChat({ channel: await telegramChannel() });
    await chat.link(anna, "anna");
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "привет" });
    await vi.advanceTimersByTimeAsync(1000);
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "/stop" });
    await chat.settle();

    expect(chat.textsIn(anna.id)).toEqual(["Остановил."]);
    expect(chat.model.calls).toHaveLength(0);
    const [only] = await chat.service.listChats("anna");
    const { messages } = await chat.service.getHistory("anna", only!.id);
    expect(messages.map((message) => [message.role, message.metadata?.status])).toEqual([
      ["user", undefined],
      ["assistant", "stopped"],
    ]);
    expect(chat.errors).toEqual([]);
  });

  it("messageBursts: false — каждое сообщение со своим ответом, как раньше", async () => {
    chat = await startRealChat({ channel: await telegramChannel(), messengers: { messageBursts: false } });
    await chat.link(anna, "anna");
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "привет" });
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "вопрос" });
    await chat.settle();
    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1", "Ответ 2"]);
  });

  it("окно задаётся настройкой: quietMs 10 с — сообщения с разрывом в 5 с всё ещё одна пачка", async () => {
    chat = await startRealChat({ channel: await telegramChannel(), messengers: { messageBursts: { quietMs: 10_000 } } });
    await chat.link(anna, "anna");
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "привет" });
    await vi.advanceTimersByTimeAsync(5000);
    await chat.deliver({ type: "text", chat: annaChat, from: anna, text: "вопрос" });
    await chat.settle();
    expect(chat.textsIn(anna.id)).toEqual(["Ответ 1"]);
    expect(chat.model.calls).toHaveLength(1);
  });
});
