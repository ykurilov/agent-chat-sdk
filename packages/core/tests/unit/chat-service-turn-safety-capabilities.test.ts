import { expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, mockModelId, streamOf } from "./support/mock-model";

const settings = () => ({
  catalog: mockCatalog({ mock: mockModel(() => streamOf([])) }),
  defaultChoice: { modelId: mockModelId, providerId: "mock" },
  agent: { instructions: "Ты помощник." },
  env: mockEnv,
});

it("a lease adapter cannot silently ignore atomic turn write guards", () => {
  const { guardedTurnWrites: _capability, ...legacy } = createInMemoryChatStorage();
  expect(() => createChatService({ ...settings(), storage: legacy })).toThrow(/guardedTurnWrites/);
});

it("a legacy adapter without liveness explicitly warns that default recovery is unavailable", async () => {
  const { listSilentAnswerIds: _liveness, ...legacy } = createInMemoryChatStorage();
  const logError = vi.fn();
  const service = createChatService({ ...settings(), storage: legacy, logError });
  try {
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("Автоматическое восстановление ответов недоступно"));
  } finally { await service.flush(); }
});
