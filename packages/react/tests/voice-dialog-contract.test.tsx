// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentChatMessage, ChatMessageMetadata } from "../src/chat-types";
import { russianLabels } from "../src/labels";
import type { ChatSkin } from "../src/skin-contract";
import type { AnswerEnd, DialogChatBridge, VoiceDialogEngine, VoiceDialogState, VoiceDialogView } from "../src/voice-dialog";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

describe("договор скина v10: отметка обрыва у ответа", () => {
  it("ответ с voiceCut отдаёт скину voiceInterrupted с хвостом озвученного", async () => {
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Расскажи" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "Длинный ответ про погоду." }],
          metadata: { status: "complete", voiceCut: { partIndex: 0, charOffset: 7, spokenTail: "Длинный" } },
        },
      ],
    });
    renderAgentChat(server);

    await screen.findByText("Длинный ответ про погоду.");
    expect(document.querySelector("[data-kind='agent']")?.getAttribute("data-voice-interrupted")).toBe("Длинный");
  });

  it("ответ без voiceCut — поля у скина нет (скин версии 9 работает как раньше)", async () => {
    const server = fakeChatServer({
      history: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "Обычный ответ." }], metadata: { status: "complete" } }],
    });
    renderAgentChat(server);

    await screen.findByText("Обычный ответ.");
    expect(document.querySelector("[data-kind='agent']")?.hasAttribute("data-voice-interrupted")).toBe(false);
  });
});

describe("договор скина v10: только необязательные добавления", () => {
  it("скин версии 9 (заглушка без новых полей) остаётся ChatSkin", () => {
    expectTypeOf(stubSkin).toMatchTypeOf<ChatSkin>();
  });

  it("Composer.dialog и AgentMessage.voiceInterrupted необязательны, а VoiceDialogView задаёт все состояния и ошибки договора", () => {
    type ComposerProps = ComponentProps<ChatSkin["Composer"]>;
    type AgentMessageProps = ComponentProps<ChatSkin["AgentMessage"]>;
    expectTypeOf<ComposerProps["dialog"]>().toEqualTypeOf<VoiceDialogView | undefined>();
    expectTypeOf<AgentMessageProps["voiceInterrupted"]>().toEqualTypeOf<{ spokenTail: string } | undefined>();
    expectTypeOf<VoiceDialogState>().toEqualTypeOf<"off" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "error">();
    expectTypeOf<NonNullable<VoiceDialogView["error"]>>().toEqualTypeOf<
      | "microphone_denied"
      | "microphone_missing"
      | "network"
      | "service_unavailable"
      | "recognition_lost"
      | "speech_unavailable"
      | "limit"
      | "rate_limited"
      | "idle"
      | "backgrounded"
    >();
  });

  it("метаданные сообщения несут voiceCut, как в ядре", () => {
    const metadata: ChatMessageMetadata = { voiceCut: { partIndex: 1, charOffset: 5, spokenTail: "хвост" } };
    const message: AgentChatMessage = { id: "a", role: "assistant", parts: [], metadata };
    expect(message.metadata?.voiceCut?.spokenTail).toBe("хвост");
  });
});

describe("движок голосового режима и мост к чату", () => {
  it("движок открывается с чатом и мостом, отдаёт вид и закрывается; мост умеет send, stop и две подписки", async () => {
    const sent: string[] = [];
    const views: VoiceDialogView[] = [];
    const answerListeners: Array<(delta: { messageId: string; partIndex: number; text: string }) => void> = [];
    const endListeners: Array<(end: AnswerEnd) => void> = [];
    const bridge: DialogChatBridge = {
      send: (text) => void sent.push(text),
      stop: async () => {},
      showCut: () => {},
      subscribeAssistantText: (listener) => {
        answerListeners.push(listener);
        return () => void answerListeners.splice(answerListeners.indexOf(listener), 1);
      },
      subscribeAnswerEnd: (listener) => {
        endListeners.push(listener);
        return () => void endListeners.splice(endListeners.indexOf(listener), 1);
      },
    };
    let closed = 0;
    const engine: VoiceDialogEngine = {
      open: ({ chat, onView }) => {
        chat.send("привет");
        onView({ state: "listening", speechAvailable: true, onToggle: () => {} });
        return Promise.resolve();
      },
      close: () => void closed++,
      selectVoice: async () => {},
      loadVoices: async () => ({ voices: [{ id: "anna", name: "Анна" }], current: "anna", persisted: true }),
    };

    await engine.open({ chatId: "c1", chat: bridge, onView: (view) => views.push(view) });
    engine.close();

    expect(sent).toEqual(["привет"]);
    expect(views.map((view) => view.state)).toEqual(["listening"]);
    expect(closed).toBe(1);
    expect(await engine.loadVoices()).toEqual({ voices: [{ id: "anna", name: "Анна" }], current: "anna", persisted: true });
    const unsubscribe = bridge.subscribeAssistantText(() => {});
    expect(answerListeners).toHaveLength(1);
    unsubscribe();
    expect(answerListeners).toHaveLength(0);
  });
});

describe("словарь надписей: раздел voiceDialog", () => {
  const dialog = russianLabels.voiceDialog;

  it("есть подписи кнопок, названия состояний, меню голосов и отметка обрыва", () => {
    expect(dialog.start).toBe("Голосовой режим");
    expect(dialog.exit).toBe("Выйти");
    expect(Object.keys(dialog.states).sort()).toEqual(["connecting", "error", "interrupted", "listening", "off", "speaking", "thinking"]);
    expect(dialog.voiceMenu).toBeTruthy();
    expect(dialog.interruptedMark("Длинный")).toBe("Вы перебили: озвучено до «Длинный»");
  });

  it("есть надпись на каждую ошибку договора", () => {
    expect(Object.keys(dialog.errors).sort()).toEqual([
      "backgrounded",
      "idle",
      "limit",
      "microphone_denied",
      "microphone_missing",
      "network",
      "rate_limited",
      "recognition_lost",
      "service_unavailable",
      "speech_unavailable",
    ]);
    for (const text of Object.values(dialog.errors)) expect(text.length).toBeGreaterThan(0);
  });
});
