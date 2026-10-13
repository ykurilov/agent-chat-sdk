import { afterEach, describe, expect, it } from "vitest";
import { createChatService } from "@ykurilov/agent-chat-core";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "../../core/tests/unit/support/mock-model";
import { createPgliteChatStorage } from "./support/pglite-database";
import type { PgliteChatStorage } from "./support/pglite-database";

const storages: PgliteChatStorage[] = [];

afterEach(async () => {
  await Promise.all(storages.splice(0).map((storage) => storage.close()));
});

describe("символ с кодом ноль в первом сообщении на Postgres", () => {
  it("сообщение отправляется, ответ приходит, название выводится без этого символа", async () => {
    const storage = await createPgliteChatStorage();
    storages.push(storage);
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: mockModel(() => streamOf([streamStart, ...textParts(["ответ"]), finishPart()])) }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник." },
      env: mockEnv,
      compaction: false,
      logError: () => {},
    });
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, { id: "q1", role: "user", parts: [{ type: "text", text: "лог:\u0000конец" }] }));

    const history = await service.getHistory("anna", chat.id);
    expect(history.chat.title).toBe("лог:конец");
    expect(history.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});
