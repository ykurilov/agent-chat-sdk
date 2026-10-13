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

describe("sendVoiceMessage: занятость из актуального состояния, а не из замыкания", () => {
  it("ссылка на функцию, взятая, пока чат был свободен, не отправляет слова, когда чат занят переподключением", async () => {
    const server = fakeChatServer({ heartbeatMs: 10_000, resumable: true });
    const chat = renderChatHook(server);
    await settle();
    const fromIdleRender = chat.result.current.sendVoiceMessage;

    act(() => chat.result.current.setValue("Расскажи подробно"));
    act(() => chat.result.current.submit());
    await settle();
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Часть ответа" });
    await settle();
    server.state.down = true;
    act(() => stream.break());
    await settle(100);
    expect(chat.result.current.busy).toBe(true);
    const sentBefore = server.requestsTo("messages").length;

    let accepted = true;
    act(() => {
      accepted = fromIdleRender("Слова голосом");
    });
    await settle();

    expect(accepted).toBe(false);
    expect(server.requestsTo("messages")).toHaveLength(sentBefore);
  });
});

describe("sendVoiceMessage: отметка голосового хода в самом сообщении", () => {
  it("сообщение человека в ленте сразу несёт отметку голосового режима: по ней экран прячет теги в ответе живого хода", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();

    act(() => {
      chat.result.current.sendVoiceMessage("Расскажи");
    });
    await settle();

    const sent = chat.result.current.messages.find((message) => message.role === "user")!;
    expect(sent.parts).toContainEqual({ type: "data-voice-mode", data: true });
  });
});
