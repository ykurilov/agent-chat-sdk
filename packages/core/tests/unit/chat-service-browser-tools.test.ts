import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BrowserCallNotPendingError } from "../../src/agent-run/browser-tools";
import { ChatNotFoundError, createChatService } from "../../src/chat-service";
import type { ChatService, ChatServiceOptions } from "../../src/chat-service";
import type { LongTermMemory } from "../../src/memory/long-term-memory";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const callTool = (name: string, id: string, input: object = {}): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) },
  finishPart("tool-calls"),
];
const saying = (value: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([value]), finishPart()];

function scriptedModel(scripts: LanguageModelV4StreamPart[][] = []) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf(scripts[call++] ?? saying(`ответ ${call}`)) }),
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
}

const openTask = tool({ description: "Открыть задачу на экране", inputSchema: z.object({ taskId: z.number() }) });
const highlight = tool({ description: "Подсветить поле", inputSchema: z.object({ field: z.string() }), needsApproval: true });

function build(model: MockLanguageModelV4, options: Partial<ChatServiceOptions> = {}) {
  const storage = createInMemoryChatStorage();
  const logError = vi.fn();
  const service: ChatService = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", browserTools: { open_task: openTask, highlight } },
    env: mockEnv,
    logError,
    ...options,
  });
  return { service, storage, logError };
}

type Reader = ReadableStreamDefaultReader<UIMessageChunk>;

/** Читает поток до куска нужного вида; всё прочитанное — в `seen`. */
async function readUntil(reader: Reader, type: string, seen: UIMessageChunk[] = []): Promise<UIMessageChunk> {
  for (;;) {
    const read = await reader.read();
    if (read.done) throw new Error(`поток кончился раньше куска ${type}; были: ${seen.map((chunk) => chunk.type).join(", ")}`);
    seen.push(read.value);
    if (read.value.type === type) return read.value;
  }
}

async function readRest(reader: Reader, seen: UIMessageChunk[] = []): Promise<UIMessageChunk[]> {
  for (let read = await reader.read(); !read.done; read = await reader.read()) seen.push(read.value);
  return seen;
}

const finalStatus = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === "message-metadata" ? [(chunk.messageMetadata as { status?: string }).status] : [])).filter(Boolean).at(-1);

/** Что модель увидела результатом вызова на втором шаге. */
function toolResultSeen(model: MockLanguageModelV4, call = 1): unknown {
  const prompt = model.doStreamCalls[call]!.prompt;
  const toolMessage = prompt.find((message) => message.role === "tool");
  return toolMessage && Array.isArray(toolMessage.content) ? (toolMessage.content[0] as { output?: unknown }).output : undefined;
}

describe("браузерные инструменты в службе чата", () => {
  afterEach(() => vi.useRealTimers());

  it("вызов уходит своей вкладке куском data-browser-call; ответ вкладки — результат вызова, ход продолжается тем же ответом", async () => {
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 2 }), saying("Открыл задачу 2")]);
    const { service, storage } = build(model);
    const chat = await service.createChat("anna");
    const reader = (await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 2"), { page: { tabId: "tab-1" } })).getReader();
    const seen: UIMessageChunk[] = [];
    const call = await readUntil(reader, "data-browser-call", seen);
    expect(call).toEqual({
      type: "data-browser-call",
      id: "c1",
      data: { toolCallId: "c1", toolName: "open_task", input: { taskId: 2 }, tabId: "tab-1" },
      transient: true,
    });
    await service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", output: { opened: 2 } });
    const chunks = await readRest(reader, seen);
    expect(chunks.find((chunk) => chunk.type === "tool-output-available")).toMatchObject({ toolCallId: "c1", output: { opened: 2 } });
    expect(JSON.stringify(toolResultSeen(model))).toContain("opened");
    expect(finalStatus(chunks)).toBe("complete");
    expect(JSON.stringify(await storage.listMessages(chat.id))).not.toContain("data-browser-call");
  });

  it("ответ вкладки с ошибкой — ошибка вызова с её текстом, модель её видит, ход продолжается", async () => {
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 9 }), saying("Такой задачи нет")]);
    const { service } = build(model);
    const chat = await service.createChat("anna");
    const reader = (await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 9"), { page: { tabId: "tab-1" } })).getReader();
    await readUntil(reader, "data-browser-call");
    await service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", error: "Задачи 9 нет" });
    const chunks = await readRest(reader);
    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({ toolCallId: "c1", errorText: "Задачи 9 нет" });
    expect(JSON.stringify(toolResultSeen(model))).toContain("Задачи 9 нет");
    expect(finalStatus(chunks)).toBe("complete");
  });

  it("запрос без вкладки — сразу ошибка «страница не подключена», кусков вызова нет", async () => {
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 2 }), saying("Не вышло")]);
    const { service } = build(model);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 2")));
    expect(chunks.some((chunk) => chunk.type === "data-browser-call")).toBe(false);
    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({
      errorText: "Действие на экране недоступно: страница не подключена",
    });
    expect(finalStatus(chunks)).toBe("complete");
  });

  it("срок вышел (подменённые часы) — ошибка «Страница не ответила за 3 с», ход дописан; поздний ответ — BrowserCallNotPendingError", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 2 }), saying("Страница молчит")]);
    const { service } = build(model, {
      agent: { instructions: "Ты помощник.", browserTools: { open_task: openTask }, browserToolTimeoutMs: 3000 },
    });
    const chat = await service.createChat("anna");
    const reader = (await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 2"), { page: { tabId: "tab-1" } })).getReader();
    await readUntil(reader, "data-browser-call");
    await vi.advanceTimersByTimeAsync(3000);
    const rest = readRest(reader);
    await vi.advanceTimersByTimeAsync(0);
    const chunks = await rest;
    await service.flush();
    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({ errorText: "Страница не ответила за 3 с" });
    expect(finalStatus(chunks)).toBe("complete");
    await expect(service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", output: "поздно" })).rejects.toBeInstanceOf(BrowserCallNotPendingError);
  });

  it("«стоп» снимает ожидание: ход остановлен, ответ вкладки после — BrowserCallNotPendingError", async () => {
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 2 })]);
    const { service } = build(model);
    const chat = await service.createChat("anna");
    const reader = (await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 2"), { page: { tabId: "tab-1" } })).getReader();
    await readUntil(reader, "data-browser-call");
    expect(await service.stop("anna", chat.id)).toBe(true);
    const chunks = await readRest(reader);
    expect(finalStatus(chunks)).toBe("stopped");
    await expect(service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", output: 1 })).rejects.toBeInstanceOf(BrowserCallNotPendingError);
  });

  it("удаление чата снимает ожидание и не ждёт срока", async () => {
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 2 })]);
    const { service, storage } = build(model);
    const chat = await service.createChat("anna");
    const reader = (await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 2"), { page: { tabId: "tab-1" } })).getReader();
    await readUntil(reader, "data-browser-call");
    await service.deleteChat("anna", chat.id);
    expect(await storage.getChat(chat.id)).toBeNull();
    await readRest(reader);
    await expect(service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", output: 1 })).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("ответ пускается только своему человеку и своей вкладке; повтор — BrowserCallNotPendingError", async () => {
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 2 }), saying("Готово")]);
    const { service } = build(model);
    const chat = await service.createChat("anna");
    const reader = (await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 2"), { page: { tabId: "tab-1" } })).getReader();
    await readUntil(reader, "data-browser-call");
    await expect(service.answerBrowserCall("boris", chat.id, "c1", { tabId: "tab-1", output: "чужой" })).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-2", output: "чужая вкладка" })).rejects.toBeInstanceOf(BrowserCallNotPendingError);
    await expect(service.answerBrowserCall("anna", chat.id, "c2", { tabId: "tab-1", output: "не тот вызов" })).rejects.toBeInstanceOf(BrowserCallNotPendingError);
    await service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", output: "своё" });
    await expect(service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", output: "повтор" })).rejects.toBeInstanceOf(BrowserCallNotPendingError);
    const chunks = await readRest(reader);
    expect(chunks.find((chunk) => chunk.type === "tool-output-available")).toMatchObject({ output: "своё" });
  });

  it("результат больше 16 КБ — ошибка вызова «Слишком большой результат»; ответ вкладки принят", async () => {
    const model = scriptedModel([callTool("open_task", "c1", { taskId: 2 }), saying("Слишком много")]);
    const { service } = build(model);
    const chat = await service.createChat("anna");
    const reader = (await service.sendMessage("anna", chat.id, userMessage("u1", "открой задачу 2"), { page: { tabId: "tab-1" } })).getReader();
    await readUntil(reader, "data-browser-call");
    await service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-1", output: "x".repeat(17 * 1024) });
    const chunks = await readRest(reader);
    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({ errorText: "Слишком большой результат" });
  });

  describe("FR-023: подтверждение", () => {
    async function askHighlight(model: MockLanguageModelV4) {
      const { service } = build(model);
      const chat = await service.createChat("anna");
      const first = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "подсвети телефон"), { page: { tabId: "tab-1" } }));
      const request = first.find((chunk) => chunk.type === "tool-approval-request") as { approvalId: string } | undefined;
      return { service, chat, first, approvalId: request?.approvalId };
    }

    it("кусок data-browser-call уходит только после «Разрешить»", async () => {
      const model = scriptedModel([callTool("highlight", "c1", { field: "phone" }), saying("Подсветил")]);
      const { service, chat, first, approvalId } = await askHighlight(model);
      expect(approvalId).toBeDefined();
      expect(first.some((chunk) => chunk.type === "data-browser-call")).toBe(false);
      expect(await service.answerApproval("anna", chat.id, approvalId!, "allow", { tabId: "tab-2" })).toEqual({ resumed: true });
      const reader = (await service.subscribe("anna", chat.id))!.getReader();
      // Продолжение отдаёт вызов вкладке, которая нажала «Разрешить».
      const call = await readUntil(reader, "data-browser-call");
      expect(call).toMatchObject({ data: { toolName: "highlight", tabId: "tab-2" } });
      await service.answerBrowserCall("anna", chat.id, "c1", { tabId: "tab-2", output: "подсвечено" });
      expect(finalStatus(await readRest(reader))).toBe("complete");
    });

    it("«Запретить» — вкладке ничего не уходит", async () => {
      const model = scriptedModel([callTool("highlight", "c1", { field: "phone" }), saying("Хорошо, не буду")]);
      const { service, chat, approvalId } = await askHighlight(model);
      await service.answerApproval("anna", chat.id, approvalId!, "deny", { tabId: "tab-1" });
      const stream = await service.subscribe("anna", chat.id);
      const chunks = stream ? await readAll(stream) : [];
      expect(chunks.some((chunk) => chunk.type === "data-browser-call")).toBe(false);
    });
  });

  describe("набор инструментов", () => {
    it("браузерные инструменты — среди прочих, по имени; модель видит описание и схему", async () => {
      const model = scriptedModel();
      const { service } = build(model, {
        agent: {
          instructions: "Ты помощник.",
          tools: { zeta: tool({ description: "z", inputSchema: z.object({}), execute: async () => "z" }), alpha: tool({ description: "a", inputSchema: z.object({}), execute: async () => "a" }) },
          browserTools: { open_task: openTask, highlight },
        },
      });
      const chat = await service.createChat("anna");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
      const names = (model.doStreamCalls[0]!.tools ?? []).map((entry) => entry.name);
      expect(names).toEqual(["alpha", "highlight", "open_task", "zeta"]);
      expect(JSON.stringify(model.doStreamCalls[0]!.tools)).toContain("Открыть задачу на экране");
    });

    it("описание с execute, повтор имени с инструментом приложения или памяти, срок меньше 1 с — ошибка при создании службы", () => {
      const model = scriptedModel();
      const withExecute = tool({ description: "x", inputSchema: z.object({}), execute: async () => "x" });
      expect(() => build(model, { agent: { instructions: "x", browserTools: { open_task: withExecute } } })).toThrow(/open_task/);
      expect(() =>
        build(model, { agent: { instructions: "x", tools: { open_task: withExecute }, browserTools: { open_task: openTask } } }),
      ).toThrow(/open_task/);
      const memory = { instructions: "Память.", toolNames: ["open_task"], tools: () => ({}), snapshot: async () => null } as unknown as LongTermMemory;
      expect(() => build(model, { memory, agent: { instructions: "x", browserTools: { open_task: openTask } } })).toThrow(/open_task/);
      expect(() => build(model, { agent: { instructions: "x", browserTools: { open_task: openTask }, browserToolTimeoutMs: 500 } })).toThrow(/browserToolTimeoutMs/);
      // Больше 2³¹−1 мс таймер сработал бы сразу.
      expect(() => build(model, { agent: { instructions: "x", browserTools: { open_task: openTask }, browserToolTimeoutMs: 2 ** 31 } })).toThrow(/browserToolTimeoutMs/);
    });

    it("повтор имени с инструментом из функции — ход кончается ошибкой, запись в журнал", async () => {
      const model = scriptedModel();
      const { service, logError } = build(model, {
        agent: {
          instructions: "x",
          tools: () => ({ open_task: tool({ description: "x", inputSchema: z.object({}), execute: async () => "x" }) }),
          browserTools: { open_task: openTask },
        },
      });
      const chat = await service.createChat("anna");
      const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
      expect(finalStatus(chunks)).toBe("error");
      expect(logError.mock.calls.some(([message]) => String(message).includes("open_task"))).toBe(true);
    });

    it("сжатие видит те же инструменты, что и ответ (кэш): браузерные описания в запросе сводки", async () => {
      const sized = (context: number): LanguageModelV4StreamPart[] => [
        streamStart,
        ...textParts(["ответ"]),
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
        },
      ];
      const model = scriptedModel([sized(100), sized(300), sized(400)]);
      const { service } = build(model, { compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 } });
      const chat = await service.createChat("anna");
      for (const [index, text] of ["раз", "два", "три"].entries()) await readAll(await service.sendMessage("anna", chat.id, userMessage(`u${index + 1}`, text)));
      expect(await service.compactNow("anna", chat.id)).toBe("compacted");
      const names = (model.doGenerateCalls[0]!.tools ?? []).map((entry) => entry.name);
      expect(names).toEqual(["highlight", "open_task"]);
    });
  });
});
