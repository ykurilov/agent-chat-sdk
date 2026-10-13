import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { createCompactionService } from "../../../src/compaction/compaction-service";
import type { StoredMessage } from "../../../src/conversation/types";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { HANGING_TOOL_CALL_REASON } from "../../../src/tool-approval/approval-parts";
import { conversation } from "../support/compaction-fixtures";
import { generateResult, mockCatalog, mockEnv, mockModelId } from "../support/mock-model";

const openTask = tool({
  description: "Открыть задачу.",
  inputSchema: z.object({ id: z.string() }),
  execute: async () => "открыта",
});

/** Первый ответ ветки оборвался на вызове инструмента: вызов без результата. */
function withHangingCall(messages: StoredMessage[]): StoredMessage[] {
  return messages.map((message) =>
    message.id === "a1"
      ? {
          ...message,
          status: "stopped",
          parts: [
            { type: "step-start" },
            { type: "tool-open_task", toolCallId: "call-1", state: "input-available", input: { id: "2" } } as StoredMessage["parts"][number],
          ],
        }
      : message,
  );
}

describe("сжатие чата с висящим вызовом", () => {
  it("сводка записана; модель сжатия видит вызов закрытым постоянным текстом; оригиналы не тронуты", async () => {
    const storage = createInMemoryChatStorage();
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
    for (const message of withHangingCall(conversation([100, 300, 600]))) await storage.insertMessage(message);
    const before = await storage.listMessages("chat-1");
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }) });
    const logError = vi.fn();
    const service = createCompactionService({
      storage,
      catalog: mockCatalog({ mock: model }),
      env: mockEnv,
      agent: { instructions: "Ты помощник.", tools: { open_task: openTask } },
      settings: resolveCompactionSettings({ thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 }),
      logError,
    });

    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await vi.waitFor(() => expect(service.isCompacting("chat-1")).toBe(false));

    const [record] = await storage.listCompactions("chat-1");
    expect(record).toMatchObject({ fromMessageId: "u1", throughMessageId: "a2", summary: "## Цель\nсводка" });
    expect(logError).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(HANGING_TOOL_CALL_REASON);
    expect(await storage.listMessages("chat-1")).toEqual(before);
  });
});
