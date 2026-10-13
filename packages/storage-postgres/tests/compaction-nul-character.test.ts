import { afterEach, describe, expect, it } from "vitest";
import { createChatService } from "@ykurilov/agent-chat-core";
import { mockCatalog, mockEnv, mockModelId, readAll, summarizingModel } from "../../core/tests/unit/support/mock-model";
import { createPgliteChatStorage } from "./support/pglite-database";
import type { PgliteChatStorage } from "./support/pglite-database";

const storages: PgliteChatStorage[] = [];

afterEach(async () => {
  await Promise.all(storages.splice(0).map((storage) => storage.close()));
});

describe("символ с кодом ноль в сводке сжатия на Postgres", () => {
  it("сводка записывается без него, сжатие удаётся", async () => {
    const storage = await createPgliteChatStorage();
    storages.push(storage);
    const model = summarizingModel("## Цель\nлог:\u0000конец");
    const logged: string[] = [];
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник." },
      compaction: { thresholdTokens: 100_000, tailTokens: 100, summaryCeilingTokens: 100 },
      env: mockEnv,
      logError: (message) => logged.push(message),
    });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) {
      await readAll(await service.sendMessage("anna", chat.id, { id: `u${index + 1}`, role: "user", parts: [{ type: "text", text }] }));
    }

    const outcome = await service.compactNow("anna", chat.id);

    expect(logged).toEqual([]);
    expect(outcome).toBe("compacted");
    const [compaction] = await storage.listCompactions(chat.id);
    expect(compaction?.summary).toBe("## Цель\nлог:конец");
  });
});
