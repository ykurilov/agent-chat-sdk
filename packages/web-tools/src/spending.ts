import type { WebToolsSpending } from "./create-web-tools";

/** Запись известной цены вызова в общее хранилище лимитов. */
export function createWebUsageRecorder(spending: WebToolsSpending) {
  const now = spending.now ?? (() => Date.now());
  const providerId = spending.providerId ?? "firecrawl";

  async function record(name: string, costUsd: number, ownerId: string, chatId: string) {
    try {
      await spending.storage.insertUsageRecord({
        id: crypto.randomUUID(),
        ownerId,
        chatId,
        messageId: null,
        source: "web_tools",
        modelId: name,
        providerId,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd,
        createdAt: new Date(now()).toISOString(),
      });
    } catch (error) {
      spending.logError?.(`Веб-инструменты: не удалось записать расход ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return record;
}
