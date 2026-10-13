import { describe, expect, it } from "vitest";
import { newStoredMessage } from "../../../src/conversation/types";
import type { ChatMessageMetadata, StoredMessage, UsageRecord, UsageSource, VoiceCut } from "../../../src/conversation/types";
import { toAgentChatMessage } from "../../../src/conversation/to-agent-chat-message";

const cut: VoiceCut = { partIndex: 1, charOffset: 42, spokenTail: "…и на этом месте меня перебили" };

function answer(fields: Partial<StoredMessage> = {}): StoredMessage {
  return newStoredMessage({
    id: "a1",
    chatId: "chat-1",
    parentId: "u1",
    role: "assistant",
    parts: [{ type: "text", text: "ответ" }],
    modelId: "m",
    providerId: "p",
    ...fields,
  });
}

describe("отметка обрыва озвучки (voiceCut)", () => {
  it("у нового сообщения отметки нет: null", () => {
    expect(newStoredMessage({ id: "a", chatId: "c", role: "assistant" }).voiceCut).toBeNull();
  });

  it("сообщение агента отдаёт отметку в метаданных, чтобы её видел экран", () => {
    const message = toAgentChatMessage(answer({ voiceCut: cut }));
    expect(message.metadata?.voiceCut).toEqual(cut);
  });

  it("старые данные без поля читаются как «отметки нет»: в метаданных поля нет", () => {
    const { voiceCut: _dropped, ...oldMessage } = answer();
    const message = toAgentChatMessage(oldMessage as StoredMessage);
    expect(message.metadata).not.toHaveProperty("voiceCut");
    expect(toAgentChatMessage(answer({ voiceCut: null })).metadata).not.toHaveProperty("voiceCut");
  });

  it("сообщение собеседника отметку не несёт", () => {
    const message = toAgentChatMessage(newStoredMessage({ id: "u", chatId: "c", role: "user", voiceCut: cut }));
    expect(message).not.toHaveProperty("metadata");
  });

  it("поле метаданных — необязательное", () => {
    const metadata: ChatMessageMetadata = { status: "complete" };
    expect(metadata.voiceCut).toBeUndefined();
  });
});

describe("источник расхода «озвучка» (speech)", () => {
  it("запись расхода принимает source: speech", () => {
    const source: UsageSource = "speech";
    const record: UsageRecord = {
      id: "r1",
      ownerId: "anna",
      chatId: "chat-1",
      messageId: "a1",
      source,
      modelId: "eleven_v4_turbo",
      providerId: "elevenlabs",
      inputTokens: 120,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.0072,
      createdAt: "2026-09-30T10:00:00.000Z",
    };
    expect(record.source).toBe("speech");
  });
});
