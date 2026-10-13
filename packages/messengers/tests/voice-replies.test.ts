import { describe, expect, it } from "vitest";
import type { DeliveryOutcome } from "../src/answer-delivery";
import { MessengerApiError } from "../src/messenger-api";
import { createOutboundQueue } from "../src/outbound-queue";
import type { VoiceReplies } from "../src/types";
import { createVoiceAnswers } from "../src/voice-replies";
import { createFakeAdapter, privateChat } from "./support/fake-adapter";

const finished: DeliveryOutcome = { status: "finished", messageId: "msg-1", text: "Купил **хлеб**.", sent: [] };
const audio = new Uint8Array([1, 2, 3]);

type SpeakInput = Parameters<VoiceReplies["speak"]>[0];

function setup(speak?: (input: SpeakInput) => ReturnType<VoiceReplies["speak"]>) {
  const fake = createFakeAdapter();
  const errors: unknown[] = [];
  const calls: SpeakInput[] = [];
  const voiceReplies: VoiceReplies | undefined = speak
    ? {
        speak: (input) => {
          calls.push(input);
          return speak(input);
        },
      }
    : undefined;
  const answers = createVoiceAnswers({ ...(voiceReplies !== undefined && { voiceReplies }), logError: (error) => errors.push(error) });
  const queue = createOutboundQueue({ retryDelayMs: 0, finalAttempts: 1 });
  const afterText = (overrides: { answer?: DeliveryOutcome; inputWasVoice?: boolean; signal?: AbortSignal } = {}) =>
    answers.afterText({
      adapter: fake.adapter,
      chat: privateChat,
      chatKey: "telegram:bot1:1",
      queue,
      ownerId: "anna",
      chatId: "chat-1",
      answer: overrides.answer ?? finished,
      inputWasVoice: overrides.inputWasVoice ?? true,
      ...(overrides.signal !== undefined && { signal: overrides.signal }),
    });
  return { fake, errors, calls, answers, afterText };
}

const spoken = async () => ({ audio, mediaType: "audio/ogg" as const, durationMs: 2500 });

describe("голосовой ответ", () => {
  it("по умолчанию выключен — только текст", async () => {
    const { answers, afterText, fake } = setup();
    expect(answers.enabled).toBe(false);
    expect(await afterText()).toBe("off");
    expect(fake.voices).toEqual([]);
  });

  it("на голосовое — после текста озвучка готового текста и голосовое сообщение", async () => {
    const { afterText, calls, fake } = setup(spoken);
    expect(await afterText()).toBe("sent");
    expect(calls).toEqual([{ text: "Купил **хлеб**.", ownerId: "anna", chatId: "chat-1", messageId: "msg-1", signal: expect.any(AbortSignal) }]);
    expect(fake.voices).toEqual([{ chat: privateChat, voice: { audio, durationMs: 2500 } }]);
  });

  it("на текстовое сообщение — только текст", async () => {
    const { afterText, calls, fake } = setup(spoken);
    expect(await afterText({ inputWasVoice: false })).toBe("off");
    expect(calls).toEqual([]);
    expect(fake.voices).toEqual([]);
  });

  it("ответ не дописан (стоп, сбой, блокировка) или пустой — не озвучиваем", async () => {
    const { afterText, calls } = setup(spoken);
    for (const status of ["stopped", "failed", "blocked"] as const) expect(await afterText({ answer: { ...finished, status } })).toBe("off");
    expect(await afterText({ answer: { ...finished, text: "  " } })).toBe("off");
    expect(calls).toEqual([]);
  });

  it("лимит или недоступность озвучки — только текст, без журнала ошибок", async () => {
    for (const skipped of ["limit", "unavailable"] as const) {
      const { afterText, fake, errors } = setup(async () => ({ skipped }));
      expect(await afterText()).toBe("skipped");
      expect(fake.voices).toEqual([]);
      expect(errors).toEqual([]);
    }
  });

  it("сбой озвучки или отправки — только текст, ошибка в logError", async () => {
    const broken = setup(async () => {
      throw new Error("elevenlabs down");
    });
    expect(await broken.afterText()).toBe("failed");
    expect(broken.errors).toEqual([new Error("elevenlabs down")]);

    const refused = setup(spoken);
    refused.fake.failures.sendVoice.push(new MessengerApiError("Bad Request: VOICE_MESSAGES_FORBIDDEN", 400));
    expect(await refused.afterText()).toBe("failed");
    expect(refused.fake.voices).toEqual([]);
    expect(refused.errors).toHaveLength(1);
  });

  it("«Стоп» обрывает озвучку через signal: голосовое не уходит, это не ошибка", async () => {
    const controller = new AbortController();
    const { afterText, fake, errors, calls } = setup(
      (input) =>
        new Promise((_, reject) => {
          input.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
    );
    const result = afterText({ signal: controller.signal });
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    controller.abort();
    expect(await result).toBe("stopped");
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(fake.voices).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("«Стоп» после озвучки, но до отправки — голосовое не уходит; уже нажат — озвучка не начинается", async () => {
    const late = new AbortController();
    const { afterText, fake, calls } = setup(async () => {
      late.abort();
      return spoken();
    });
    expect(await afterText({ signal: late.signal })).toBe("stopped");
    expect(fake.voices).toEqual([]);

    const early = new AbortController();
    early.abort();
    expect(await afterText({ signal: early.signal })).toBe("stopped");
    expect(calls).toHaveLength(1);
  });
});
