import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { AgentViewerInput } from "../../src/agent-run/agent-viewer";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import { createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModelId, readAll, summarizingModel } from "./support/mock-model";

const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

describe("служба чата: agent.viewer", () => {
  it("один вызов на ход; инструменты хода и запроса сжатия получают права", async () => {
    const model = summarizingModel("## Цель\nсводка", [100, 600]);
    const viewer = vi.fn(async ({ userId }: { userId: string }) => ({ isAdmin: userId === "anna" }));
    const seen: AgentToolsModel[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        viewer,
        tools: (toolsModel) => {
          seen.push(toolsModel);
          return {};
        },
      },
      compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 },
      env: mockEnv,
      logError: vi.fn(),
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, user("u1", "раз")));
    expect(viewer).toHaveBeenCalledTimes(1);
    await readAll(await service.sendMessage("anna", chat.id, user("u2", "два")));
    await vi.waitFor(() => expect(model.doGenerateCalls.length).toBeGreaterThan(0));
    const compactionModels = seen.filter((toolsModel) => toolsModel.turnId === undefined);
    expect(compactionModels.length).toBeGreaterThan(0);
    for (const toolsModel of seen) expect(toolsModel.viewer).toEqual({ isAdmin: true });
  });

  it("сжатие в групповом чате: viewer и инструменты получают audience «group» и канал, как ход", async () => {
    const model = summarizingModel("## Цель\nсводка", [100, 600]);
    const viewer = vi.fn(async (_input: AgentViewerInput) => ({ isAdmin: true }));
    const seen: AgentToolsModel[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        viewer,
        tools: (toolsModel): ToolSet => {
          seen.push(toolsModel);
          return {};
        },
      },
      compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 },
      env: mockEnv,
      logError: vi.fn(),
    });
    const chat = await service.createChat("anna");
    const group = { channel: "telegram" as const, group: { allowedTools: [], author: "Борис" } };
    await readAll(await service.sendMessage("anna", chat.id, user("u1", "раз"), group));
    await readAll(await service.sendMessage("anna", chat.id, user("u2", "два"), group));
    await vi.waitFor(() => expect(model.doGenerateCalls.length).toBeGreaterThan(0));
    const compactionModels = seen.filter((toolsModel) => toolsModel.turnId === undefined);
    expect(compactionModels.length).toBeGreaterThan(0);
    for (const toolsModel of compactionModels) expect(toolsModel).toMatchObject({ audience: "group", channel: "telegram" });
    expect(viewer.mock.calls.every(([input]) => input.audience === "group")).toBe(true);
  });
});
