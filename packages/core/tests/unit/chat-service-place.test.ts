import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import type { ChatService, ChatServiceOptions } from "../../src/chat-service";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts, withoutToday } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const cardOne = { description: "Карточка клиента «ООО Ромашка», id 42", data: { customerId: 42 } };
const cardTwo = { description: "Карточка клиента «ИП Лютик», id 43", data: { customerId: 43 } };

const callTool = (name: string, id: string, input: object = {}): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) },
  finishPart("tool-calls"),
];
const saying = (value: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([value]), finishPart()];

/** Модель: на каждый вызов следующий сценарий; после списка — короткий текст. */
function scriptedModel(scripts: LanguageModelV4StreamPart[][] = []) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf(scripts[call++] ?? saying(`ответ ${call}`)) }),
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
}

function build(model: MockLanguageModelV4, options: Partial<ChatServiceOptions> = {}) {
  const storage = createInMemoryChatStorage();
  const logError = vi.fn();
  const service: ChatService = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    logError,
    ...options,
  });
  return { service, storage, logError };
}

function lastUserParts(model: MockLanguageModelV4, call = model.doStreamCalls.length - 1): string[] {
  const last = [...model.doStreamCalls[call]!.prompt].reverse().find((message) => message.role === "user")!;
  return withoutToday(typeof last.content === "string" ? [last.content] : last.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)));
}

const sees = (model: MockLanguageModelV4, text: string, call?: number) => lastUserParts(model, call).some((part) => part.includes(text));

const recordingTools = (seen: AgentToolsModel[]) => (model: AgentToolsModel): ToolSet => {
  seen.push(model);
  return { look: tool({ description: "Посмотреть", inputSchema: z.object({}), execute: async () => "вижу" }) };
};

describe("место на экране в службе чата", () => {
  it("sendMessage: модель видит место, инструмент получает человека, чат и место с данными", async () => {
    const seen: AgentToolsModel[] = [];
    const model = scriptedModel();
    const { service } = build(model, { agent: { instructions: "Ты помощник.", tools: recordingTools(seen) } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "добавь ему заметку"), { page: { place: cardOne, tabId: "tab-1" } }));
    expect(sees(model, "ООО Ромашка")).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ ownerId: "anna", chatId: chat.id, place: cardOne });
  });

  it("место не уходит в историю чата; в хранилище — только в служебной части ответа", async () => {
    const model = scriptedModel();
    const { service, storage } = build(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет"), { page: { place: cardOne } }));
    const [question, answer] = await storage.listMessages(chat.id);
    expect(JSON.stringify(question)).not.toContain("Ромашка");
    expect(JSON.stringify(answer!.parts[0])).toContain("Ромашка");
    expect(JSON.stringify(answer)).not.toContain("customerId");
    expect(JSON.stringify(await service.getHistory("anna", chat.id))).not.toContain("Ромашка");
  });

  it("без page — как раньше: места нет ни в запросе, ни в инструментах (FR-012, FR-016)", async () => {
    const seen: AgentToolsModel[] = [];
    const model = scriptedModel();
    const { service } = build(model, { agent: { instructions: "Ты помощник.", tools: recordingTools(seen) } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(lastUserParts(model)).toEqual(["привет"]);
    expect(seen[0]!.place).toBeNull();
  });

  it("место не запоминается: без page — приписка «больше не действует», с новым page — новое место", async () => {
    const model = scriptedModel();
    const { service } = build(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "первое"), { page: { place: cardOne } }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "второе")));
    expect(sees(model, "Больше не действует: «screen_place»", 1)).toBe(true);
    expect(sees(model, "Ромашка", 1)).toBe(false);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "третье"), { page: { place: cardTwo } }));
    expect(sees(model, "ИП Лютик", 2)).toBe(true);
    expect(sees(model, "ООО Ромашка", 2)).toBe(false);
  });

  it("page.place = null и пустое описание — места нет", async () => {
    const model = scriptedModel();
    const { service } = build(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "первое"), { page: { place: null } }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "второе"), { page: { place: { description: "  " } } }));
    expect(sees(model, "screen_place", 0)).toBe(false);
    expect(sees(model, "screen_place", 1)).toBe(false);
  });

  it("описание длиннее placeMaxLength обрезается; в журнал — строка без текста", async () => {
    const seen: AgentToolsModel[] = [];
    const model = scriptedModel();
    const { service, logError } = build(model, { agent: { instructions: "Ты помощник.", placeMaxLength: 100, tools: recordingTools(seen) } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет"), { page: { place: { description: `СЕКРЕТ ${"в".repeat(500)}` } } }));
    expect(seen[0]!.place!.description).toHaveLength(100);
    expect(seen[0]!.place!.description.endsWith("…")).toBe(true);
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain("в".repeat(101));
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toContain(chat.id);
    expect(logError.mock.calls[0]![0]).not.toContain("СЕКРЕТ");
  });

  it("по умолчанию предел 1000 знаков", async () => {
    const seen: AgentToolsModel[] = [];
    const { service } = build(scriptedModel(), { agent: { instructions: "Ты помощник.", tools: recordingTools(seen) } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет"), { page: { place: { description: "г".repeat(2500) } } }));
    expect(seen[0]!.place!.description).toHaveLength(1000);
  });

  it("data больше 4 КБ отбрасывается с записью в журнал, описание остаётся", async () => {
    const seen: AgentToolsModel[] = [];
    const { service, logError } = build(scriptedModel(), { agent: { instructions: "Ты помощник.", tools: recordingTools(seen) } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет"), { page: { place: { description: "Карточка", data: { big: "я".repeat(5000) } } } }));
    expect(seen[0]!.place).toEqual({ description: "Карточка" });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("placeMaxLength меньше 100 — ошибка при создании службы", () => {
    expect(() => build(scriptedModel(), { agent: { instructions: "Ты помощник.", placeMaxLength: 50 } })).toThrow(/placeMaxLength/);
  });

  it("editMessage и regenerate берут место из своего запроса", async () => {
    const model = scriptedModel();
    const { service } = build(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "первое")));

    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1b", "правка"), { page: { place: cardOne } }));
    expect(sees(model, "ООО Ромашка")).toBe(true);

    const { messages } = await service.getHistory("anna", chat.id);
    const answer = messages.filter((message) => message.role === "assistant").at(-1)!;
    await readAll(await service.regenerate("anna", chat.id, answer.id, { place: cardTwo }));
    expect(sees(model, "ИП Лютик")).toBe(true);
    expect(sees(model, "ООО Ромашка")).toBe(false);
  });

  it("retry берёт место из своего запроса", async () => {
    const failing: LanguageModelV4StreamPart[] = [streamStart, { type: "error", error: new Error("boom") }];
    const model = scriptedModel([failing]);
    const { service } = build(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "первое"), { page: { place: cardOne } }));
    await readAll(await service.retry("anna", chat.id, { place: cardTwo }));
    expect(sees(model, "ИП Лютик", 1)).toBe(true);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).not.toContain("ООО Ромашка");
  });

  it("продолжение после подтверждения: инструменты получают новое место, модель — заметку о нём после результата, вопрос прежний", async () => {
    const seen: AgentToolsModel[] = [];
    const model = scriptedModel([callTool("remove", "c1", { path: "a" }), saying("Готово")]);
    const { service } = build(model, {
      agent: {
        instructions: "Ты помощник.",
        tools: (toolsModel) => {
          seen.push(toolsModel);
          return { remove: tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute: async ({ path }) => `удалено ${path}` }) };
        },
      },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "удали a"), { page: { place: cardOne } }));
    const { messages } = await service.getHistory("anna", chat.id);
    const asked = messages.at(-1)!.parts.find((part) => part.type === "tool-remove") as { approval?: { id: string } };
    const resumed = await service.answerApproval("anna", chat.id, asked.approval!.id, "allow", { place: cardTwo });
    expect(resumed.resumed).toBe(true);
    await readAll((await service.subscribe("anna", chat.id)) ?? new ReadableStream({ start: (c) => c.close() }));
    await service.flush();

    expect(seen).toHaveLength(2);
    expect(seen[0]!.place).toEqual(cardOne);
    expect(seen[1]!.place).toEqual(cardTwo);
    const [first, second] = model.doStreamCalls.map((call) => call.prompt);
    expect(second!.slice(0, first!.length).map((message) => JSON.stringify(message))).toEqual(first!.map((message) => JSON.stringify(message)));
    expect(second!.at(-2)!.role).toBe("tool");
    expect(sees(model, "ИП Лютик", 1)).toBe(true);
    expect(JSON.stringify(second!.slice(0, -1))).not.toContain("ИП Лютик");
  });

  it("место не попадает в запрос сжатия", async () => {
    const contexts = [100, 300, 400];
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const context = contexts[call++] ?? 400;
        const usage = {
          inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        };
        return { stream: streamOf([streamStart, ...textParts([`ответ ${call}`]), { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }]) };
      },
      doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
    });
    const { service } = build(model, { compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 } });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) {
      await readAll(await service.sendMessage("anna", chat.id, userMessage(`u${index + 1}`, text), { page: { place: cardOne } }));
    }
    expect(await service.compactNow("anna", chat.id)).toBe("compacted");
    expect(model.doGenerateCalls.length).toBeGreaterThan(0);
    for (const request of model.doGenerateCalls) expect(JSON.stringify(request.prompt)).not.toContain("screen_place");
  });
});

describe("два человека одновременно (SC-006)", () => {
  it("20 повторов: каждый вызов инструмента получил своего человека, свой чат и своё место", async () => {
    for (let round = 0; round < 20; round++) {
      const calls: Array<{ user: string; owner: string; chat: string; place: string | undefined }> = [];
      let step = 0;
      const model = new MockLanguageModelV4({
        // Оба хода идут одной моделью: на первый запрос хода — вызов инструмента, на второй — ответ.
        doStream: async ({ prompt }) => {
          const hasResult = prompt.some((message) => message.role === "tool");
          step++;
          return { stream: streamOf(hasResult ? saying("ок") : callTool("look", `call-${step}`)) };
        },
      });
      const { service } = build(model, {
        agent: {
          instructions: "Ты помощник.",
          tools: (toolsModel) => ({
            look: tool({
              description: "Посмотреть",
              inputSchema: z.object({}),
              execute: async () => {
                // Даём второму ходу вклиниться: общие переменные сервера здесь бы перепутались.
                await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
                calls.push({ user: toolsModel.ownerId, owner: toolsModel.ownerId, chat: toolsModel.chatId, place: toolsModel.place?.description });
                return "вижу";
              },
            }),
          }),
        },
      });
      const anna = await service.createChat("anna");
      const boris = await service.createChat("boris");
      await Promise.all([
        service.sendMessage("anna", anna.id, userMessage("ua", "привет"), { page: { place: { description: "Анна: карточка 1" } } }).then(readAll),
        service.sendMessage("boris", boris.id, userMessage("ub", "привет"), { page: { place: { description: "Борис: карточка 2" } } }).then(readAll),
      ]);
      expect(calls).toHaveLength(2);
      expect(calls.find((call) => call.owner === "anna")).toMatchObject({ chat: anna.id, place: "Анна: карточка 1" });
      expect(calls.find((call) => call.owner === "boris")).toMatchObject({ chat: boris.id, place: "Борис: карточка 2" });
    }
  });
});
