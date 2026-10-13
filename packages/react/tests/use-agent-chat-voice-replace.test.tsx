// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function settle(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

type Chat = ReturnType<typeof renderChatHook>;

/** Человек сказал «Так.» голосом, модель размышляет: ответ начат, текста нет. */
async function saidSoAndThinking(options: { thinking?: boolean } = {}) {
  const server = fakeChatServer({});
  const chat = renderChatHook(server);
  await settle();
  act(() => {
    chat.result.current.sendVoiceMessage("Так.");
  });
  await settle();
  const stream = server.streams[0]!;
  stream.push({ type: "start", messageId: "a1" });
  if (options.thinking !== false) stream.push({ type: "reasoning-start", id: "r" });
  await settle();
  return { server, chat };
}

const userTexts = (chat: Chat) =>
  chat.result.current.messages.filter((message) => message.role === "user").map((message) =>
    message.parts.map((part) => (part.type === "text" ? part.text : part.type)).join("|"),
  );
const roles = (chat: Chat) => chat.result.current.messages.map((message) => message.role);

/** Заменить фразу и дать ходу время дойти до сервера; итог замены. */
async function replace(chat: Chat, text: string): Promise<boolean> {
  let outcome!: Promise<boolean>;
  act(() => {
    outcome = chat.result.current.replaceLastVoiceMessage(text);
  });
  await settle(50);
  return outcome;
}

describe("replaceLastVoiceMessage: склейка голосовой фразы правкой", () => {
  it("останавливает ход и правит последнее сообщение: POST /stop, затем POST /edit с id правимого, склеенным текстом и voiceMode; второго сообщения нет", async () => {
    const { server, chat } = await saidSoAndThinking();
    const firstId = chat.result.current.messages[0]!.id;

    const outcome = await replace(chat, "Так. Дай-ка подумать.");

    expect(outcome).toBe(true);
    expect(server.requestsTo("stop")).toHaveLength(1);
    const edit = server.requestsTo("edit")[0]!.body as { editedMessageId: string; voiceMode?: boolean; message: { id: string; parts: unknown[] } };
    expect(edit.editedMessageId).toBe(firstId);
    expect(edit.voiceMode).toBe(true);
    expect(edit.message.parts).toEqual([{ type: "text", text: "Так. Дай-ка подумать." }]);
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("в ленте остаётся одно сообщение человека со склеенным текстом и отметкой голосового режима; без «Так.» и без пустого оборванного ответа", async () => {
    const { server, chat } = await saidSoAndThinking();

    await replace(chat, "Так. Дай-ка подумать.");

    expect(userTexts(chat)).toEqual(["Так. Дай-ка подумать.|data-voice-mode"]);
    expect(roles(chat)).toEqual(["user"]);
    server.edits[0]!.answer("Вот ответ", "a2");
    await settle();
    expect(roles(chat)).toEqual(["user", "assistant"]);
    expect(userTexts(chat)).toEqual(["Так. Дай-ка подумать.|data-voice-mode"]);
  });

  it("сообщение показывает склеенный текст сразу, до конца остановки: «Так.» на экране не задерживается", async () => {
    const { server, chat } = await saidSoAndThinking();
    server.state.hang.add("stop");

    act(() => {
      void chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать.");
    });
    await settle(5);

    expect(userTexts(chat)).toEqual(["Так. Дай-ка подумать.|data-voice-mode"]);
    expect(roles(chat)).toEqual(["user"]);
    expect(server.requestsTo("edit")).toHaveLength(0);
  });

  it("правка повторяется: третья фраза правит уже склеенное сообщение", async () => {
    const { server, chat } = await saidSoAndThinking();
    await replace(chat, "Так. Дай-ка подумать.");
    const gluedId = (server.requestsTo("edit")[0]!.body as { message: { id: string } }).message.id;

    const outcome = await replace(chat, "Так. Дай-ка подумать. Найди новости.");

    expect(outcome).toBe(true);
    const second = server.requestsTo("edit")[1]!.body as { editedMessageId: string; voiceMode?: boolean };
    expect(second.editedMessageId).toBe(gluedId);
    expect(second.voiceMode).toBe(true);
    expect(userTexts(chat)).toEqual(["Так. Дай-ка подумать. Найди новости.|data-voice-mode"]);
  });

  it("две замены подряд, не дожидаясь первой, идут по очереди", async () => {
    const { server, chat } = await saidSoAndThinking();
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;

    act(() => {
      first = chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать.");
      second = chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать. Найди новости.");
    });
    await settle(100);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    const edits = server.requestsTo("edit").map((request) => request.body as { editedMessageId: string; message: { id: string } });
    expect(edits).toHaveLength(2);
    expect(edits[1]!.editedMessageId).toBe(edits[0]!.message.id);
    expect(userTexts(chat)).toEqual(["Так. Дай-ка подумать. Найди новости.|data-voice-mode"]);
  });

  it("у ответа уже есть текст: не заменяет — false, ни остановки, ни правки; лента не тронута", async () => {
    const { server, chat } = await saidSoAndThinking();
    server.streams[0]!.push({ type: "text-start", id: "t" });
    server.streams[0]!.push({ type: "text-delta", id: "t", delta: "Начало" });
    await settle();

    const outcome = await replace(chat, "Так. Дай-ка подумать.");

    expect(outcome).toBe(false);
    expect(server.requestsTo("stop")).toHaveLength(0);
    expect(server.requestsTo("edit")).toHaveLength(0);
    expect(userTexts(chat)).toEqual(["Так.|data-voice-mode"]);
  });

  it("в ответе начат вызов инструмента: это уже действие модели, не заменяет", async () => {
    const { server, chat } = await saidSoAndThinking({ thinking: false });
    server.streams[0]!.push({ type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" });
    await settle();

    const outcome = await replace(chat, "Так. Дай-ка подумать.");

    expect(outcome).toBe(false);
    expect(server.requestsTo("stop")).toHaveLength(0);
    expect(server.requestsTo("edit")).toHaveLength(0);
  });

  it("последнее сообщение набрано текстом, а не сказано: не заменяет", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();
    act(() => chat.result.current.setValue("Привет"));
    act(() => chat.result.current.submit());
    await settle();

    const outcome = await replace(chat, "Привет. Ещё");

    expect(outcome).toBe(false);
    expect(server.requestsTo("edit")).toHaveLength(0);
  });

  it("сервер ответил «занят» один раз (остановка ещё доделывается): правка повторяется и проходит", async () => {
    const { server, chat } = await saidSoAndThinking();
    server.state.refuse.edit = { status: 409, kind: "busy" };
    let outcome: Promise<boolean> | undefined;

    act(() => {
      outcome = chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать.");
    });
    await settle(30);
    expect(server.requestsTo("edit").length).toBeGreaterThanOrEqual(1);
    delete server.state.refuse.edit;
    await settle(500);

    expect(await outcome).toBe(true);
    expect(userTexts(chat)).toEqual(["Так. Дай-ка подумать.|data-voice-mode"]);
  });

  it("сервер отказывает правке насовсем: false, лента возвращается к тому, что на сервере", async () => {
    const { server, chat } = await saidSoAndThinking();
    server.state.refuse.edit = { status: 400, kind: "invalid" };
    server.state.history = [
      { id: "u-server", role: "user", parts: [{ type: "text", text: "Так." }, { type: "data-voice-mode", data: true }] },
      { id: "a1", role: "assistant", parts: [], metadata: { status: "stopped" } },
    ];

    const outcome = await replace(chat, "Так. Дай-ка подумать.");
    await settle(100);

    expect(outcome).toBe(false);
    expect(userTexts(chat)).toEqual(["Так.|data-voice-mode"]);
  });
});
