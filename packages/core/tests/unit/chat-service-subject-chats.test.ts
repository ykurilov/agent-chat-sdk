import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { GREETING_LEAD } from "../../src/agent-run/greeting-lead";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { DuplicateChatSubjectError } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { AGENT_NOTICE_PART_TYPE } from "../../src/notices/agent-notice";
import { waitTurn } from "./support/notice-chat";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf } from "./support/mock-model";

const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

function setup(extra: Partial<ChatServiceOptions> = {}) {
  const model = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
  const storage = extra.storage ?? createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    logError: vi.fn(),
    ...extra,
  });
  return { service, storage, model };
}

const promptTexts = (prompt: unknown) =>
  (prompt as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>).map((message) => ({
    role: message.role,
    texts: typeof message.content === "string" ? [message.content] : message.content.filter((part) => part.type === "text").map((part) => part.text),
  }));

describe("служба чата: чат объекта", () => {
  it("первый вызов создаёт чат с ключом, данными и названием; второй находит тот же", async () => {
    const { service } = setup();
    const first = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", data: { lessonId: 1 }, title: "Урок 1" });
    expect(first.created).toBe(true);
    expect(first.chat).toMatchObject({ ownerId: "anna", subjectKey: "lesson:1", subjectData: { lessonId: 1 }, title: "Урок 1" });

    const again = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", data: { lessonId: 2 } });
    expect(again.created).toBe(false);
    expect(again.chat.id).toBe(first.chat.id);
    // Данные пишутся только при создании.
    expect(again.chat.subjectData).toEqual({ lessonId: 1 });
  });

  it("у разных владельцев один ключ — разные чаты", async () => {
    const { service } = setup();
    const anna = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1" });
    const boris = await service.openSubjectChat({ ownerId: "boris", key: "lesson:1" });
    expect(anna.chat.id).not.toBe(boris.chat.id);
  });

  it("гонка: чат успел создать соседний вызов — проигравший видит его с приветствием", async () => {
    const base = createInMemoryChatStorage();
    let raced = false;
    const storage: ChatStorage = {
      ...base,
      // Первый поиск не видит чат, запись падает на повторе ключа: соседний вызов успел раньше.
      findChatBySubject: async (ownerId, key) => (raced ? base.findChatBySubject!(ownerId, key) : null),
      importChat: async (chat, messages) => {
        if (!raced) {
          raced = true;
          await base.importChat!({ ...chat, id: "winner" }, messages.map((message) => ({ ...message, id: "winner-greeting", chatId: "winner" })));
          throw new DuplicateChatSubjectError(chat.ownerId, chat.subjectKey!);
        }
        return base.importChat!(chat, messages);
      },
    };
    const { service } = setup({ storage });
    const opened = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Привет!" } });
    expect(opened).toMatchObject({ created: false, chat: { id: "winner" } });
    expect((await base.listMessages("winner")).map((message) => message.parts)).toEqual([[{ type: "text", text: "Привет!" }]]);
    expect(await base.listChats("anna", { subjects: "include" })).toHaveLength(1);
  });

  it("чат с приветствием пишется одной записью хранилища (importChat), а не двумя", async () => {
    const base = createInMemoryChatStorage();
    const storage: ChatStorage = { ...base, createChat: vi.fn(base.createChat), insertMessage: vi.fn(base.insertMessage), importChat: vi.fn(base.importChat!) };
    const { service } = setup({ storage });
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", data: { a: 1 }, title: "Урок", greeting: { text: "Привет!" } });
    expect(storage.createChat).not.toHaveBeenCalled();
    expect(storage.insertMessage).not.toHaveBeenCalled();
    expect(storage.importChat).toHaveBeenCalledTimes(1);
    expect(chat).toMatchObject({ subjectKey: "lesson:1", subjectData: { a: 1 }, title: "Урок" });
    expect(await base.listMessages(chat.id)).toHaveLength(1);
  });

  it("хранилище без importChat — приветствие отдельной записью, как раньше", async () => {
    const { importChat: _import, ...withoutImport } = createInMemoryChatStorage();
    const { service } = setup({ storage: withoutImport });
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Привет!" } });
    expect((await withoutImport.listMessages(chat.id)).map((message) => message.role)).toEqual(["assistant"]);
  });

  it("одновременные вызовы дают один чат и одно приветствие", async () => {
    const { service, storage } = setup();
    const opened = await Promise.all(
      Array.from({ length: 5 }, () => service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Привет!" } })),
    );
    expect(new Set(opened.map((item) => item.chat.id)).size).toBe(1);
    expect(opened.filter((item) => item.created)).toHaveLength(1);
    expect(await storage.listMessages(opened[0]!.chat.id)).toHaveLength(1);
  });

  it("неверный ключ или данные — ошибка до записи", async () => {
    const { service, storage } = setup();
    await expect(service.openSubjectChat({ ownerId: "anna", key: "" })).rejects.toThrow(TypeError);
    await expect(service.openSubjectChat({ ownerId: "anna", key: "x".repeat(201) })).rejects.toThrow(TypeError);
    await expect(service.openSubjectChat({ ownerId: "anna", key: "k", data: [] as unknown as Record<string, unknown> })).rejects.toThrow(TypeError);
    await expect(service.openSubjectChat({ ownerId: "anna", key: "k", data: { big: "x".repeat(17_000) } })).rejects.toThrow(TypeError);
    await expect(service.openSubjectChat({ ownerId: "anna", key: "k", greeting: { text: "" } })).rejects.toThrow(TypeError);
    await expect(service.openSubjectChat({ ownerId: "anna", key: "k", greeting: { instruction: "" } })).rejects.toThrow(TypeError);
    await expect(service.openSubjectChat({ ownerId: "anna", key: "k", greeting: { text: "Привет", instruction: "Поздоровайся" } as never })).rejects.toThrow(TypeError);
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
  });

  it("хранилище без поиска по ключу — понятная ошибка при вызове", async () => {
    const { findChatBySubject: _find, ...withoutSubjects } = createInMemoryChatStorage();
    const { service } = setup({ storage: withoutSubjects });
    await expect(service.openSubjectChat({ ownerId: "anna", key: "lesson:1" })).rejects.toThrow(/findChatBySubject/);
  });

  it("история отдаёт чат без данных объекта, ключ остаётся", async () => {
    const { service } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", data: { secret: "ответ" } });
    const history = await service.getHistory("anna", chat.id);
    expect(history.chat.subjectKey).toBe("lesson:1");
    expect(history.chat).not.toHaveProperty("subjectData");
  });

  it("список по умолчанию без чатов с ключом; с subjects: include — с ними и ключом, без данных", async () => {
    const { service } = setup();
    const plain = await service.createChat("anna");
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", data: { a: 1 } });
    expect((await service.listChats("anna")).map((item) => item.id)).toEqual([plain.id]);
    const all = await service.listChats("anna", { subjects: "include" });
    expect(all.map((item) => item.id).sort()).toEqual([plain.id, chat.id].sort());
    const subjectItem = all.find((item) => item.id === chat.id)!;
    expect(subjectItem.subjectKey).toBe("lesson:1");
    expect(subjectItem).not.toHaveProperty("subjectData");
  });
});

describe("служба чата: приветствие", () => {
  it("приветствие — законченный ответ агента без модели и расхода, с датой чата; повторное открытие не дублирует", async () => {
    const { service, storage } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Здравствуйте! Начнём урок." } });
    await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Здравствуйте! Начнём урок." } });

    const stored = await storage.listMessages(chat.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      role: "assistant",
      status: "complete",
      parentId: null,
      modelId: null,
      providerId: null,
      usage: null,
      createdAt: chat.createdAt,
      parts: [{ type: "text", text: "Здравствуйте! Начнём урок." }],
    });
    expect((await storage.getChat(chat.id))?.updatedAt).toBe(chat.createdAt);
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);

    const history = await service.getHistory("anna", chat.id);
    expect(history.messages.map((message) => message.role)).toEqual(["assistant"]);
    expect(history.running).toBe(false);
  });

  it("createChat с приветствием: обычный чат, первое сообщение — приветствие", async () => {
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {}),
      status: vi.fn(async () => ({ state: "ok" as const })),
    } as unknown as SpendingLimits;
    const { service, storage } = setup({ limits });
    const chat = await service.createChat("anna", { greeting: { text: "Привет!" } });
    expect(chat.subjectKey).toBeUndefined();
    expect((await storage.listMessages(chat.id)).map((message) => message.role)).toEqual(["assistant"]);
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
  });

  it("ответ на приветствие: в запросе служебная строка перед приветствием; название — из первого сообщения человека", async () => {
    const { service, model, storage } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Привет! Готовы?" } });
    await readAll(await service.sendMessage("anna", chat.id, user("u1", "Да, начнём")));

    const sent = promptTexts(model.doStreamCalls[0]!.prompt).filter((message) => message.role !== "system");
    expect(sent[0]).toEqual({ role: "user", texts: [GREETING_LEAD] });
    expect(sent[1]).toEqual({ role: "assistant", texts: ["Привет! Готовы?"] });
    expect(sent[2]?.role).toBe("user");
    expect(sent[2]?.texts[0]).toBe("Да, начнём");
    expect((await storage.getChat(chat.id))?.title).toBe("Да, начнём");
  });

  it("новый чат с приветствием берёт запомненный выбор модели при создании", async () => {
    const storage = createInMemoryChatStorage();
    await storage.saveUserModelChoice!("anna", { modelId: mockModelId, providerId: "mock-backup" });
    const { service } = setup({ storage });
    const chat = await service.createChat("anna", { greeting: { text: "Привет!" } });
    expect(chat.providerId).toBe("mock-backup");
    const { chat: subject } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Привет!" } });
    expect(subject.providerId).toBe("mock-backup");
  });

  it("«переделать» приветствие нельзя, «повторить» без вопроса человека — тоже", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna", { greeting: { text: "Привет!" } });
    const [greeting] = (await service.getHistory("anna", chat.id)).messages;
    await expect(service.regenerate("anna", chat.id, greeting!.id)).rejects.toThrow();
    await expect(service.retry("anna", chat.id)).rejects.toThrow();
  });

  it("приветствие-указание: новый чат будит агента один раз служебным сообщением, найденный — нет", async () => {
    const { service, model } = setup();
    const { chat, created } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { instruction: "Поздоровайся и предложи начать урок." } });
    expect(created).toBe(true);
    await waitTurn(service, chat.id);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]!.parts.find((part) => part.type === AGENT_NOTICE_PART_TYPE)).toMatchObject({
      data: { notices: [{ kind: "conversation_started", title: "Поздоровайся и предложи начать урок." }] },
    });
    expect(model.doStreamCalls).toHaveLength(1);

    const again = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { instruction: "Поздоровайся и предложи начать урок." } });
    expect(again.created).toBe(false);
    await waitTurn(service, chat.id);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("createChat с приветствием-указанием будит агента", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna", { greeting: { instruction: "Поздоровайся." } });
    await waitTurn(service, chat.id);
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("побудка не удалась — ошибка в журнал, чат всё равно отдаётся", async () => {
    const base = createInMemoryChatStorage();
    const logError = vi.fn();
    // Побудка читает чат под замком — чтение падает.
    const storage: ChatStorage = { ...base, getChat: async () => Promise.reject(new Error("база недоступна")) };
    const { service } = setup({ storage, logError });
    const { chat, created } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { instruction: "Поздоровайся." } });
    expect(created).toBe(true);
    expect(chat.subjectKey).toBe("lesson:1");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });
});
