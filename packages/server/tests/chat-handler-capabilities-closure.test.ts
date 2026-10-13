import { describe, expect, it, vi } from "vitest";
import type { ChatCapabilities } from "@ykurilov/agent-chat-core";
import type { ChatAttachments } from "../src/chat-handler";
import { createTestChat, message } from "./support/test-chat";

const CLOSURE = { code: "form_completed", message: "Заявка отправлена." };
const FORBIDDEN_TEXT = "Это действие в этом чате недоступно.";

const forbidden = (action: keyof ChatCapabilities) => ({ error: { kind: "action_forbidden", action, code: action, message: FORBIDDEN_TEXT } });

function fakeAttachments(): ChatAttachments {
  return {
    settings: () => Response.json({}),
    handle: vi.fn(async () => new Response(null, { status: 201 })),
    acceptUserParts: async ({ parts }) => parts.map((part) => ({ type: "file" as const, url: part.url, mediaType: "image/png", filename: "cat.png" })),
    confirmUserParts: async () => undefined,
    prepareHistory: async ({ history }) => [...history],
  };
}

describe("обработчик чата: права посетителя", () => {
  it("история отдаёт права; без chatCapabilities — все true", async () => {
    const limited = createTestChat({ chatCapabilities: () => ({ edit: false, modelChoice: false }) });
    const chatId = await limited.createChat();
    const { capabilities } = (await (await limited.call("GET", `/${chatId}`)).json()) as { capabilities: ChatCapabilities };
    expect(capabilities).toMatchObject({ edit: false, modelChoice: false, regenerate: true, retry: true });
    const open = createTestChat();
    const other = await open.createChat();
    const all = ((await (await open.call("GET", `/${other}`)).json()) as { capabilities: ChatCapabilities }).capabilities;
    expect(Object.values(all).every(Boolean)).toBe(true);
  });

  it("запрещённая правка: 403 action_forbidden с кодом и текстом, beforeTurn не зван, ничего не записано", async () => {
    const beforeTurn = vi.fn();
    const { call, createChat, storage } = createTestChat({ chatCapabilities: () => ({ edit: false }), beforeTurn });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    const before = (await storage.listMessages(chatId)).length;
    beforeTurn.mockClear();
    const response = await call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u2", "Правка") } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbidden("edit"));
    expect(beforeTurn).not.toHaveBeenCalled();
    expect((await storage.listMessages(chatId)).length).toBe(before);
  });

  it("модель, ветка, переименование, голос — каждое 403 со своим правом", async () => {
    const { call, createChat } = createTestChat({
      chatList: true,
      chatCapabilities: () => ({ modelChoice: false, branches: false, chatList: false, voice: false }),
    });
    const chatId = await createChat();
    const model = await call("PUT", `/${chatId}/model`, { body: { modelId: "x", providerId: "mock" } });
    expect(await model.json()).toEqual(forbidden("modelChoice"));
    const branch = await call("POST", `/${chatId}/branch`, { body: { messageId: "u1" } });
    expect(await branch.json()).toEqual(forbidden("branches"));
    const rename = await call("PATCH", `/${chatId}`, { body: { title: "Имя" } });
    expect(rename.status).toBe(403);
    expect(await rename.json()).toEqual(forbidden("chatList"));
    const voice = await call("POST", `/${chatId}/messages`, { body: { ...message("u1", "Привет"), voiceMode: true } });
    expect(voice.status).toBe(403);
    expect(await voice.json()).toEqual(forbidden("voice"));
  });

  it("поправка при запрете steer — 403 до записи; «Переделать» — 403 regenerate", async () => {
    const { call, createChat, storage } = createTestChat({ chatCapabilities: () => ({ steer: false, regenerate: false }) });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    const before = (await storage.listMessages(chatId)).length;
    const steer = await call("POST", `/${chatId}/steer`, { body: message("s1", "И покороче") });
    expect(steer.status).toBe(403);
    expect(await steer.json()).toEqual(forbidden("steer"));
    const answerId = (await storage.listMessages(chatId)).find((stored) => stored.role === "assistant")!.id;
    const regenerate = await call("POST", `/${chatId}/regenerate`, { body: { messageId: answerId } });
    expect(regenerate.status).toBe(403);
    expect(await regenerate.json()).toEqual(forbidden("regenerate"));
    expect((await storage.listMessages(chatId)).length).toBe(before);
  });

  it("вложения: загрузка (не GET) — право attachments; чтение файла остаётся", async () => {
    const attachments = fakeAttachments();
    const { call, createChat } = createTestChat({ attachments, chatCapabilities: () => ({ attachments: false }) });
    const chatId = await createChat();
    const upload = await call("POST", `/${chatId}/attachments`, { body: {} });
    expect(upload.status).toBe(403);
    expect(await upload.json()).toEqual(forbidden("attachments"));
    expect(attachments.handle).not.toHaveBeenCalled();
    const read = await call("GET", `/${chatId}/attachments/f1`);
    expect(read.status).toBe(201);
  });

  it("ошибка в chatCapabilities — 500 other и строка в журнал", async () => {
    const logError = vi.fn();
    const { call, createChat } = createTestChat({
      chatCapabilities: () => {
        throw new Error("база форм недоступна");
      },
      logError,
    });
    const chatId = await createChat();
    const response = await call("GET", `/${chatId}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { kind: "other" } });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("chatCapabilities"));
  });
});

describe("обработчик чата: закрытый чат", () => {
  it("отправка и повтор — 409 chat_closed с кодом и текстом; ничего не записано", async () => {
    const { call, createChat, storage } = createTestChat();
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    await storage.setChatClosed!(chatId, CLOSURE);
    const before = (await storage.listMessages(chatId)).length;
    const responses = [
      await call("POST", `/${chatId}/messages`, { body: message("u2", "Ещё") }),
      await call("POST", `/${chatId}/retry`),
    ];
    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { kind: "chat_closed", ...CLOSURE } });
    }
    expect((await storage.listMessages(chatId)).length).toBe(before);
    const history = (await (await call("GET", `/${chatId}`)).json()) as { chat: { closed?: unknown } };
    expect(history.chat.closed).toEqual(CLOSURE);
  });

  it("правка в закрытом чате идёт: новая ветка открыта", async () => {
    const { call, createChat, storage } = createTestChat();
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    await storage.setChatClosed!(chatId, CLOSURE);
    const edit = await call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u3", "Правка") } });
    expect(edit.status).toBe(200);
    await edit.text();
    const history = (await (await call("GET", `/${chatId}`)).json()) as { chat: { closed?: unknown } };
    expect(history.chat.closed).toBeUndefined();
  });
});

describe("обработчик чата: закрытый чат — ответы человека и список", () => {
  it("подтверждение и виджет в закрытом чате — 409 chat_closed", async () => {
    const { call, createChat, storage } = createTestChat();
    const chatId = await createChat();
    await storage.setChatClosed!(chatId, CLOSURE);
    const approval = await call("POST", `/${chatId}/approvals/a1`, { body: { decision: "allow" } });
    expect(approval.status).toBe(409);
    expect(await approval.json()).toEqual({ error: { kind: "chat_closed", ...CLOSURE } });
    const widget = await call("POST", `/${chatId}/widgets/w1`, { body: { answer: { slot: "10:00" } } });
    expect(widget.status).toBe(409);
    expect(await widget.json()).toEqual({ error: { kind: "chat_closed", ...CLOSURE } });
  });

  it("список чатов отдаёт closed у закрытого чата", async () => {
    const { call, createChat, storage } = createTestChat({ chatList: true });
    const closed = await createChat();
    const open = await createChat();
    await storage.setChatClosed!(closed, CLOSURE);
    const { chats } = (await (await call("GET", "")).json()) as { chats: Array<{ id: string; closed?: unknown }> };
    expect(chats.find((chat) => chat.id === closed)!.closed).toEqual(CLOSURE);
    expect(chats.find((chat) => chat.id === open)).not.toHaveProperty("closed");
  });
});

describe("обработчик чата: права на правку и удаление", () => {
  it("правка с файлами — 403 attachments, правка голосом — 403 voice; ничего не записано", async () => {
    const attachments = fakeAttachments();
    const { call, createChat, storage } = createTestChat({ attachments, chatCapabilities: () => ({ attachments: false, voice: false }) });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    const before = (await storage.listMessages(chatId)).length;
    const withFile = await call("POST", `/${chatId}/edit`, {
      body: { editedMessageId: "u1", message: { id: "u2", role: "user", parts: [{ type: "file", url: "attachment:f1", mediaType: "image/png", filename: "cat.png" }] } },
    });
    expect(withFile.status).toBe(403);
    expect(await withFile.json()).toEqual(forbidden("attachments"));
    const withVoice = await call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u3", "Правка"), voiceMode: true } });
    expect(withVoice.status).toBe(403);
    expect(await withVoice.json()).toEqual(forbidden("voice"));
    expect((await storage.listMessages(chatId)).length).toBe(before);
  });

  it("удаление без права chatList — 403, чат цел", async () => {
    const { call, createChat, storage } = createTestChat({ chatList: true, chatCapabilities: () => ({ chatList: false }) });
    const chatId = await createChat();
    const response = await call("DELETE", `/${chatId}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbidden("chatList"));
    expect(await storage.getChat(chatId)).toBeDefined();
  });
});

describe("обработчик чата: хук beforeCreateChat", () => {
  it("отказ — 403 chat_creation_refused с кодом и текстом, чат не создан; хук получает человека без origin", async () => {
    const beforeCreateChat = vi.fn(() => ({ code: "one_chat_only", message: "У вас уже есть чат." }));
    const { call, storage } = createTestChat({ beforeCreateChat });
    const response = await call("POST", "");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "chat_creation_refused", code: "one_chat_only", message: "У вас уже есть чат." } });
    expect(beforeCreateChat).toHaveBeenCalledWith({ userId: "anna" });
    expect(await storage.listChats("anna")).toEqual([]);
  });

  it("пропуск — 201 и чат", async () => {
    const { call } = createTestChat({ beforeCreateChat: () => undefined });
    const response = await call("POST", "");
    expect(response.status).toBe(201);
  });
});
