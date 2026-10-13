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

const cut = { partIndex: 0, charOffset: 5, spokenTail: "Часть" };
const cutOf = (chat: ReturnType<typeof renderChatHook>) => chat.result.current.messages.find((message) => message.id === "a1")?.metadata?.voiceCut;

describe("showVoiceCut: отметка обрыва озвучки не пропадает от потока ответа", () => {
  it("поток ещё дописывает ответ после отметки (остановка доходит до сервера не сразу): отметка остаётся", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();
    act(() => {
      chat.result.current.sendVoiceMessage("Расскажи");
    });
    await settle();
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Часть ответа" });
    await settle();

    act(() => chat.result.current.showVoiceCut("a1", cut));
    expect(cutOf(chat)).toEqual(cut);

    stream.push({ type: "text-delta", id: "t", delta: ", ещё слова" });
    await settle();

    expect(cutOf(chat)).toEqual(cut);
  });

  it("поток закончился после отметки: отметка остаётся", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();
    act(() => {
      chat.result.current.sendVoiceMessage("Расскажи");
    });
    await settle();
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Часть ответа" });
    await settle();

    act(() => chat.result.current.showVoiceCut("a1", cut));
    act(() => stream.finish());
    await settle();

    expect(cutOf(chat)).toEqual(cut);
  });
});
