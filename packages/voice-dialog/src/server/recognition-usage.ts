import type { ChatStorage } from "@ykurilov/agent-chat-core";

export interface RecognitionUsageOptions {
  storage: ChatStorage;
  /** Модель Soniox: записывается в расход. */
  model: string;
  /** Доллары за час распознанного звука. */
  pricePerHour: number;
  now: () => number;
  logError: (message: string) => void;
}

/** Расход распознавания речи одной сессии диалога: от первого куска звука до конца сессии. */
export interface RecognitionMeter {
  /** Пришёл кусок звука; отсчёт идёт от первого. */
  heard(): void;
  /** Сессия кончилась: расход пишется один раз; сбой хранилища уходит в журнал. */
  finish(): Promise<void>;
}

const PROVIDER_ID = "soniox";

/** Проверяет цену при настройке и выдаёт счётчик на каждую сессию; расход пишется источником `voice_input`, как у диктовки. */
export function createRecognitionUsage(options: RecognitionUsageOptions): (owner: { ownerId: string; chatId: string }) => RecognitionMeter {
  const { storage, model, pricePerHour, now, logError } = options;
  if (typeof pricePerHour !== "number" || !Number.isFinite(pricePerHour) || pricePerHour < 0) {
    throw new Error("recognition.pricePerHour: цена распознавания речи за час звука должна быть числом не меньше нуля");
  }
  return ({ ownerId, chatId }) => {
    let firstAt: number | null = null;
    let finished = false;
    return {
      heard() {
        if (firstAt === null && !finished) firstAt = now();
      },
      async finish() {
        if (finished) return;
        finished = true;
        if (firstAt === null) return;
        const seconds = Math.max(0, (now() - firstAt) / 1000);
        if (seconds <= 0) return;
        try {
          await storage.insertUsageRecord({
            id: crypto.randomUUID(),
            ownerId,
            chatId,
            messageId: null,
            source: "voice_input",
            modelId: model,
            providerId: PROVIDER_ID,
            inputTokens: Math.ceil(seconds),
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            costUsd: (seconds * pricePerHour) / 3600,
            createdAt: new Date(firstAt).toISOString(),
          });
        } catch (error) {
          logError(`Голос: не удалось записать расход распознавания: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    };
  };
}
