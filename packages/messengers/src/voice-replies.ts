import type { DeliveryOutcome } from "./answer-delivery";
import { MessengerBlockedError } from "./messenger-api";
import type { ExternalChat, MessengerAdapter } from "./messenger-adapter";
import type { OutboundQueue } from "./outbound-queue";
import type { VoiceReplies } from "./types";

/** Что вышло с голосовым ответом. `off` — голос не нужен: настройки нет, писали текстом или ответ не дописан. */
export type VoiceAnswerResult = "off" | "sent" | "skipped" | "failed" | "stopped";

export interface VoiceAnswerInput {
  adapter: MessengerAdapter;
  chat: ExternalChat;
  chatKey: string;
  queue: OutboundQueue;
  ownerId: string;
  chatId: string;
  /** Итог доставки текста: голос идёт только после дописанного ответа. */
  answer: DeliveryOutcome;
  /** Человек написал голосовым. */
  inputWasVoice: boolean;
  /** «Стоп» обрывает озвучку. */
  signal?: AbortSignal;
}

/**
 * Голосовой ответ (решение 20): сначала текст, как обычно, затем озвучка готового текста и голосовое сообщение.
 * Настройка `voiceReplies` читается только здесь; сбой или лимит озвучки оставляют ответ текстом.
 */
export function createVoiceAnswers(options: { voiceReplies?: VoiceReplies; logError?(error: unknown): void }) {
  const { voiceReplies } = options;
  const logError = (error: unknown) => options.logError?.(error);

  async function afterText(input: VoiceAnswerInput): Promise<VoiceAnswerResult> {
    const { answer } = input;
    if (!voiceReplies || !input.inputWasVoice || answer.status !== "finished" || !answer.messageId || !answer.text.trim()) return "off";
    // Своё «стоп» для озвучки: сигнал хода может не прийти, а `speak` ждёт обязательный.
    const controller = new AbortController();
    const stop = () => controller.abort();
    input.signal?.addEventListener("abort", stop, { once: true });
    if (input.signal?.aborted) stop();
    try {
      if (controller.signal.aborted) return "stopped";
      const speech = await voiceReplies.speak({ text: answer.text, ownerId: input.ownerId, chatId: input.chatId, messageId: answer.messageId, signal: controller.signal });
      if (controller.signal.aborted) return "stopped";
      if ("skipped" in speech) return "skipped";
      await input.queue.run(input.chatKey, () => input.adapter.sendVoice(input.chat, { audio: speech.audio, durationMs: speech.durationMs }));
      return "sent";
    } catch (error) {
      if (controller.signal.aborted) return "stopped";
      // Блокировку уже пометила очередь отправки.
      if (!(error instanceof MessengerBlockedError)) logError(error);
      return "failed";
    } finally {
      input.signal?.removeEventListener("abort", stop);
    }
  }

  return { enabled: voiceReplies !== undefined, afterText };
}

export type VoiceAnswers = ReturnType<typeof createVoiceAnswers>;
