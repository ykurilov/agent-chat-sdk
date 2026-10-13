import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EXTERNAL_CONTENT_PART_TYPE, chatHasExternalContent } from "../../src/index";
import type { AgentChatMessage, ChatCapabilities } from "../../src/index";
import { newStoredMessage } from "../../src/conversation/types";
import { createExternalContentWatch } from "../../src/external-content/external-content";
import type { MessageAttachments } from "../../src/index";
import { finishPart, readAll, streamStart, textParts } from "./support/mock-model";
import { callTool, noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

/*
 * Выключатель живых демонстраций (043, ревью 2): в чате, куда попал чужой текст (веб, файл человека, инструмент с пометкой
 * `metadata: { externalContent: true }`), демонстрации не запускаются. Решает сервер: признак выводится из сохранённых
 * сообщений чата (их не удаляют ни сжатие, ни ветки, они переезжают при импорте) и идёт клиенту в истории и в потоке.
 */

const tools = {
  read_web: tool({
    description: "Читает страницу",
    inputSchema: z.object({ url: z.string() }),
    metadata: { externalContent: true },
    execute: async () => "Текст чужой страницы",
  }),
  lookup: tool({
    description: "Свой справочник",
    inputSchema: z.object({ q: z.string() }),
    execute: async () => "свои данные",
  }),
};

const answerAfterTool = (toolName: string, id: string): LanguageModelV4StreamPart[][] => [
  callTool(toolName, id, toolName === "read_web" ? { url: "https://example.com" } : { q: "x" }),
  [streamStart, ...textParts(["Вот демонстрация"]), finishPart()],
];

const chunkTypes = (chunks: UIMessageChunk[]) => chunks.map((chunk) => chunk.type);

function setup(scripts: LanguageModelV4StreamPart[][], capabilities?: Partial<ChatCapabilities>) {
  const model = scriptedModel(scripts);
  return { model, ...noticeService(model, { agent: { tools, liveDemos: true }, ...(capabilities && { chatCapabilities: () => capabilities }) }) };
}

describe("chatHasExternalContent: чужой текст в сообщениях чата", () => {
  const user = (parts: AgentChatMessage["parts"]): AgentChatMessage => ({ id: "u", role: "user", parts });
  const agent = (parts: AgentChatMessage["parts"]): AgentChatMessage => ({ id: "a", role: "assistant", parts });

  it("обычный разговор и свои инструменты — нет", () => {
    expect(chatHasExternalContent([])).toBe(false);
    expect(chatHasExternalContent([user([{ type: "text", text: "Привет" }]), agent([{ type: "text", text: "Здравствуйте" }])])).toBe(false);
    const ownCall = { type: "tool-lookup", toolCallId: "c1", state: "output-available", input: {}, output: "свои" } as AgentChatMessage["parts"][number];
    expect(chatHasExternalContent([agent([ownCall])])).toBe(false);
  });

  it("файл человека, вызов с пометкой, итог помощника с пометкой, служебное сообщение с пометкой — да", () => {
    expect(chatHasExternalContent([user([{ type: "file", url: "attachment:f1", mediaType: "application/pdf" }])])).toBe(true);
    const marked = { type: "tool-read_web", toolCallId: "c1", state: "output-available", input: {}, output: "x", toolMetadata: { externalContent: true } };
    expect(chatHasExternalContent([agent([marked as AgentChatMessage["parts"][number]])])).toBe(true);
    const dynamicMarked = { type: "dynamic-tool", toolName: "mcp_read", toolCallId: "c2", state: "input-available", input: {}, toolMetadata: { externalContent: true } };
    expect(chatHasExternalContent([agent([dynamicMarked as AgentChatMessage["parts"][number]])])).toBe(true);
    const helper = { type: "tool-helper_research", toolCallId: "c3", state: "output-available", input: {}, output: { status: "done", task: "t", steps: [], text: "итог", externalContent: true } };
    expect(chatHasExternalContent([agent([helper as AgentChatMessage["parts"][number]])])).toBe(true);
    const notice = { type: "data-agent-notice", data: { notices: [{ kind: "task_done", taskId: "t1", title: "Поиск", result: "итог", externalContent: true }] } };
    expect(chatHasExternalContent([user([notice as AgentChatMessage["parts"][number]])])).toBe(true);
  });

  it("веб-вызов из истории до 0.44 (без пометки) узнаётся по имени инструмента веб-пакета", () => {
    for (const name of ["web_search", "read_page", "page_screenshot"]) {
      const legacy = { type: `tool-${name}`, toolCallId: "c1", state: "output-available", input: {}, output: "x" };
      expect(chatHasExternalContent([agent([legacy as AgentChatMessage["parts"][number]])])).toBe(true);
    }
    const dynamicLegacy = { type: "dynamic-tool", toolName: "read_page", toolCallId: "c2", state: "output-available", input: {}, output: "x" };
    expect(chatHasExternalContent([agent([dynamicLegacy as AgentChatMessage["parts"][number]])])).toBe(true);
  });

  it("поиск у провайдера модели: источники (source-url, source-document) и вызов, выполненный провайдером, — чужой текст", () => {
    const part = (fields: Record<string, unknown>) => fields as AgentChatMessage["parts"][number];
    expect(chatHasExternalContent([agent([part({ type: "source-url", sourceId: "s1", url: "https://example.com" })])])).toBe(true);
    expect(chatHasExternalContent([agent([part({ type: "source-document", sourceId: "s2", mediaType: "text/plain", title: "Док" })])])).toBe(true);
    const provider = { type: "tool-web_fetch_provider", toolCallId: "c1", state: "output-available", input: {}, output: "x", providerExecuted: true };
    expect(chatHasExternalContent([agent([part(provider)])])).toBe(true);
  });

  it("служебная пометка импорта ($externalContent в состоянии чата) — чужой текст", () => {
    const mark = { type: "data-app-state", data: { set: { $externalContent: true } } } as AgentChatMessage["parts"][number];
    expect(chatHasExternalContent([user([mark])])).toBe(true);
  });

  it("файл в ответе агента (своя картинка) — не чужой текст", () => {
    expect(chatHasExternalContent([agent([{ type: "file", url: "image:1", mediaType: "image/png" }])])).toBe(false);
  });
});

describe("поток хода: поиск у провайдера", () => {
  it("источник или итог вызова, выполненного провайдером, — признак один раз", () => {
    const sources = createExternalContentWatch();
    expect(sources.observe({ type: "source-url", sourceId: "s1", url: "https://example.com" } as UIMessageChunk)).toBe(true);
    expect(sources.observe({ type: "source-document", sourceId: "s2", mediaType: "text/plain", title: "x" } as UIMessageChunk)).toBe(false);
    const provider = createExternalContentWatch();
    expect(provider.observe({ type: "tool-input-available", toolCallId: "p1", toolName: "web_search", input: {}, providerExecuted: true } as UIMessageChunk)).toBe(false);
    expect(provider.observe({ type: "tool-output-available", toolCallId: "p1", output: "x", providerExecuted: true } as UIMessageChunk)).toBe(true);
    const own = createExternalContentWatch();
    expect(own.observe({ type: "tool-output-available", toolCallId: "o1", output: "x" } as UIMessageChunk)).toBe(false);
  });
});

describe("служба: признак externalContent в истории и в потоке", () => {
  it("свежий чат и свои инструменты — признака нет", async () => {
    const { service } = setup(answerAfterTool("lookup", "c-own"));
    const chat = await service.createChat("anna");
    expect((await service.getHistory("anna", chat.id)).externalContent).toBeUndefined();
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Найди")));
    expect(chunkTypes(chunks)).not.toContain(EXTERNAL_CONTENT_PART_TYPE);
    expect((await service.getHistory("anna", chat.id)).externalContent).toBeUndefined();
  });

  it("инструмент с пометкой: кусок потока сразу после его итога, раньше следующего текста; в истории — externalContent: true", async () => {
    const { service } = setup(answerAfterTool("read_web", "c-web"));
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Прочитай страницу")));
    const types = chunkTypes(chunks);
    const signal = types.indexOf(EXTERNAL_CONTENT_PART_TYPE);
    expect(signal).toBeGreaterThan(types.indexOf("tool-output-available"));
    expect(signal).toBeLessThan(types.lastIndexOf("text-delta"));
    expect(chunks[signal]).toMatchObject({ type: EXTERNAL_CONTENT_PART_TYPE, data: true, transient: true });
    expect(types.filter((type) => type === EXTERNAL_CONTENT_PART_TYPE)).toHaveLength(1);
    expect((await service.getHistory("anna", chat.id)).externalContent).toBe(true);
  });

  it("признак держится: перезапуск службы, следующий ход (кусок в начале потока), другая ветка, импорт", async () => {
    const { service, storage, model } = setup(answerAfterTool("read_web", "c-web"));
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Прочитай страницу")));
    // Перезапуск сервера: новая служба на том же хранилище.
    const restarted = noticeService(model, { storage, agent: { tools, liveDemos: true } }).service;
    expect((await restarted.getHistory("anna", chat.id)).externalContent).toBe(true);
    // Следующий ход: признак идёт в самом начале, до любого текста.
    const next = chunkTypes(await readAll(await restarted.sendMessage("anna", chat.id, userMessage("u2", "Ещё"))));
    expect(next.indexOf(EXTERNAL_CONTENT_PART_TYPE)).toBeGreaterThanOrEqual(0);
    expect(next.indexOf(EXTERNAL_CONTENT_PART_TYPE)).toBeLessThan(next.indexOf("text-delta"));
    // Сжатие пересказывает историю, но сообщения остаются в хранилище.
    await restarted.compactNow("anna", chat.id);
    expect((await restarted.getHistory("anna", chat.id)).externalContent).toBe(true);
    // Человек правит первое сообщение: новая ветка без чужого текста, но чужой текст в чате остался.
    await readAll(await restarted.editMessage("anna", chat.id, "u1", { id: "u1b", role: "user", parts: [{ type: "text", text: "Просто привет" }] }));
    // Ход новой ветки: признак в начале потока — по всем веткам чата, как в истории.
    expect(chunkTypes(await readAll(await restarted.sendMessage("anna", chat.id, userMessage("u3", "Дальше"))))).toContain(EXTERNAL_CONTENT_PART_TYPE);
    const branch = await restarted.getHistory("anna", chat.id);
    expect(branch.messages.some((message) => message.parts.some((part) => part.type === "tool-read_web"))).toBe(false);
    expect(branch.externalContent).toBe(true);
    // Импорт: сообщения переезжают вместе с пометками.
    const copy = await restarted.createChat("anna");
    for (const message of await storage.listMessages(chat.id)) await storage.insertMessage({ ...message, id: `copy-${message.id}`, chatId: copy.id, parentId: message.parentId ? `copy-${message.parentId}` : null });
    expect((await restarted.getHistory("anna", copy.id)).externalContent).toBe(true);
  });

  it("файл человека: признак в начале хода и в истории", async () => {
    const model = scriptedModel([saying("Посмотрел")]);
    const { service } = noticeService(model, {
      agent: { liveDemos: true },
      attachments: {
        acceptUserParts: async ({ parts }) => parts.map((part) => ({ type: "file" as const, url: part.url, mediaType: "text/plain", filename: "письмо.txt" })),
        confirmUserParts: async () => undefined,
        // Модели файл уходит текстом: заглушка не читает ссылки `attachment:`.
        prepareHistory: async ({ history }) =>
          history.map((message) => ({ ...message, parts: message.parts.map((part) => (part.type === "file" ? { type: "text" as const, text: "текст письма" } : part)) })),
      },
    });
    const chat = await service.createChat("anna");
    const chunks = await readAll(
      await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "file", url: "attachment:f1", mediaType: "text/plain" }, { type: "text", text: "Что тут?" }] }),
    );
    const types = chunkTypes(chunks);
    expect(types.indexOf(EXTERNAL_CONTENT_PART_TYPE)).toBeGreaterThanOrEqual(0);
    expect(types.indexOf(EXTERNAL_CONTENT_PART_TYPE)).toBeLessThan(types.indexOf("text-delta"));
    expect((await service.getHistory("anna", chat.id)).externalContent).toBe(true);
  });

  it("публичный чат со скрытыми служебными вызовами: вызова не видно, признак — виден", async () => {
    const { service } = setup(answerAfterTool("read_web", "c-web"), { toolDetails: false, reasoning: false });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Прочитай страницу")));
    expect(chunks.some((chunk) => chunk.type === "tool-input-available")).toBe(false);
    expect(chunkTypes(chunks)).toContain(EXTERNAL_CONTENT_PART_TYPE);
    const history = await service.getHistory("anna", chat.id);
    expect(history.messages.flatMap((message) => message.parts).some((part) => part.type === "tool-read_web")).toBe(false);
    expect(history.externalContent).toBe(true);
  });

  it("признак не идёт модели: запрос второго хода тот же, что в чате без чужого текста", async () => {
    const requestOf = async (toolName: string) => {
      const { service, model } = setup(answerAfterTool(toolName, "c-1"));
      const chat = await service.createChat("anna");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Найди")));
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Ещё")));
      return JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    };
    const external = await requestOf("read_web");
    expect(external).not.toMatch(/externalContent|external-content/);
  });

  it("служебное сообщение о фоновой задаче с пометкой — признак в истории", async () => {
    const { service, storage } = setup([]);
    const chat = await service.createChat("anna");
    await storage.insertMessage(
      newStoredMessage({
        id: "n1",
        chatId: chat.id,
        role: "user",
        parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "task_done", taskId: "t1", title: "Поиск", result: "итог", externalContent: true }] } }] as never,
      }),
    );
    expect((await service.getHistory("anna", chat.id)).externalContent).toBe(true);
  });

  it("без живых демонстраций признака нет: ни в истории, ни в потоке", async () => {
    const model = scriptedModel(answerAfterTool("read_web", "c-web"));
    const { service } = noticeService(model, { agent: { tools } });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Прочитай страницу")));
    expect(chunkTypes(chunks)).not.toContain(EXTERNAL_CONTENT_PART_TYPE);
    expect("externalContent" in (await service.getHistory("anna", chat.id))).toBe(false);
  });
});

describe("импорт: признак чужого текста", () => {
  const attachments = (): MessageAttachments => ({
    acceptUserParts: vi.fn(async () => []),
    confirmUserParts: vi.fn(async () => {}),
    prepareHistory: vi.fn(async ({ history }) => [...history]),
    importFile: vi.fn(async ({ mediaType }) => ({ type: "file" as const, url: `attachment:${crypto.randomUUID()}`, mediaType })),
    discardImportedFiles: vi.fn(async () => {}),
  });
  const importInto = async (chat: { externalContent?: true }, parts: Array<{ type: "text"; text: string } | { type: "image"; bytes: Uint8Array; mediaType: string }>) => {
    const { service } = noticeService(scriptedModel([]), { agent: { liveDemos: true }, attachments: attachments() });
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat,
      messages: [
        { role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [{ type: "text", text: "Привет" }] },
        { role: "assistant", createdAt: "2025-01-01T00:00:01.000Z", parts },
      ],
    });
    return service.getHistory("anna", chatId);
  };

  it("обычная переписка — без признака", async () => {
    expect((await importInto({}, [{ type: "text", text: "Здравствуйте" }])).externalContent).toBeUndefined();
  });

  it("chat.externalContent: true — признак, служебная пометка экрану не видна", async () => {
    const history = await importInto({ externalContent: true }, [{ type: "text", text: "Здравствуйте" }]);
    expect(history.externalContent).toBe(true);
    expect(JSON.stringify(history.messages)).not.toContain("externalContent");
  });

  it("картинка в ответе агента при импорте — чужой текст: откуда она, служба не знает", async () => {
    expect((await importInto({}, [{ type: "image", bytes: new Uint8Array([1]), mediaType: "image/png" }])).externalContent).toBe(true);
  });
});
