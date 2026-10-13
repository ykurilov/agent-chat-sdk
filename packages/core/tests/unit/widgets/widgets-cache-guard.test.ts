import { tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../../src/chat-service";
import type { AgentSettings } from "../../../src/chat-service";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { CHOICE_INPUT, answerAndFinish, ask, step, widgetCall, widgetChat } from "../support/widget-chat";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const appTools = {
  remove: tool({ description: "Удалить файл", inputSchema: z.object({ path: z.string() }), execute: async () => "удалено" }),
  find: tool({ description: "Найти файл", inputSchema: z.object({ name: z.string() }), execute: async () => "нашёл" }),
};

/** Два хода подряд; запросы к модели — без сигнала отмены, остальное как есть. */
async function requestsOf(agent: AgentSettings): Promise<string> {
  const model = mockModel(() => streamOf([streamStart, ...textParts(["Готово"]), finishPart()]));
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent,
    env: mockEnv,
  });
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
  return JSON.stringify(
    model.doStreamCalls.map(({ abortSignal: _abortSignal, ...call }) => call),
    null,
    1,
  );
}

describe("SC-005: без agent.widgets запрос модели как в 0.15", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 9, 0)));
  });
  afterEach(() => vi.useRealTimers());

  // Снимки записаны кодом 0.15 до виджетов: любое расхождение — сломанный кэш у приложений без настройки.
  it("инструменты набором", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник.", tools: appTools })).toMatchFileSnapshot("__snapshots__/request-0.15-static-tools.json");
  });

  it("инструменты функцией", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник.", tools: () => appTools })).toMatchFileSnapshot("__snapshots__/request-0.15-tools-function.json");
  });

  it("без инструментов", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник." })).toMatchFileSnapshot("__snapshots__/request-0.15-no-tools.json");
  });
});

describe("SC-005: с виджетами начало запроса постоянное, ответ — короткий JSON", () => {
  it("два хода и продолжение после ответа: инструкция и инструменты побайтно равны, ответ не меняет начало запроса", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))], { agent: { tools: appTools } });
    const { chat } = await ask(service);
    await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" });
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "дальше")));
    const [first, resumed, next] = model.doStreamCalls;
    for (const other of [resumed!, next!]) {
      expect(JSON.stringify(other.tools)).toBe(JSON.stringify(first!.tools));
      expect(JSON.stringify(other.prompt[0])).toBe(JSON.stringify(first!.prompt[0]));
    }
    // Продолжение дописывает вызов и ответ в конец: всё, что было в первом запросе, на месте байт в байт.
    expect(JSON.stringify(resumed!.prompt.slice(0, first!.prompt.length))).toBe(JSON.stringify(first!.prompt));
    const result = resumed!.prompt.at(-1)!;
    expect(result.role).toBe("tool");
    expect(JSON.stringify((result.content as Array<{ output: unknown }>)[0]!.output)).toBe('{"type":"json","value":{"выбрано":"Про"}}');
  });
});
