import { describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { AgentSettings } from "../../src/chat-service";
import { diagramsInstructions } from "../../src/index";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf } from "./support/mock-model";

/** Весь запрос к модели первого хода — строкой: по ней видно и инструкцию, и побайтовое равенство. */
async function firstRequest(agent: AgentSettings): Promise<string> {
  const model = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent,
    env: mockEnv,
  });
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }));
  return JSON.stringify(model.doStreamCalls[0]!.prompt);
}

describe("строка схем в инструкции (agent.diagrams, FR-023)", () => {
  it("постоянная строка: блок mermaid, предел узлов, без ссылок и HTML", () => {
    expect(diagramsInstructions).toMatch(/mermaid/);
    expect(diagramsInstructions).toMatch(/50/);
    expect(diagramsInstructions).toMatch(/ссылок/);
    expect(diagramsInstructions).toMatch(/HTML/);
  });

  it("agent.diagrams: true дописывает строку к инструкции один раз, и если приложение уже добавило её — без дубля", async () => {
    for (const base of ["Ты помощник.", `Ты помощник.\n${diagramsInstructions}`]) {
      const request = await firstRequest({ instructions: base, diagrams: true });
      expect(request.split(JSON.stringify(diagramsInstructions).slice(1, -1))).toHaveLength(2);
      expect(request).toContain("Ты помощник.");
    }
  });

  it("без настройки запрос к модели побайтно прежний (SC-005); diagrams: false — тоже", async () => {
    const plain = await firstRequest({ instructions: "Ты помощник." });
    expect(plain).not.toContain("mermaid");
    expect(await firstRequest({ instructions: "Ты помощник.", diagrams: false })).toBe(plain);
  });
});
