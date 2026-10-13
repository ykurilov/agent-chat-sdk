import { describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { AgentSettings } from "../../src/chat-service";
import { diagramsInstructions, liveDemosInstructions } from "../../src/index";
import { assembleInstructions } from "../../src/instructions/assemble-instructions";
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

describe("абзац живых демонстраций в инструкции (agent.liveDemos, 043 FR-002)", () => {
  it("постоянный абзац: блок html-demo, предел, без сети и внешних скриптов, data: для картинок, переменные темы", () => {
    expect(liveDemosInstructions).toMatch(/```html-demo/);
    expect(liveDemosInstructions).toMatch(/30 КБ/);
    expect(liveDemosInstructions).toMatch(/сети/);
    expect(liveDemosInstructions).toMatch(/внешн/);
    expect(liveDemosInstructions).toMatch(/data:/);
    for (const variable of ["--bg", "--surface", "--text", "--muted", "--border", "--accent", "--on-accent"]) expect(liveDemosInstructions).toContain(variable);
    expect(liveDemosInstructions).not.toContain("\n");
  });

  it("agent.liveDemos: true дописывает абзац один раз, после строки схем; уже есть в инструкции — без дубля", async () => {
    for (const base of ["Ты помощник.", `Ты помощник.\n${liveDemosInstructions}`]) {
      const request = await firstRequest({ instructions: base, liveDemos: true });
      expect(request.split(JSON.stringify(liveDemosInstructions).slice(1, -1))).toHaveLength(2);
    }
    expect(assembleInstructions("Ты.", { diagrams: true, liveDemos: true, memory: "Память." })).toBe(`Ты.\n${diagramsInstructions}\n${liveDemosInstructions}\nПамять.`);
  });

  it("без настройки запрос к модели побайтно прежний; liveDemos: false — тоже", async () => {
    const plain = await firstRequest({ instructions: "Ты помощник." });
    expect(plain).not.toContain("html-demo");
    expect(await firstRequest({ instructions: "Ты помощник.", liveDemos: false })).toBe(plain);
  });

  it("служба сообщает, включены ли демонстрации (service.liveDemos): по ней мессенджеры выбирают фразу или код", () => {
    const make = (agent: AgentSettings) =>
      createChatService({ storage: createInMemoryChatStorage(), catalog: mockCatalog({ mock: mockModel(() => streamOf([])) }), defaultChoice: { modelId: mockModelId, providerId: "mock" }, agent, env: mockEnv });
    expect(make({ instructions: "Ты.", liveDemos: true }).liveDemos).toBe(true);
    expect(make({ instructions: "Ты." }).liveDemos).toBe(false);
  });
});
