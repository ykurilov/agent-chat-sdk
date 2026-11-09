import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { GREETING_LEAD } from "../../src/agent-run/greeting-lead";
import { newStoredMessage } from "../../src/conversation/types";
import type { StoredMessage } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { controlledModel, mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf, streamStart, textParts } from "./support/mock-model";

const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

function setup(extra: Partial<ChatServiceOptions> & { model?: ReturnType<typeof mockModel> } = {}) {
  const { model: given, ...rest } = extra;
  const model = given ?? mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
  const storage = rest.storage ?? createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    logError: vi.fn(),
    ...rest,
  });
  const events: ChatEvent[] = [];
  service.subscribeEvents((event) => events.push(event));
  return { service, storage, model, events };
}

const promptTexts = (prompt: unknown) =>
  (prompt as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>)
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      texts: typeof message.content === "string" ? [message.content] : message.content.filter((part) => part.type === "text").map((part) => part.text),
    }));

/** Чат с приветствием, записанный версией SDK до метки: приветствие с обычным случайным id. */
async function legacyGreetingChat(storage: ChatStorage, chatId: string, text: string, extra: Partial<StoredMessage> = {}) {
  const createdAt = "2026-01-01T10:00:00.000Z";
  const greeting = newStoredMessage({ id: crypto.randomUUID(), chatId, role: "assistant", parts: [{ type: "text", text }], createdAt, ...extra });
  await storage.importChat!({ id: chatId, ownerId: "anna", modelId: mockModelId, providerId: "mock", createdAt, updatedAt: createdAt, subjectKey: `lesson:${chatId}` }, [greeting]);
  return greeting;
}

describe("служба чата: замена приветствия (replaceGreeting)", () => {
  it("меняет только текст приветствия: id, даты и вся переписка после него прежние; вкладка получает greeting-replaced", async () => {
    const { service, storage, events } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Старое приветствие" } });
    await readAll(await service.sendMessage("anna", chat.id, user("u1", "Привет")));
    const before = await storage.listMessages(chat.id);
    const chatBefore = await storage.getChat(chat.id);
    events.length = 0;

    const result = await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое приветствие" });

    expect(result).toEqual({ status: "replaced", chatId: chat.id, messageId: before[0]!.id, previousText: "Старое приветствие", recognizedBy: "marker", compacted: false });
    const after = await storage.listMessages(chat.id);
    expect(after[0]).toEqual({ ...before[0], parts: [{ type: "text", text: "Новое приветствие" }] });
    expect(after.slice(1)).toEqual(before.slice(1));
    expect((await storage.getChat(chat.id))?.updatedAt).toBe(chatBefore!.updatedAt);
    expect(events).toEqual([{ type: "greeting-replaced", ownerId: "anna", chatId: chat.id, messageId: before[0]!.id }]);
    const history = await service.getHistory("anna", chat.id);
    expect(history.messages[0]?.parts).toEqual([{ type: "text", text: "Новое приветствие" }]);
  });

  it("следующий ход модели видит новый текст приветствия", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna", { greeting: { text: "Старое" } });
    await readAll(await service.sendMessage("anna", chat.id, user("u1", "Привет")));
    await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое" });
    await readAll(await service.sendMessage("anna", chat.id, user("u2", "Дальше")));
    const sent = promptTexts(model.doStreamCalls[1]!.prompt);
    expect(sent[0]).toEqual({ role: "user", texts: [GREETING_LEAD] });
    expect(sent[1]).toEqual({ role: "assistant", texts: ["Новое"] });
  });

  it("тот же текст — unchanged, без записи и события", async () => {
    const base = createInMemoryChatStorage();
    const replace = vi.fn(base.replaceFinishedMessageParts!.bind(base));
    const { service, events } = setup({ storage: { ...base, replaceFinishedMessageParts: replace } });
    const chat = await service.createChat("anna", { greeting: { text: "Привет!" } });
    events.length = 0;
    const result = await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Привет!" });
    expect(result).toMatchObject({ status: "unchanged", chatId: chat.id, recognizedBy: "marker" });
    expect(replace).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("пробный прогон (dryRun) — would_replace с прежним текстом, без записи и события", async () => {
    const { service, storage, events } = setup();
    const chat = await service.createChat("anna", { greeting: { text: "Старое" } });
    events.length = 0;
    const result = await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое", dryRun: true });
    expect(result).toMatchObject({ status: "would_replace", chatId: chat.id, previousText: "Старое", recognizedBy: "marker" });
    expect((await storage.listMessages(chat.id))[0]?.parts).toEqual([{ type: "text", text: "Старое" }]);
    expect(events).toEqual([]);
  });

  it("старый чат без метки: приветствие узнаётся по строгим признакам (recognizedBy: signs)", async () => {
    const { service, storage } = setup();
    const greeting = await legacyGreetingChat(storage, "c-legacy", "Старое");
    const result = await service.replaceGreeting({ ownerId: "anna", chatId: "c-legacy", text: "Новое" });
    expect(result).toMatchObject({ status: "replaced", messageId: greeting.id, recognizedBy: "signs", previousText: "Старое" });
    expect((await storage.getMessage(greeting.id))?.parts).toEqual([{ type: "text", text: "Новое" }]);
  });

  it("previousText не совпал с текущим текстом — not_a_greeting (previous_text_mismatch), ничего не записано", async () => {
    const { service, storage } = setup();
    const greeting = await legacyGreetingChat(storage, "c-legacy", "Старое");
    const result = await service.replaceGreeting({ ownerId: "anna", chatId: "c-legacy", text: "Новое", previousText: "Другое" });
    expect(result).toEqual({ status: "not_a_greeting", chatId: "c-legacy", reason: "previous_text_mismatch" });
    expect((await storage.getMessage(greeting.id))?.parts).toEqual([{ type: "text", text: "Старое" }]);
  });

  it.each([
    ["ответ модели (есть modelId)", { modelId: mockModelId, providerId: "mock" }],
    ["есть расход", { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }],
    ["дата не совпадает с датой чата", { createdAt: "2026-01-01T10:00:01.000Z" }],
    ["не только текст", { parts: [{ type: "text" as const, text: "Старое" }, { type: "reasoning" as const, text: "думал" }] }],
    ["ответ не закончен", { status: "interrupted" as const }],
  ])("первое сообщение без метки и не по всем признакам (%s) — not_a_greeting, ничего не записано", async (_label, extra) => {
    const { service, storage } = setup();
    const message = await legacyGreetingChat(storage, "c-legacy", "Старое", extra as Partial<StoredMessage>);
    const result = await service.replaceGreeting({ ownerId: "anna", chatId: "c-legacy", text: "Новое" });
    expect(result).toEqual({ status: "not_a_greeting", chatId: "c-legacy", reason: "first_message_not_greeting" });
    expect((await storage.getMessage(message.id))?.parts).toEqual(message.parts);
  });

  it("чат без приветствия (первым пишет человек) и пустой чат — not_a_greeting", async () => {
    const { service } = setup();
    const plain = await service.createChat("anna");
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: plain.id, text: "Новое" })).toEqual({ status: "not_a_greeting", chatId: plain.id, reason: "empty_chat" });
    await readAll(await service.sendMessage("anna", plain.id, user("u1", "Привет")));
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: plain.id, text: "Новое" })).toEqual({ status: "not_a_greeting", chatId: plain.id, reason: "first_message_not_greeting" });
  });

  it("чата нет или он чужой — chat_not_found", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna", { greeting: { text: "Привет!" } });
    expect(await service.replaceGreeting({ ownerId: "boris", chatId: chat.id, text: "Новое" })).toEqual({ status: "chat_not_found", chatId: chat.id });
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: "missing", text: "Новое" })).toEqual({ status: "chat_not_found", chatId: "missing" });
  });

  it("идёт ход модели — busy, ничего не записано; после хода замена проходит", async () => {
    const controlled = controlledModel();
    const { service, storage } = setup({ model: controlled.model });
    const chat = await service.createChat("anna", { greeting: { text: "Старое" } });
    const stream = await service.sendMessage("anna", chat.id, user("u1", "Привет"));
    await controlled.opened;
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое" })).toEqual({ status: "busy", chatId: chat.id });
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое", dryRun: true })).toEqual({ status: "busy", chatId: chat.id });
    expect((await storage.listMessages(chat.id))[0]?.parts).toEqual([{ type: "text", text: "Старое" }]);
    controlled.push(streamStart, ...textParts(["ок"]));
    controlled.end();
    await readAll(stream);
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое" })).toMatchObject({ status: "replaced" });
  });

  it("приветствие сжато в сводку — compacted: true (модель видит сводку, а не новый текст)", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna", { greeting: { text: "Старое" } });
    await readAll(await service.sendMessage("anna", chat.id, user("u1", "Привет")));
    await readAll(await service.sendMessage("anna", chat.id, user("u2", "Дальше")));
    // Сводка активна, пока после её границы есть хвост: сжато всё до первого ответа включительно.
    const [greeting, , answer] = await storage.listMessages(chat.id);
    await storage.insertCompaction({
      id: crypto.randomUUID(),
      chatId: chat.id,
      fromMessageId: greeting!.id,
      throughMessageId: answer!.id,
      summary: "Сводка",
      summaryTokens: 1,
      modelId: mockModelId,
      providerId: "mock",
      usage: null,
      createdAt: new Date().toISOString(),
    });
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое", dryRun: true })).toMatchObject({ status: "would_replace", compacted: true });
    expect(await service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое" })).toMatchObject({ status: "replaced", compacted: true });
  });

  it("текст проверяется как приветствие: пустой или длиннее 10 000 знаков — TypeError до чтения", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna", { greeting: { text: "Привет!" } });
    await expect(service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "" })).rejects.toThrow(TypeError);
    await expect(service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "а".repeat(10_001) })).rejects.toThrow(TypeError);
  });

  it("хранилище без replaceFinishedMessageParts — понятная ошибка", async () => {
    const { replaceFinishedMessageParts: _missing, ...base } = createInMemoryChatStorage();
    const { service } = setup({ storage: base });
    const chat = await service.createChat("anna", { greeting: { text: "Привет!" } });
    await expect(service.replaceGreeting({ ownerId: "anna", chatId: chat.id, text: "Новое" })).rejects.toThrow(/replaceFinishedMessageParts/);
  });
});
