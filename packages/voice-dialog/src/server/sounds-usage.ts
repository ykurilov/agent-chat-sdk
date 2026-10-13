import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";

export interface SoundsUsageOptions {
  storage: ChatStorage;
  /** Модель Scribe: записывается в расход. */
  model: string;
  /** Доллары за час звука; обязательна. */
  pricePerHour: number;
  spendingLimits?: SpendingLimits | undefined;
  now?: (() => number) | undefined;
  logError: (message: string) => void;
}

export interface SoundsSpend {
  ownerId: string;
  chatId: string;
  /** Длина звука, отправленного в Scribe, с перекрытиями; может быть дробной. */
  seconds: number;
  /** Когда ушёл запрос: расход попадает в тот период. Без значения — сейчас. */
  startedAt?: number | undefined;
}

/** Расход распознавания звуков человека: проверка лимита перед запросом и запись `sounds` после ответа. */
export interface SoundsUsage {
  /** Можно ли звать Scribe: лимит не исчерпан. Сбой проверки — нельзя, но без исключения. */
  canDetect(input: { userId: string; chatId: string }): Promise<boolean>;
  /** Пишет расход; сбой хранилища уходит в журнал и не мешает режиму. */
  record(spend: SoundsSpend): Promise<void>;
}

const PROVIDER_ID = "elevenlabs";

export function createSoundsUsage(options: SoundsUsageOptions): SoundsUsage {
  const { storage, model, logError, pricePerHour } = options;
  const now = options.now ?? (() => Date.now());
  if (typeof pricePerHour !== "number" || !Number.isFinite(pricePerHour) || pricePerHour < 0) {
    throw new Error("pricePerHour: цена звуков (Scribe) за час звука должна быть числом не меньше нуля");
  }

  return {
    async canDetect(input) {
      if (!options.spendingLimits) return true;
      try {
        await options.spendingLimits.assertWithinLimit(input);
        return true;
      } catch (error) {
        if (error instanceof SpendingLimitReachedError) return false;
        logError(`Звуки: не удалось проверить лимит расходов: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    },

    async record({ ownerId, chatId, seconds, startedAt }) {
      if (seconds <= 0) return;
      try {
        await storage.insertUsageRecord({
          id: crypto.randomUUID(),
          ownerId,
          chatId,
          messageId: null,
          source: "sounds",
          modelId: model,
          providerId: PROVIDER_ID,
          inputTokens: Math.ceil(seconds),
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          costUsd: (seconds * pricePerHour) / 3600,
          createdAt: new Date(startedAt ?? now()).toISOString(),
        });
      } catch (error) {
        logError(`Звуки: не удалось записать расход: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
