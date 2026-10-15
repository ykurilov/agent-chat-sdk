import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { AgentSettings } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf } from "./support/mock-model";

const STEP = "<lesson_step>\nшаг 2 из 5\n</lesson_step>";

/** Два хода подряд: ответы модели по очереди из `answers`; запросы к модели и записанные ответы. */
async function twoTurns(agent: AgentSettings, answers: string[], logError: (line: string) => void = () => {}) {
  let call = 0;
  const model = mockModel(() => streamOf(reasoningAndTextParts([answers[call++] ?? "Ок."])));
  const storage = createInMemoryChatStorage();
  const service = createChatService({ storage, catalog: mockCatalog({ mock: model }), defaultChoice: { modelId: mockModelId, providerId: "mock" }, agent, env: mockEnv, logError });
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }));
  await readAll(await service.sendMessage("anna", chat.id, { id: "u2", role: "user", parts: [{ type: "text", text: "Дальше" }] }));
  const saved = (await storage.listMessages(chat.id)).filter((message) => message.role === "assistant");
  return { requests: model.doStreamCalls.map((options) => JSON.stringify(options.prompt)), saved: saved.map((message) => JSON.stringify(message.parts)) };
}

describe("служебные форматы приложения (agent.serviceBlocks)", () => {
  it("ошибка в формате — TypeError при создании службы", () => {
    const create = (serviceBlocks: AgentSettings["serviceBlocks"]) =>
      createChatService({ storage: createInMemoryChatStorage(), catalog: mockCatalog({ mock: mockModel(() => streamOf([])) }), defaultChoice: { modelId: mockModelId, providerId: "mock" }, agent: { instructions: "Ты помощник.", serviceBlocks }, env: mockEnv });
    expect(() => create([{ tag: "плохой тег" }])).toThrow(TypeError);
    expect(() => create([{ name: "", line: "Шаг: " }])).toThrow(TypeError);
    expect(() => create([{ tag: "lesson_step" }])).not.toThrow();
  });

  it("блок приложения вырезан из записи и из запроса следующего хода; строка в журнал", async () => {
    const logError = vi.fn();
    const { requests, saved } = await twoTurns({ instructions: "Ты помощник.", serviceBlocks: [{ tag: "lesson_step" }] }, [`Отлично!\n\n${STEP}`, "Идём дальше."], logError);
    expect(saved[0]).not.toContain("lesson_step");
    expect(saved[0]).toContain("Отлично!");
    expect(requests[1]).not.toContain("lesson_step");
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/^\[служебный блок вырезан\] тег=lesson_step чат=\S+ ответ=\S+ модель=mock-model провайдер=mock$/));
  });

  it("ответы без блоков: запросы побайтно те же, что без настройки", async () => {
    const answers = ["Привет! Чем помочь?", "Хорошо, продолжаем."];
    const plain = await twoTurns({ instructions: "Ты помощник." }, answers);
    const withFormats = await twoTurns({ instructions: "Ты помощник.", serviceBlocks: [{ tag: "lesson_step" }, { name: "lesson_line", line: "Шаг урока: " }] }, answers);
    expect(withFormats.requests).toEqual(plain.requests);
    expect(withFormats.saved.map((parts) => parts.replace(/"base":"[^"]*"/, ""))).toEqual(plain.saved.map((parts) => parts.replace(/"base":"[^"]*"/, "")));
  });
});
