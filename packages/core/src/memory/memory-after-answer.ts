import { wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import { observeModelCalls } from "../agent-run/observe-model-calls";
import type { TurnObserver } from "../agent-run/turn-observer";
import type { TokenUsage } from "../conversation/types";
import { findModel, resolveLanguageModel } from "../models/model-catalog";
import type { ModelCatalog } from "../models/model-catalog";
import { classifyProviderError } from "../provider-errors/classify-provider-error";
import { describeProviderFailure } from "../provider-errors/provider-failure-log";
import { createTransientRetryMiddleware } from "../provider-errors/transient-retry-middleware";
import type { TransientRetryContext } from "../provider-errors/transient-retry-middleware";
import type { ChatStorage } from "../storage/chat-storage";
import { recordSpentTokens } from "../usage/record-usage";
import type { LongTermMemory } from "./long-term-memory";

/** Сколько при остановке сервера ждать запуски, что ещё идут: дольше держать остановку нельзя. */
const DRAIN_WAIT_MS = 5_000;

export interface MemoryAfterAnswerOptions {
  memory: LongTermMemory | undefined;
  storage: ChatStorage;
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  logError: (message: string) => void;
  /** Наблюдатель хода: обращения памяти — событиями с назначением `memory`. Нет — модель без прослойки. */
  turnObserver?: TurnObserver;
}

export interface MemoryAfterAnswer {
  /** Ответ закончился: запускает `afterAnswer` памяти фоном; ход его не ждёт, сбой уходит в журнал. */
  run(input: { ownerId: string; chatId: string; modelId: string; providerId: string; /** Ответ, после которого запуск. */ answerId?: string }): void;
  /** Штатная остановка: ждёт идущие запуски не дольше пяти секунд. */
  drain(): Promise<void>;
}

/**
 * Дела памяти после законченного ответа (оптимизация дублей). Модель — та, что отвечала; расход пишется
 * источником `memory` на владельца чата. Лимит расходов запуск не проверяет: расход входит в сумму и
 * остановит уже следующий вопрос.
 */
export function createMemoryAfterAnswer({ memory, storage, catalog, env, logError, turnObserver }: MemoryAfterAnswerOptions): MemoryAfterAnswer {
  const running = new Set<Promise<void>>();

  return {
    run({ ownerId, chatId, modelId, providerId, answerId }) {
      if (!memory?.afterAnswer) return;
      const startedAt = new Date().toISOString();
      const recordUsage = (spent: TokenUsage) =>
        recordSpentTokens({ storage, catalog, ownerId, chatId, messageId: null, source: "memory", modelId, providerId, spent, startedAt, logError });
      const job = (async () => {
        const found = findModel(catalog, modelId, providerId);
        try {
          const base = resolveLanguageModel(found, env);
          const observed = turnObserver
            ? observeModelCalls(base, {
                observer: turnObserver,
                ownerId,
                messageId: answerId ?? null,
                purpose: "memory",
                chatId,
                modelId: found.profile.id,
                providerId: found.provider.id,
                ...(found.profile.pricing?.[found.provider.id] && { price: found.profile.pricing[found.provider.id] }),
                logError,
              })
            : base;
          const model = withRetries(observed, { chatId, modelId, providerId, logError });
          await memory.afterAnswer!({ userId: ownerId, chatId, model, recordUsage });
        } catch (failure) {
          const kind = classifyProviderError(failure, found.provider);
          logError(describeProviderFailure(failure, { chatId, modelId, providerId, kind, env, catalog }));
        }
      })()
        .catch((failure) => logError(`Дела памяти после ответа в чате ${chatId} не удались: ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`))
        .finally(() => running.delete(job));
      running.add(job);
    },

    async drain() {
      if (running.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, DRAIN_WAIT_MS);
      });
      await Promise.race([Promise.allSettled([...running]), timeout]);
      clearTimeout(timer);
    },
  };
}

/** Склейка памяти переживает одиночный 429 или сбой сети теми же тихими повторами, что ход (FR-020). */
function withRetries(model: LanguageModel, context: TransientRetryContext): LanguageModel {
  // Строка — id модели шлюза SDK; каталог отдаёт готовые модели, строка сюда не приходит.
  return typeof model === "string" ? model : wrapLanguageModel({ model, middleware: createTransientRetryMiddleware(context) });
}
