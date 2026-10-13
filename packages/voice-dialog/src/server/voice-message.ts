import { stripVoiceTags } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";
import type { UpstreamSocket } from "@ykurilov/agent-chat-voice/server";
import { createSpokenTextWith } from "../shared/spoken-text-core";
import { encodePcmToOggOpus } from "./ogg-opus";
import { openSpeech } from "./speech-stream";
import type { SpeechModel } from "./speech-stream";
import { createSpeechUsage } from "./speech-usage";

/** Голосовой ответ целиком: тонкий интерфейс мессенджеров (`@ykurilov/agent-chat-messengers`), реализация — `createVoiceReplies`. */
export interface VoiceReplies {
  speak(input: { text: string; ownerId: string; chatId: string; messageId: string; signal: AbortSignal }): Promise<
    { audio: Uint8Array; mediaType: "audio/ogg"; durationMs: number } | { skipped: "limit" | "unavailable" }
  >;
}

export interface VoiceRepliesOptions {
  /** Ключ ElevenLabs: только в заголовке соединения, в тексты ошибок и журнал не попадает. */
  apiKey: string;
  voiceId: string;
  model: SpeechModel;
  language: string;
  storage: ChatStorage;
  /** Доллары за 1000 знаков по моделям; на используемую модель цена обязательна. */
  pricePerThousandChars: Record<string, number>;
  spendingLimits?: SpendingLimits | undefined;
  /** Потолок озвученных знаков на ответ; дальше — «Дальше на экране.». По умолчанию 1500, как у голосового диалога. */
  maxChars?: number | undefined;
  /** Адрес ElevenLabs или прокси. */
  baseUrl?: string | undefined;
  /** Заголовки к соединению (токен прокси). */
  headers?: Record<string, string> | undefined;
  logError(message: string): void;
  /** Как соединиться с ElevenLabs; по умолчанию WebSocket платформы. Для тестов. */
  connect?: ((url: string, headers: Record<string, string>) => UpstreamSocket) | undefined;
}

const UNAVAILABLE = { skipped: "unavailable" } as const;
const ERROR_LOG_LIMIT = 200;

type Outcome = "done" | "failed" | "aborted";

/**
 * Озвучка ответа целиком в голосовое сообщение: лимит → озвучка в память → Ogg/Opus → траты.
 * Любая неудача — `skipped`: текст ответа уходит человеку и без голоса.
 */
export function createVoiceReplies(options: VoiceRepliesOptions): VoiceReplies {
  const { apiKey, logError } = options;
  const usage = createSpeechUsage({
    storage: options.storage,
    model: options.model,
    pricePerThousandChars: options.pricePerThousandChars,
    spendingLimits: options.spendingLimits,
    logError,
  });
  const secrets = [apiKey, ...Object.values(options.headers ?? {})].filter((value) => value.length > 0);
  const redact = (text: string) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "***"), text).slice(0, ERROR_LOG_LIMIT);
  const describe = (error: unknown) => redact(error instanceof Error ? error.message : String(error));

  function spokenSentences(text: string): string[] {
    const spoken = createSpokenTextWith(stripVoiceTags, options.maxChars === undefined ? {} : { maxChars: options.maxChars });
    return [...spoken.push(text), ...spoken.finish()].map((sentence) => sentence.text);
  }

  return {
    async speak({ text, ownerId, chatId, messageId, signal }) {
      if (signal.aborted) return UNAVAILABLE;
      const sentences = spokenSentences(text);
      if (sentences.length === 0) return UNAVAILABLE;

      const verdict = await usage.assertCanSpeak({ userId: ownerId, chatId });
      if (verdict !== "ok") return { skipped: verdict };
      if (signal.aborted) return UNAVAILABLE;

      const startedAt = Date.now();
      const chunks: Uint8Array[] = [];
      let sentChars = 0;
      let outcome: Outcome;
      try {
        outcome = await new Promise<Outcome>((resolve) => {
          const stream = openSpeech(
            {
              apiKey,
              voiceId: options.voiceId,
              model: options.model,
              language: options.language,
              baseUrl: options.baseUrl,
              headers: options.headers,
              connect: options.connect,
              logError: (message) => logError(redact(message)),
            },
            { onAudio: (chunk) => chunks.push(chunk), onDone: () => finish("done"), onFailed: () => finish("failed") },
          );
          const stop = () => {
            stream.close();
            finish("aborted");
          };
          // Плата берётся за знаки, отправленные в ElevenLabs, как бы ни закончилась озвучка.
          function finish(result: Outcome) {
            sentChars = stream.sentChars;
            signal.removeEventListener("abort", stop);
            resolve(result);
          }
          signal.addEventListener("abort", stop, { once: true });
          for (const sentence of sentences) stream.speak(sentence);
          stream.finish();
        });
      } catch (error) {
        logError(`Голосовой ответ: не удалось озвучить: ${describe(error)}`);
        return UNAVAILABLE;
      }

      await usage.record({ ownerId, chatId, messageId, chars: sentChars, startedAt });
      if (outcome !== "done") return UNAVAILABLE;

      try {
        const pcm = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          pcm.set(chunk, offset);
          offset += chunk.length;
        }
        const { audio, durationMs } = await encodePcmToOggOpus(pcm);
        return { audio, mediaType: "audio/ogg", durationMs };
      } catch (error) {
        logError(`Голосовой ответ: не удалось упаковать звук: ${describe(error)}`);
        return UNAVAILABLE;
      }
    },
  };
}
