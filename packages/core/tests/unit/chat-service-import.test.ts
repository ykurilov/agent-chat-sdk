import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import type { MessageAttachments } from "../../src/attachments/message-attachments";
import { ChatClosedError } from "../../src/access/chat-closure";
import { AttachmentRejectedError } from "../../src/attachments/message-attachments";
import { ChatAlreadyExistsError, DuplicateChatSubjectError } from "../../src/storage/chat-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { IMPORT_MAX_IMAGE_BYTES, IMPORT_MAX_IMAGES } from "../../src/subject-chats/subject-chats";
import { mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf } from "./support/mock-model";

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

function fakeAttachments() {
  let counter = 0;
  const attachments: MessageAttachments = {
    acceptUserParts: vi.fn(async () => []),
    confirmUserParts: vi.fn(async () => {}),
    prepareHistory: vi.fn(async ({ history }) => [...history]),
    importFile: vi.fn(async ({ mediaType, filename }) => ({ type: "file" as const, url: `attachment:file-${++counter}`, mediaType, filename })),
    discardImportedFiles: vi.fn(async () => {}),
  };
  return attachments;
}

const text = (value: string) => ({ type: "text" as const, text: value });

describe("служба чата: импорт", () => {
  it("переносит переписку как есть: даты, порядок, первое сообщение от агента, цепочка родителей", async () => {
    const { service, storage, model } = setup();
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat: { title: "Старый разговор", subjectKey: "lesson:7", subjectData: { lesson: 7 } },
      messages: [
        { role: "assistant", createdAt: "2025-01-01T10:00:00.000Z", parts: [text("Здравствуйте!")] },
        { id: "q1", role: "user", createdAt: "2025-01-01T10:01:00.000Z", parts: [text("Привет")] },
        { role: "assistant", createdAt: "2025-01-01T10:01:00.000Z", parts: [text("Чем помочь?")] },
      ],
    });

    const chat = await storage.getChat(chatId);
    expect(chat).toMatchObject({
      ownerId: "anna",
      title: "Старый разговор",
      subjectKey: "lesson:7",
      subjectData: { lesson: 7 },
      modelId: mockModelId,
      providerId: "mock",
      createdAt: "2025-01-01T10:00:00.000Z",
      updatedAt: "2025-01-01T10:01:00.000Z",
    });
    const messages = await storage.listMessages(chatId);
    expect(messages.map((message) => [message.role, message.createdAt, message.status, message.usage, message.modelId])).toEqual([
      ["assistant", "2025-01-01T10:00:00.000Z", "complete", null, null],
      ["user", "2025-01-01T10:01:00.000Z", "complete", null, null],
      ["assistant", "2025-01-01T10:01:00.000Z", "complete", null, null],
    ]);
    expect(messages[0]!.parentId).toBeNull();
    expect(messages[1]!).toMatchObject({ id: "q1", parentId: messages[0]!.id });
    expect(messages[2]!.parentId).toBe("q1");
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
  });

  it("дата чата — из chat.createdAt; без названия — из первого сообщения человека; модель — заданная", async () => {
    const { service, storage } = setup();
    const id = crypto.randomUUID();
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat: { id, createdAt: "2024-12-31T00:00:00.000Z", model: { modelId: mockModelId, providerId: "mock-backup" } },
      messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [text("Расскажи  про\nГрецию")] }],
    });
    expect(chatId).toBe(id);
    expect(await storage.getChat(id)).toMatchObject({ createdAt: "2024-12-31T00:00:00.000Z", title: "Расскажи про Грецию", providerId: "mock-backup" });
  });

  it("без лимитов, памяти и хода: лимиты не спрашиваются", async () => {
    const limits = { assertWithinLimit: vi.fn(async () => {}), status: vi.fn() } as unknown as SpendingLimits;
    const { service } = setup({ limits });
    await service.importChat({ ownerId: "anna", chat: {}, messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [text("Привет")] }] });
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
  });

  it("повтор id чата — ChatAlreadyExistsError, файлы не загружаются", async () => {
    const attachments = fakeAttachments();
    const { service } = setup({ attachments });
    const id = crypto.randomUUID();
    const messages = [{ role: "user" as const, createdAt: "2025-01-01T00:00:00.000Z", parts: [{ type: "image" as const, bytes: new Uint8Array([1]), mediaType: "image/png" }] }];
    await service.importChat({ ownerId: "anna", chat: { id }, messages });
    await expect(service.importChat({ ownerId: "anna", chat: { id }, messages })).rejects.toBeInstanceOf(ChatAlreadyExistsError);
    expect(attachments.importFile).toHaveBeenCalledTimes(1);
  });

  it("неверные данные — ошибка до записи", async () => {
    const { service, storage } = setup();
    const at = "2025-01-01T00:00:00.000Z";
    const bad = [
      [],
      [{ role: "system", createdAt: at, parts: [text("x")] }],
      [{ role: "user", createdAt: "вчера", parts: [text("x")] }],
      [{ role: "user", createdAt: at, parts: [] }],
      [{ role: "user", createdAt: at, parts: [text("")] }],
      [
        { role: "user", createdAt: "2025-01-02T00:00:00.000Z", parts: [text("x")] },
        { role: "assistant", createdAt: at, parts: [text("y")] },
      ],
      Array.from({ length: 5001 }, () => ({ role: "user", createdAt: at, parts: [text("x")] })),
    ];
    for (const messages of bad) {
      await expect(service.importChat({ ownerId: "anna", chat: {}, messages: messages as never })).rejects.toThrow(TypeError);
    }
    await expect(service.importChat({ ownerId: "anna", chat: { id: "не-uuid" }, messages: [{ role: "user", createdAt: at, parts: [text("x")] }] })).rejects.toThrow(TypeError);
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
  });

  it("картинки: файлы через importFile, сразу прикреплены; часть file в сообщении", async () => {
    const attachments = fakeAttachments();
    const { service, storage } = setup({ attachments });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat: {},
      messages: [
        { role: "assistant", createdAt: "2025-01-01T00:00:00.000Z", parts: [text("Вот схема"), { type: "image", bytes, mediaType: "image/png", filename: "схема.png" }] },
      ],
    });
    expect(attachments.importFile).toHaveBeenCalledWith({ ownerId: "anna", chatId, bytes, mediaType: "image/png", filename: "схема.png" });
    const [message] = await storage.listMessages(chatId);
    // Картинка ответа агента при импорте — чужой текст: служебная пометка для выключателя живых демонстраций (043).
    expect(message!.parts).toEqual([
      text("Вот схема"),
      { type: "file", url: "attachment:file-1", mediaType: "image/png", filename: "схема.png" },
      { type: "data-app-state", data: { set: { $externalContent: true } } },
    ]);
  });

  it("картинка типа, который приложение не принимает, — текстовая пометка вместо картинки, импорт не падает", async () => {
    const attachments = fakeAttachments();
    vi.mocked(attachments.importFile!).mockImplementation(async ({ mediaType, filename }) => {
      if (mediaType === "image/gif") throw new AttachmentRejectedError("unsupported_type", "Такой файл прикрепить нельзя");
      return { type: "file", url: "attachment:file-ok", mediaType, filename };
    });
    const { service, storage } = setup({ attachments });
    const image = (mediaType: string, filename?: string) => ({ type: "image" as const, bytes: new Uint8Array([1]), mediaType, ...(filename && { filename }) });
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat: {},
      messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [image("image/gif", "кот.gif"), image("image/gif"), image("image/png", "ok.png")] }],
    });
    const [message] = await storage.listMessages(chatId);
    expect(message!.parts).toEqual([text("[картинка: кот.gif]"), text("[картинка]"), { type: "file", url: "attachment:file-ok", mediaType: "image/png", filename: "ok.png" }]);
  });

  it("другие отказы вложений по-прежнему прерывают импорт", async () => {
    const attachments = fakeAttachments();
    vi.mocked(attachments.importFile!).mockRejectedValue(new AttachmentRejectedError("unreadable", "Битая картинка"));
    const { service } = setup({ attachments });
    await expect(
      service.importChat({
        ownerId: "anna",
        chat: {},
        messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [{ type: "image", bytes: new Uint8Array([1]), mediaType: "image/png" }] }],
      }),
    ).rejects.toMatchObject({ kind: "unreadable" });
  });

  it("картинка без вложений в приложении — понятная ошибка до записи", async () => {
    const { service, storage } = setup();
    await expect(
      service.importChat({
        ownerId: "anna",
        chat: {},
        messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [{ type: "image", bytes: new Uint8Array([1]), mediaType: "image/png" }] }],
      }),
    ).rejects.toThrow(/attachments/);
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
  });

  it("запись не удалась — загруженные файлы убираются", async () => {
    const attachments = fakeAttachments();
    const base = createInMemoryChatStorage();
    const storage: ChatStorage = { ...base, importChat: async () => { throw new Error("база упала"); } };
    const { service } = setup({ attachments, storage });
    await expect(
      service.importChat({
        ownerId: "anna",
        chat: {},
        messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [{ type: "image", bytes: new Uint8Array([1]), mediaType: "image/png" }] }],
      }),
    ).rejects.toThrow("база упала");
    expect(attachments.discardImportedFiles).toHaveBeenCalledWith([{ type: "file", url: "attachment:file-1", mediaType: "image/png", filename: undefined }]);
  });

  it("даты — только ISO 8601 с поясом; дата чата не позже первого сообщения", async () => {
    const { service, storage } = setup();
    const only = (createdAt: string) => [{ role: "user" as const, createdAt, parts: [text("x")] }];
    for (const createdAt of ["2025-01-01", "2025-01-01T10:00:00", "Jan 1 2025 10:00 GMT", "1735725600000", "2025-13-01T00:00:00Z"]) {
      await expect(service.importChat({ ownerId: "anna", chat: {}, messages: only(createdAt) })).rejects.toThrow(TypeError);
    }
    await expect(service.importChat({ ownerId: "anna", chat: { createdAt: "2025-01-01" }, messages: only("2025-01-01T10:00:00Z") })).rejects.toThrow(TypeError);
    await expect(
      service.importChat({ ownerId: "anna", chat: { createdAt: "2025-01-02T00:00:00Z" }, messages: only("2025-01-01T10:00:00Z") }),
    ).rejects.toThrow(TypeError);
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);

    const { chatId } = await service.importChat({ ownerId: "anna", chat: { createdAt: "2025-01-01T12:00:00+03:00" }, messages: only("2025-01-01T09:00:00.5Z") });
    expect(await storage.getChat(chatId)).toMatchObject({ createdAt: "2025-01-01T09:00:00.000Z" });
  });

  it("ключ объекта уже занят — DuplicateChatSubjectError до загрузки файлов", async () => {
    const attachments = fakeAttachments();
    const { service } = setup({ attachments });
    await service.openSubjectChat({ ownerId: "anna", key: "lesson:1" });
    const messages = [{ role: "user" as const, createdAt: "2025-01-01T00:00:00Z", parts: [{ type: "image" as const, bytes: new Uint8Array([1]), mediaType: "image/png" }] }];
    await expect(service.importChat({ ownerId: "anna", chat: { subjectKey: "lesson:1" }, messages })).rejects.toBeInstanceOf(DuplicateChatSubjectError);
    expect(attachments.importFile).not.toHaveBeenCalled();
  });

  it("картинок больше предела по числу или общему размеру — ошибка до загрузки", async () => {
    const attachments = fakeAttachments();
    const { service } = setup({ attachments });
    const image = (bytes: Uint8Array) => ({ type: "image" as const, bytes, mediaType: "image/png" });
    const tooMany = [{ role: "user" as const, createdAt: "2025-01-01T00:00:00Z", parts: Array.from({ length: IMPORT_MAX_IMAGES + 1 }, () => image(new Uint8Array([1]))) }];
    await expect(service.importChat({ ownerId: "anna", chat: {}, messages: tooMany })).rejects.toThrow(TypeError);
    // Один буфер на все части: предел считается по сумме размеров частей.
    const chunk = new Uint8Array(Math.ceil(IMPORT_MAX_IMAGE_BYTES / 4) + 1);
    const tooBig = [{ role: "user" as const, createdAt: "2025-01-01T00:00:00Z", parts: Array.from({ length: 4 }, () => image(chunk)) }];
    await expect(service.importChat({ ownerId: "anna", chat: {}, messages: tooBig })).rejects.toThrow(TypeError);
    expect(attachments.importFile).not.toHaveBeenCalled();
  });

  it("importFile упал на середине — уже загруженные файлы убираются, чата нет", async () => {
    const attachments = fakeAttachments();
    const upload = attachments.importFile!;
    let calls = 0;
    attachments.importFile = vi.fn(async (input) => {
      if (++calls === 2) throw new Error("диск полон");
      return upload(input);
    });
    const { service, storage } = setup({ attachments });
    const image = { type: "image" as const, bytes: new Uint8Array([1]), mediaType: "image/png" };
    await expect(
      service.importChat({ ownerId: "anna", chat: {}, messages: [{ role: "user", createdAt: "2025-01-01T00:00:00Z", parts: [image, image, image] }] }),
    ).rejects.toThrow("диск полон");
    expect(attachments.discardImportedFiles).toHaveBeenCalledWith([expect.objectContaining({ url: "attachment:file-1" })]);
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
  });

  it("в импортированном чате идёт обычный ход и «переделать» ответ", async () => {
    const { service, model, storage } = setup();
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat: {},
      messages: [
        { id: "q1", role: "user", createdAt: "2025-01-01T10:00:00Z", parts: [text("Привет")] },
        { id: "a1", role: "assistant", createdAt: "2025-01-01T10:01:00Z", parts: [text("Здравствуйте!")] },
      ],
    });
    await readAll(await service.sendMessage("anna", chatId, { id: "q2", role: "user", parts: [text("Как дела?")] }));
    const afterTurn = await storage.listMessages(chatId);
    expect(afterTurn.map((message) => [message.role, message.parentId])).toEqual([
      ["user", null],
      ["assistant", "q1"],
      ["user", "a1"],
      ["assistant", "q2"],
    ]);
    const answer = afterTurn[3]!;
    expect(answer.status).toBe("complete");

    await readAll(await service.regenerate("anna", chatId, answer.id));
    const history = await service.getHistory("anna", chatId);
    expect(history.messages.map((message) => message.id).slice(0, 3)).toEqual(["q1", "a1", "q2"]);
    expect(history.messages.at(-1)).toMatchObject({ role: "assistant" });
    expect(history.messages.at(-1)!.id).not.toBe(answer.id);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("хранилище без importChat — понятная ошибка", async () => {
    const { importChat: _import, ...withoutImport } = createInMemoryChatStorage();
    const { service } = setup({ storage: withoutImport });
    await expect(
      service.importChat({ ownerId: "anna", chat: {}, messages: [{ role: "user", createdAt: "2025-01-01T00:00:00.000Z", parts: [text("x")] }] }),
    ).rejects.toThrow(/importChat/);
  });
});

describe("служба чата: импорт состояния и закрытия", () => {
  const conversation = [
    { id: "q1", role: "user" as const, createdAt: "2025-01-01T10:00:00.000Z", parts: [text("Хочу записаться")] },
    { id: "a1", role: "assistant" as const, createdAt: "2025-01-01T10:01:00.000Z", parts: [text("Записал. Заявка отправлена.")] },
  ];
  const CLOSURE = { code: "form_completed", message: "Заявка отправлена." };

  it("chat.state сразу видно в getChatState; история без служебной записи", async () => {
    const { service } = setup();
    const state = { fields: { email: "a@b.ru", phone: "+7 900" }, step: 3 };
    const { chatId } = await service.importChat({ ownerId: "anna", chat: { state }, messages: conversation });
    const { values } = await service.getChatState("anna", chatId);
    expect(values).toEqual(state);
    const history = await service.getHistory("anna", chatId);
    expect(history.messages.map((message) => message.id)).toEqual(["q1", "a1"]);
    expect(history.chat.closed).toBeUndefined();
  });

  it("chat.closed: чат закрыт сразу — история, список и отправка", async () => {
    const { service, storage } = setup();
    const { chatId } = await service.importChat({ ownerId: "anna", chat: { closed: CLOSURE, state: { step: 3 } }, messages: conversation });
    expect((await service.getHistory("anna", chatId)).chat.closed).toEqual(CLOSURE);
    expect((await storage.getChat(chatId))?.closed).toEqual(CLOSURE);
    // Браузер получает состояние частью последнего сообщения, служебный ключ закрытия — нет.
    const history = await service.getHistory("anna", chatId);
    expect(history.messages.at(-1)?.parts.map((part) => part.type)).toEqual(["text"]);
    expect(JSON.stringify(history.messages)).not.toContain("$closed");
    expect((await service.getChatState("anna", chatId)).values).toEqual({ step: 3 });
    await expect(service.sendMessage("anna", chatId, { id: "q2", role: "user", parts: [text("Ещё")] })).rejects.toBeInstanceOf(ChatClosedError);
  });

  it("состояние видят все ветки от перенесённой истории: «Переделать» последнего ответа и правка вопроса", async () => {
    const { service } = setup();
    const state = { step: 3 };
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat: { state },
      messages: [
        { id: "q0", role: "user" as const, createdAt: "2025-01-01T09:59:00.000Z", parts: [text("Здравствуйте")] },
        { id: "a0", role: "assistant" as const, createdAt: "2025-01-01T09:59:30.000Z", parts: [text("Слушаю")] },
        ...conversation,
      ],
    });
    // Экран получает начальное состояние в начале первого сообщения истории.
    expect((await service.getHistory("anna", chatId)).messages[0]?.parts.map((part) => part.type)).toEqual(["data-app-state", "text"]);
    await readAll(await service.regenerate("anna", chatId, "a1"));
    expect((await service.getChatState("anna", chatId)).values).toEqual(state);
    await readAll(await service.editMessage("anna", chatId, "q1", { id: "q1b", role: "user", parts: [text("Записаться на завтра")] }));
    expect((await service.getChatState("anna", chatId)).values).toEqual(state);
    // Правка самого первого перенесённого сообщения — тоже.
    await readAll(await service.editMessage("anna", chatId, "q0", { id: "q0b", role: "user", parts: [text("Добрый день")] }));
    expect((await service.getChatState("anna", chatId)).values).toEqual(state);
    const history = await service.getHistory("anna", chatId);
    expect(history.messages[0]?.id).toBe("q0b");
    expect(history.messages[0]?.parts.map((part) => part.type)).toEqual(["data-app-state", "text"]);
  });

  it("служебное сообщение с начальным состоянием: клиенту не показано, модели не уходит пустым ходом", async () => {
    const { service, model } = setup();
    const { chatId } = await service.importChat({ ownerId: "anna", chat: { state: { step: 3 } }, messages: conversation });
    expect((await service.getHistory("anna", chatId)).messages.map((message) => message.id)).toEqual(["q1", "a1"]);
    await readAll(await service.sendMessage("anna", chatId, { id: "q2", role: "user", parts: [text("Ещё вопрос")] }));
    const prompt = model.doStreamCalls[0]!.prompt.filter((message) => message.role !== "system");
    expect(prompt.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(prompt)).not.toContain("step");
  });

  it("«Переделать» первого перенесённого ответа агента нельзя: перед ним только служебное сообщение", async () => {
    const { service } = setup();
    const { chatId } = await service.importChat({
      ownerId: "anna",
      chat: { state: { step: 1 } },
      messages: [{ id: "hello", role: "assistant", createdAt: "2025-01-01T10:00:00.000Z", parts: [text("Здравствуйте!")] }],
    });
    await expect(service.regenerate("anna", chatId, "hello")).rejects.toThrow(/Переделать можно/);
  });

  it("правка вопроса в закрытом импортированном чате открывает новую ветку", async () => {
    const { service } = setup();
    const { chatId } = await service.importChat({ ownerId: "anna", chat: { closed: CLOSURE }, messages: conversation });
    await readAll(await service.editMessage("anna", chatId, "q1", { id: "q1b", role: "user", parts: [text("Другое")] }));
    expect((await service.getHistory("anna", chatId)).chat.closed).toBeUndefined();
  });

  it("неверные state и closed — ошибка до записи", async () => {
    const { service, storage } = setup();
    const bad = [
      { state: [] as never },
      { state: { $closed: CLOSURE } },
      { state: { when: new Date() } },
      { state: { big: "x".repeat(300 * 1024) } },
      { closed: { code: "Не код", message: "x" } },
    ];
    for (const chat of bad) {
      await expect(service.importChat({ ownerId: "anna", chat, messages: conversation })).rejects.toThrow(/state|closed|состояни|Код/i);
    }
    expect(await storage.listChats("anna")).toEqual([]);
  });
});
