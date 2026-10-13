import { describe, expect, it, vi } from "vitest";
import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { recordImageUsage } from "../src/images-usage";

const NOW = new Date("2026-10-03T10:00:00.000Z");

describe("расход картинок (T044)", () => {
  it("одна запись на картинку: source images, модель и провайдер, без сообщения и токенов", async () => {
    const records: UsageRecord[] = [];
    const storage = { insertUsageRecord: vi.fn(async (record: UsageRecord) => void records.push(record)) };
    await recordImageUsage({ storage, ownerId: "anna", chatId: "chat-1", modelId: "gpt-image-2", providerId: "runware", costUsd: 0.0071, now: () => NOW });

    expect(records).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        ownerId: "anna",
        chatId: "chat-1",
        messageId: null,
        source: "images",
        modelId: "gpt-image-2",
        providerId: "runware",
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: 0.0071,
        createdAt: NOW.toISOString(),
      },
    ]);
  });

  it("сбой записи не роняет вызов: уходит в журнал", async () => {
    const logError = vi.fn();
    const storage = { insertUsageRecord: vi.fn(async () => Promise.reject(new Error("база недоступна"))) };
    await expect(
      recordImageUsage({ storage, ownerId: "anna", chatId: "chat-1", modelId: "gpt-image-2", providerId: "runware", costUsd: 0.02, now: () => NOW, logError }),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });
});
