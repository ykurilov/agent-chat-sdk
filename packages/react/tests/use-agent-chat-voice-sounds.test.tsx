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

describe("звуки человека в голосовом сообщении (FR-027)", () => {
  it("sendVoiceMessage(text, { sounds }): запрос несёт voiceMode и voiceSounds; в самом сообщении лент их нет", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();

    act(() => {
      chat.result.current.sendVoiceMessage("Ха-ха, смешно", { sounds: ["laughter", "sigh"] });
    });
    await settle();

    const body = server.requestsTo("messages")[0]!.body as { voiceMode?: boolean; voiceSounds?: string[]; message: { parts: unknown[] } };
    expect(body.voiceMode).toBe(true);
    expect(body.voiceSounds).toEqual(["laughter", "sigh"]);
    expect(body.message.parts).toEqual([{ type: "text", text: "Ха-ха, смешно" }]);
    const shown = chat.result.current.messages[0]!.parts.map((part) => (part.type === "text" ? part.text : part.type));
    expect(shown).toEqual(["Ха-ха, смешно", "data-voice-mode"]);
    expect(JSON.stringify(chat.result.current.messages)).not.toContain("laughter");
  });

  it("без звуков в запросе нет voiceSounds", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();

    act(() => {
      chat.result.current.sendVoiceMessage("Привет");
    });
    await settle();

    const body = server.requestsTo("messages")[0]!.body as Record<string, unknown>;
    expect(body.voiceMode).toBe(true);
    expect("voiceSounds" in body).toBe(false);
  });

  it("пустой список звуков — как без звуков", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();

    act(() => {
      chat.result.current.sendVoiceMessage("Привет", { sounds: [] });
    });
    await settle();

    expect("voiceSounds" in (server.requestsTo("messages")[0]!.body as Record<string, unknown>)).toBe(false);
  });

  it("replaceLastVoiceMessage(text, { sounds }): правка несёт только новые звуки", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await settle();
    act(() => {
      chat.result.current.sendVoiceMessage("Так.", { sounds: ["laughter"] });
    });
    await settle();
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "reasoning-start", id: "r" });
    await settle();

    let outcome!: Promise<boolean>;
    act(() => {
      outcome = chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать.", { sounds: ["sigh"] });
    });
    await settle(50);

    await expect(outcome).resolves.toBe(true);
    const edit = server.requestsTo("edit")[0]!.body as { voiceMode?: boolean; voiceSounds?: string[] };
    expect(edit.voiceMode).toBe(true);
    expect(edit.voiceSounds).toEqual(["sigh"]);
  });

  it("сообщение со звуками не дошло до сервера: при повторе звуки уходят снова, с тем же id", async () => {
    const server = fakeChatServer({ heartbeatMs: 5_000, resumable: true });
    const chat = renderChatHook(server);
    await settle();
    server.state.hang.add("messages");

    act(() => {
      chat.result.current.sendVoiceMessage("Ха-ха, смешно", { sounds: ["laughter"] });
    });
    await settle(10_500);
    expect(chat.result.current.sendFailed).toBe(true);

    server.state.hang.delete("messages");
    act(() => chat.result.current.retry());
    await settle(50);

    const bodies = server.requestsTo("messages").map((request) => request.body as { voiceSounds?: string[]; message: { id: string } });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.message.id).toBe(bodies[0]!.message.id);
    expect(bodies[1]!.voiceSounds).toEqual(["laughter"]);
  });
});
