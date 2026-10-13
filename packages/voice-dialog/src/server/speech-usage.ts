import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";

export interface SpeechUsageOptions {
  storage: ChatStorage;
  /** Модель озвучки: по ней берётся цена и она записывается в расход. */
  model: string;
  /** Доллары за 1000 знаков; на используемую модель цена обязательна. */
  pricePerThousandChars: Record<string, number>;
  spendingLimits?: SpendingLimits | undefined;
  now?: (() => number) | undefined;
  logError: (message: string) => void;
}

export interface SpeechSpend {
  ownerId: string;
  chatId: string;
  /** Сообщение агента, которое озвучивалось. */
  messageId: string | null;
  /** Знаки, реально отправленные в ElevenLabs. */
  chars: number;
  /** Начало реплики: расход попадает в тот период, в котором реплика началась. Без значения — сейчас. */
  startedAt?: number | undefined;
}

export type SpeakVerdict = "ok" | "limit" | "unavailable";

/** Расход озвучки: проверка лимита до реплики и одна запись `speech` после неё. */
export interface SpeechUsage {
  /** Ждёт записи расхода того же человека, начатые раньше: проверка видит всё, что уже потрачено. */
  assertCanSpeak(input: { userId: string; chatId: string }): Promise<SpeakVerdict>;
  /** Пишет расход; сбой хранилища уходит в журнал и не мешает режиму. */
  record(spend: SpeechSpend): Promise<void>;
}

const PROVIDER_ID = "elevenlabs";

export function createSpeechUsage(options: SpeechUsageOptions): SpeechUsage {
  const { storage, model, logError } = options;
  const now = options.now ?? (() => Date.now());
  const configuredPrice = options.pricePerThousandChars[model];
  if (configuredPrice === undefined) throw new Error(`pricePerThousandChars: не задана цена озвучки для модели ${model}`);
  if (!Number.isFinite(configuredPrice) || configuredPrice < 0) throw new Error(`pricePerThousandChars: цена для модели ${model} должна быть числом не меньше нуля`);
  const price: number = configuredPrice;

  /** Записи расхода, которые ещё идут, по человеку: проверка лимита ждёт их. */
  const writing = new Map<string, Promise<unknown>>();

  function track(ownerId: string, write: Promise<void>) {
    const previous = writing.get(ownerId);
    const pending = previous ? Promise.all([previous, write]) : write;
    writing.set(ownerId, pending);
    void pending.then(() => {
      if (writing.get(ownerId) === pending) writing.delete(ownerId);
    });
  }

  async function insert({ ownerId, chatId, messageId, chars, startedAt }: SpeechSpend): Promise<void> {
    try {
      await storage.insertUsageRecord({
        id: crypto.randomUUID(),
        ownerId,
        chatId,
        messageId,
        source: "speech",
        modelId: model,
        providerId: PROVIDER_ID,
        inputTokens: chars,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: (chars * price) / 1000,
        createdAt: new Date(startedAt ?? now()).toISOString(),
      });
    } catch (error) {
      logError(`Озвучка: не удалось записать расход: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    async assertCanSpeak(input) {
      await writing.get(input.userId);
      if (!options.spendingLimits) return "ok";
      try {
        await options.spendingLimits.assertWithinLimit(input);
        return "ok";
      } catch (error) {
        if (error instanceof SpendingLimitReachedError) return "limit";
        // Сбой проверки — не пропуск: озвучки не будет, но и режим не падает.
        logError(`Озвучка: не удалось проверить лимит расходов: ${error instanceof Error ? error.message : String(error)}`);
        return "unavailable";
      }
    },

    record(spend) {
      if (spend.chars <= 0) return Promise.resolve();
      const write = insert(spend);
      track(spend.ownerId, write);
      return write;
    },
  };
}
