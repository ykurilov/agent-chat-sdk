import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatService } from "@ykurilov/agent-chat-core";
import { expect, it, vi } from "vitest";
import { mockCatalog, mockEnv, mockModelId, readAll } from "../../core/tests/unit/support/mock-model";
import { scriptedModel, userMessage } from "../../core/tests/unit/support/notice-chat";
import { createSqliteChatStorage } from "../src/sqlite-storage";

it("history-start snapshot persists across closing/reopening SQLite and recreating the service", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-history-start-"));
  let storage = createSqliteChatStorage({ filePath: join(directory, "chat.sqlite") });
  const source = vi.fn(() => [{ key: "profile", text: "PERSISTED_A" }]);
  const model = scriptedModel();
  const openService = () => createChatService({ storage, catalog: mockCatalog({ mock: model }), defaultChoice: { modelId: mockModelId, providerId: "mock" }, env: mockEnv,
    agent: { instructions: "Помощник", contextBlocks: source, contextBlocksRefresh: "history-start" } });
  let service = openService();
  try {
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    await service.flush(); storage.close();
    storage = createSqliteChatStorage({ filePath: join(directory, "chat.sqlite") });
    source.mockImplementation(() => [{ key: "profile", text: "SHOULD_NOT_REFRESH_B" }]);
    service = openService();
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
    expect(source).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain("PERSISTED_A"); expect(prompt).not.toContain("SHOULD_NOT_REFRESH_B");
    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("new-root", "новое начало")));
    expect(source).toHaveBeenCalledTimes(2);
    await service.flush();
  } finally { await service.flush(); storage.close(); rmSync(directory, { recursive: true, force: true }); }
});
