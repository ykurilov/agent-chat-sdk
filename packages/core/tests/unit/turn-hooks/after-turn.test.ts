import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatEvents } from "../../../src/chat-events/chat-events";
import { newStoredMessage } from "../../../src/conversation/types";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { createAfterTurn } from "../../../src/turn-hooks/after-turn";
import type { FinishedTurn } from "../../../src/turn-hooks/after-turn";
import type { AfterTurnHandler } from "../../../src/turn-hooks/turn-hooks";
import { mockCatalog, mockModel, mockModelId } from "../support/mock-model";

async function pendingAnswer() {
  const storage = createInMemoryChatStorage();
  await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.insertMessage(newStoredMessage({ id: "a1", chatId: "c1", role: "assistant", parts: [{ type: "text", text: "Зачёт" }], afterTurn: "pending" }));
  return storage;
}

const turn: FinishedTurn = {
  ownerId: "anna",
  chatId: "c1",
  messageId: "a1",
  status: "complete",
  parts: [{ type: "text", text: "Зачёт" }],
  usage: null,
  error: null,
  modelId: mockModelId,
  providerId: "mock",
  trigger: "send",
  channel: "web",
};

describe("afterTurn: паузы между попытками", () => {
  afterEach(() => vi.useRealTimers());

  it("срок вышел посреди паузы: пауза снята, таймеров не остаётся", async () => {
    vi.useFakeTimers();
    const storage = await pendingAnswer();
    const handler = vi.fn<AfterTurnHandler>(() => {
      throw new Error("лежит");
    });
    const hook = createAfterTurn({
      settings: { handler, timeoutMs: 500, attempts: 3 },
      storage,
      catalog: mockCatalog({ mock: mockModel(() => new ReadableStream()) }),
      chatEvents: createChatEvents(),
      logError: () => {},
    });
    const done = hook.afterTurn(turn);
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toEqual([]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect((await storage.getMessage("a1"))?.afterTurn).toBe("failed");
  });
});

describe("afterTurn: сотрудник хода", () => {
  it("итог, доделанный после перезапуска, берёт сотрудника из `staffOf`: `staff` и `actorId`", async () => {
    const storage = await pendingAnswer();
    const handler = vi.fn<AfterTurnHandler>();
    const hook = createAfterTurn({
      settings: { handler, timeoutMs: 500, attempts: 1 },
      storage,
      catalog: mockCatalog({ mock: mockModel(() => new ReadableStream()) }),
      chatEvents: createChatEvents(),
      logError: () => {},
      staffOf: (chat) => (chat.id === "c1" ? { id: "boris" } : null),
    });
    hook.recoverLater("a1");
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler.mock.calls[0]![0]).toMatchObject({ recovered: true, ownerId: "anna", actorId: "boris", staff: { id: "boris" } });
  });
});

