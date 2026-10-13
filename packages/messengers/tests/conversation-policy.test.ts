import { describe, expect, it } from "vitest";
import { createConversationPolicy } from "../src/conversation-policy";
import { messengerTexts } from "../src/messenger-texts";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { ChatRequest, ConversationKey, ExternalAccount } from "../src/types";
import { account, createFakeAdapter } from "./support/fake-adapter";
import { createFakeChatService } from "./support/fake-chat-service";

const key: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: "100" };

function setup(options: Partial<Parameters<typeof createConversationPolicy>[0]> = {}) {
  const store = createMemoryMessengerStore();
  const fake = createFakeChatService();
  const policy = createConversationPolicy({ store, service: fake.service, ...options });
  const ctx = { key, account: account(), userId: "anna" };
  return { store, fake, policy, ctx };
}

const commandNames = (list: ReadonlyArray<{ command: string }>) => list.map((item) => item.command);

describe("правила разговора: режим", () => {
  it("по умолчанию «один разговор»: в меню и подсказке нет /new и /chats, сами команды не разбираются", async () => {
    const { policy, ctx } = setup();
    expect(policy.mode).toBe("single");
    expect(commandNames(policy.privateCommands())).toEqual(["help", "stop"]);
    expect(policy.helpText({ messenger: "telegram", botId: "bot1" })).not.toMatch(/\/new|\/chats/);
    expect(await policy.handleCommand({ name: "new", args: "" }, ctx)).toBeNull();
    expect(await policy.handleCommand({ name: "chats", args: "" }, ctx)).toBeNull();
    expect((await policy.handleCommand({ name: "help", args: "" }, ctx))?.text).toBe(messengerTexts.helpSingle);
  });

  it("меню команд ставится по режиму, если мессенджер умеет меню", async () => {
    const single = setup();
    const withMenu = createFakeAdapter();
    await single.policy.installCommands(withMenu.adapter);
    expect(withMenu.commands.map((item) => [item.scope, commandNames(item.commands)])).toEqual([["private", ["help", "stop"]]]);

    const many = setup({ conversations: "many" });
    const another = createFakeAdapter();
    await many.policy.installCommands(another.adapter);
    expect(another.commands.map((item) => [item.scope, commandNames(item.commands)])).toEqual([["private", ["new", "chats", "help", "stop"]]]);

    const noMenu = createFakeAdapter({ abilities: { commandsMenu: false } });
    await many.policy.installCommands(noMenu.adapter);
    expect(noMenu.commands).toEqual([]);
  });

  it("«много чатов»: /new — новый чат становится текущим", async () => {
    const { policy, ctx, store, fake } = setup({ conversations: "many" });
    expect(policy.helpText({ messenger: "telegram", botId: "bot1" })).toBe(messengerTexts.helpMany);
    const first = await policy.currentChat(ctx);
    const reply = await policy.handleCommand({ name: "new", args: "" }, ctx);
    expect(reply?.text).toBe(messengerTexts.newChat);
    const current = (await store.getConversation(key))?.currentChatId;
    expect(current).not.toBe(first.chatId);
    expect(fake.chats.get(current as string)?.origin).toBe("telegram");
  });

  it("«много чатов»: /chats — последние 5 кнопками, выбор делает чат текущим; чужой чат не выбрать", async () => {
    const { policy, ctx, store, fake } = setup({ conversations: "many" });
    const ids = [1, 2, 3, 4, 5, 6].map((index) => fake.addChat("anna", index === 6 ? null : `Чат ${index}`));
    const foreign = fake.addChat("boris", "Чужой");
    const reply = await policy.handleCommand({ name: "chats", args: "" }, ctx);
    expect(reply?.text).toBe(messengerTexts.chatsTitle);
    expect(reply?.rows?.map((row) => row.map((button) => button.text))).toEqual([[messengerTexts.untitledChat], ["Чат 5"], ["Чат 4"], ["Чат 3"], ["Чат 2"]]);
    expect(reply?.rows?.[1]?.[0]?.action).toEqual({ type: "select_chat", chatId: ids[4] });

    expect(await policy.selectChat(ctx, ids[2] as string)).toBe(messengerTexts.chatSelected("Чат 3"));
    expect((await store.getConversation(key))?.currentChatId).toBe(ids[2]);
    expect(await policy.selectChat(ctx, foreign)).toBe(messengerTexts.failed);
    expect((await store.getConversation(key))?.currentChatId).toBe(ids[2]);
  });

  it("«много чатов»: чатов нет — так и сказано", async () => {
    const { policy, ctx } = setup({ conversations: "many" });
    expect(await policy.handleCommand({ name: "chats", args: "" }, ctx)).toEqual({ text: messengerTexts.noChats });
  });
});

describe("правила разговора: права и закрытый чат", () => {
  it("/new: приложение не даёт завести чат — текст отказа, текущий чат прежний", async () => {
    const { policy, ctx, store, fake } = setup({ conversations: "many" });
    const first = await policy.currentChat(ctx);
    fake.service.createRefusal = { code: "no_seats", message: "Новый чат завести нельзя." };
    expect(await policy.handleCommand({ name: "new", args: "" }, ctx)).toEqual({ text: "Новый чат завести нельзя." });
    expect((await store.getConversation(key))?.currentChatId).toBe(first.chatId);
  });

  it("/start с меткой: отказ в новом чате — текст отказа", async () => {
    const { policy, ctx, fake } = setup();
    fake.service.createRefusal = { code: "no_seats", message: "Новый чат завести нельзя." };
    expect(await policy.handleCommand({ name: "start", args: "lesson-1" }, ctx)).toEqual({ text: "Новый чат завести нельзя." });
  });

  it("/chats и выбор чата учитывают право chatList текущего чата", async () => {
    const { policy, ctx, store, fake } = setup({ conversations: "many" });
    const other = fake.addChat("anna", "Другой");
    const current = await policy.currentChat(ctx);
    fake.service.capabilities = { chatList: false };
    expect(await policy.handleCommand({ name: "chats", args: "" }, ctx)).toEqual({ text: messengerTexts.chatListForbidden });
    expect(await policy.selectChat(ctx, other)).toBe(messengerTexts.chatListForbidden);
    expect((await store.getConversation(key))?.currentChatId).toBe(current.chatId);
  });

  it("/chats без текущего чата — список как обычно; закрытый чат помечен", async () => {
    const { policy, ctx, fake } = setup({ conversations: "many" });
    fake.addChat("anna", "Открытый");
    fake.addChat("anna", "Анкета", "web", { code: "form_done", message: "Анкета отправлена." });
    fake.service.capabilities = { chatList: false };
    const reply = await policy.handleCommand({ name: "chats", args: "" }, ctx);
    expect(reply?.rows?.map((row) => row.map((button) => button.text))).toEqual([[messengerTexts.closedChat("Анкета")], ["Открытый"]]);
  });
});

describe("правила разговора: чат для разговора", () => {
  it("по умолчанию — новый пустой чат с origin мессенджера; дальше тот же чат", async () => {
    const { policy, ctx, store, fake } = setup();
    const first = await policy.currentChat(ctx);
    expect(first.agentStarted).toBe(false);
    expect(fake.chats.get(first.chatId)).toMatchObject({ ownerId: "anna", origin: "telegram" });
    expect(await store.getConversation(key)).toMatchObject({ ...key, type: "private", userId: "anna", currentChatId: first.chatId, blocked: false, active: true });
    expect((await policy.currentChat(ctx)).chatId).toBe(first.chatId);
    expect(fake.chats.size).toBe(1);
    expect(fake.notices).toEqual([]);
  });

  it("правило приложения получает причину и текущий чат; agentStarts → conversation_started, агент пишет первым", async () => {
    const requests: ChatRequest[] = [];
    const { policy, ctx, fake } = setup({
      chatForConversation: async (request) => {
        requests.push(request);
        const chat = await fake.service.createChat(request.userId, { origin: "telegram" });
        return { chatId: chat.id, agentStarts: "Поздоровайся и спроси, чем помочь." };
      },
    });
    const first = await policy.currentChat(ctx);
    expect(first.agentStarted).toBe(true);
    const gone = await policy.openChat({ ...ctx, reason: "chat_gone" });
    expect(requests.map((request) => [request.reason, request.currentChatId, request.userId, request.account.externalUserId])).toEqual([
      ["first", undefined, "anna", ctx.account.externalUserId],
      ["chat_gone", first.chatId, "anna", ctx.account.externalUserId],
    ]);
    expect(fake.notices).toHaveLength(2);
    expect(fake.notices[0]).toMatchObject({
      ownerId: "anna",
      chatId: first.chatId,
      wakeAgent: true,
      notices: [{ kind: "conversation_started", title: "Поздоровайся и спроси, чем помочь." }],
    });
    expect(fake.notices[0]?.deliveryKey).not.toBe(fake.notices[1]?.deliveryKey);
    expect(fake.notices[1]?.chatId).toBe(gone.chatId);
  });

  it("служба не начала ход или упала — agentStarted false, ошибка в журнал, чат всё равно текущий", async () => {
    const errors: unknown[] = [];
    const { policy, ctx, fake, store } = setup({
      logError: (error) => errors.push(error),
      chatForConversation: async (request) => ({ chatId: (await fake.service.createChat(request.userId, { origin: "telegram" })).id, agentStarts: "Привет" }),
    });
    fake.service.noticeResult = () => {
      throw new Error("db down");
    };
    const opened = await policy.currentChat(ctx);
    expect(opened.agentStarted).toBe(false);
    expect(errors).toHaveLength(1);
    expect((await store.getConversation(key))?.currentChatId).toBe(opened.chatId);
  });

  it("метка сценария из ссылки на бота → чат с причиной start_payload; код привязки не трогается", async () => {
    const requests: ChatRequest[] = [];
    const { policy, ctx, fake } = setup({
      chatForConversation: async (request) => {
        requests.push(request);
        return { chatId: (await fake.service.createChat(request.userId, { origin: "telegram" })).id, agentStarts: `Сценарий ${request.startPayload}` };
      },
    });
    const reply = await policy.handleCommand({ name: "start", args: "promo_spring" }, ctx);
    expect(requests.map((request) => [request.reason, request.startPayload])).toEqual([["start_payload", "promo_spring"]]);
    // Агент пишет первым — приветствие бота не нужно.
    expect(reply).toEqual({});
    expect(await policy.handleCommand({ name: "start", args: "AbCdEfGhIjKlMnOpQrStUv" }, ctx)).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("/start без метки — приветствие, чат не создаётся до первого сообщения", async () => {
    const { policy, ctx, fake } = setup();
    expect(await policy.handleCommand({ name: "start", args: "" }, ctx)).toEqual({ text: messengerTexts.hello });
    expect(fake.chats.size).toBe(0);
  });

  it("/start с меткой без agentStarts — приветствие", async () => {
    const { policy, ctx } = setup();
    expect(await policy.handleCommand({ name: "start", args: "promo" }, ctx)).toEqual({ text: messengerTexts.hello });
  });
});

describe("правила разговора: кто пишет", () => {
  it("по умолчанию: привязанный — от своего имени, непривязанный — «как подключиться»", async () => {
    const { policy, store } = setup();
    const anna: ExternalAccount = account();
    expect(await policy.resolveWriter(anna)).toEqual({ reply: messengerTexts.howToConnect });
    await store.saveLink({ messenger: "telegram", botId: "bot1", externalUserId: anna.externalUserId, userId: "anna", name: "Анна", linkedAt: new Date().toISOString() });
    expect(await policy.resolveWriter(anna)).toEqual({ userId: "anna" });
    expect(await policy.resolveWriter({ ...account({ externalUserId: "999" }), linkedUserId: "boris" })).toEqual({ userId: "boris" });
  });

  it("resolveAccount приложения: пользователь или отказ своим текстом", async () => {
    const seen: ExternalAccount[] = [];
    const { policy } = setup({
      resolveAccount: async (who) => {
        seen.push(who);
        return who.externalUserId === "1" ? { userId: "guest-1" } : { refuse: "Бот только для клиентов." };
      },
    });
    expect(await policy.resolveWriter(account({ externalUserId: "1" }))).toEqual({ userId: "guest-1" });
    expect(await policy.resolveWriter(account({ externalUserId: "2" }))).toEqual({ reply: "Бот только для клиентов." });
    expect(seen).toHaveLength(2);
  });
});
