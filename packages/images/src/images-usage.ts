import type { ChatStorage } from "@ykurilov/agent-chat-core";

export interface ImageUsage {
  storage: Pick<ChatStorage, "insertUsageRecord">;
  ownerId: string;
  chatId: string;
  /** Id модели картинок из каталога: `gpt-image-2`. */
  modelId: string;
  providerId: string;
  costUsd: number;
  now: () => Date;
  logError?: (message: string) => void;
}

/**
 * Расход одной картинки (FR-041): та же таблица, по которой считает лимит расходов. Сбой записи не роняет вызов —
 * картинка уже создана, — а уходит в журнал.
 */
export async function recordImageUsage(usage: ImageUsage): Promise<void> {
  try {
    await usage.storage.insertUsageRecord({
      id: crypto.randomUUID(),
      ownerId: usage.ownerId,
      chatId: usage.chatId,
      messageId: null,
      source: "images",
      modelId: usage.modelId,
      providerId: usage.providerId,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: usage.costUsd,
      createdAt: usage.now().toISOString(),
    });
  } catch (error) {
    usage.logError?.(`Картинки: не удалось записать расход ${usage.modelId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
