import { generateText, jsonSchema, Output } from "ai";
import type { JSONSchema7 } from "ai";
import { buildModelRequest } from "../agent-run/build-model-request";
import { addTokenUsage, emptyTokenUsage } from "../conversation/token-usage";
import type { ModelCatalog } from "../models/model-catalog";
import type { ChatStorage } from "../storage/chat-storage";
import type { AskModel, RecordUsage } from "../turn-hooks/prepare-turn";
import { costOfSpent, recordSpentTokens } from "./record-usage";

/** Что нужно разовым вызовам модели и записи чужого расхода: то же, что у службы чата. */
export interface OneOffCallsContext {
  storage: ChatStorage;
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  logError: (message: string) => void;
  /** Проверка лимита до вызова: бросает `SpendingLimitReachedError`. */
  assertWithinLimit: (ownerId: string, chatId: string) => Promise<void>;
  /** Расход записан: лимиты сверяют пороги. Не ждётся. */
  afterSpending: (ownerId: string, chatId: string) => void;
}

/** `ChatService.askModel`: один запрос без инструментов и истории; лимит — до вызова, расход — в журнал с `source`. */
export function createAskModel(context: OneOffCallsContext): AskModel {
  return async (input) => {
    await context.assertWithinLimit(input.ownerId, input.chatId);
    const { modelId, providerId } = input.model;
    const startedAt = new Date().toISOString();
    const request = await buildModelRequest({
      catalog: context.catalog,
      modelId,
      providerId,
      chatId: input.chatId,
      instructions: input.system ?? "",
      history: [{ id: "ask", role: "user", parts: [{ type: "text", text: input.prompt }] }],
      env: context.env,
      logError: context.logError,
    });
    // Без `system` — без инструкции: пустую часть провайдеров не принимает.
    const { instructions, ...withoutInstructions } = request;
    const result = await generateText({
      ...withoutInstructions,
      ...(input.system !== undefined && { instructions }),
      ...(input.schema && { output: Output.object({ schema: jsonSchema(input.schema as JSONSchema7) }) }),
      // Временные сбои повторяет обёртка модели из `buildModelRequest`.
      maxRetries: 0,
      ...(input.signal && { abortSignal: input.signal }),
    });
    const spent = emptyTokenUsage();
    addTokenUsage(spent, result.usage);
    await recordSpentTokens({
      storage: context.storage,
      catalog: context.catalog,
      ownerId: input.ownerId,
      chatId: input.chatId,
      messageId: null,
      source: input.source,
      modelId,
      providerId,
      spent,
      startedAt,
      logError: context.logError,
    });
    context.afterSpending(input.ownerId, input.chatId);
    return {
      text: result.text,
      ...(input.schema && { object: result.output }),
      usage: {
        inputTokens: spent.inputTokens,
        outputTokens: spent.outputTokens,
        costUsd: costOfSpent({ catalog: context.catalog, modelId, providerId, spent, startedAt }),
      },
    };
  };
}

/** `ChatService.recordUsage`: расход вызова мимо провайдеров ядра — в журнал по цене сервиса и в лимиты. */
export function createRecordUsage(context: OneOffCallsContext): RecordUsage {
  return async (input) => {
    if (input.cost === 0 && input.inputTokens === 0 && input.outputTokens === 0) return;
    await context.storage.insertUsageRecord({
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      chatId: input.chatId,
      messageId: input.messageId ?? null,
      source: input.source,
      modelId: input.modelId,
      providerId: input.providerId ?? "external",
      inputTokens: input.inputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: input.outputTokens,
      reasoningTokens: 0,
      costUsd: input.cost,
      createdAt: new Date().toISOString(),
    });
    context.afterSpending(input.ownerId, input.chatId);
  };
}
