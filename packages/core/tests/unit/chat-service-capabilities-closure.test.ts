import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ActionForbiddenError, CHAT_CLOSED_PART_TYPE, ChatClosedError, ChatCreationRefusedError, resolveChatCapabilities } from "../../src/index";
import type { AgentToolsModel, BeforeTurnHandler, ChatCapabilities, ChatCapabilitiesHandler, ChatEvent, ChatService, TurnNotStartedHandler } from "../../src/index";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import type { MessageAttachments } from "../../src/attachments/message-attachments";
import { defineWidget } from "../../src/widgets/define-widget";
import { readAll } from "./support/mock-model";
import { callTool, doneNotice, noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";
import { finishPart, streamStart } from "./support/mock-model";

const ALL_ALLOWED: ChatCapabilities = {
  edit: true,
  regenerate: true,
  retry: true,
  branches: true,
  modelChoice: true,
  answerEditing: true,
  chatList: true,
  compact: true,
  attachments: true,
  voice: true,
  reasoning: true,
  toolDetails: true,
  steer: true,
  modelDetails: true,
};

const CLOSURE = { code: "form_completed", message: "Заявка отправлена. Чат только для чтения." };

const fileRef = { type: "file" as const, url: "attachment:f1", mediaType: "image/png", filename: "cat.png" };

const fakeAttachments = (): MessageAttachments => ({
  acceptUserParts: vi.fn(async ({ parts }: Parameters<MessageAttachments["acceptUserParts"]>[0]) =>
    parts.map((part) => ({ type: "file" as const, url: part.url, mediaType: "image/png", filename: "cat.png" })),
  ),
  confirmUserParts: vi.fn(async () => undefined),
  prepareHistory: vi.fn(async ({ history }: Parameters<MessageAttachments["prepareHistory"]>[0]) => [...history]),
});

const removeTool = (execute = vi.fn(async () => "удалено")) =>
  tool({ description: "Удалить", inputSchema: z.object({}), needsApproval: true, execute });

const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Выбрать время встречи",
  inputSchema: z.object({ slots: z.array(z.string()).min(2) }),
  answerSchema: z.object({ slot: z.string() }),
});

function setup(extra: Parameters<typeof noticeService>[1] = {}, scripts: Parameters<typeof scriptedModel>[0] = []) {
  const model = scriptedModel(scripts);
  const events: ChatEvent[] = [];
  const { service, storage } = noticeService(model, extra);
  service.subscribeEvents((event) => events.push(event));
  return { model, service, storage, events };
}

/** Права, которые ведёт тест; каждое обращение — в `calls`. */
function rights(initial: Partial<ChatCapabilities> = {}) {
  const state = { value: initial as Partial<ChatCapabilities> };
  const calls: Array<Parameters<ChatCapabilitiesHandler>[0]> = [];
  const chatCapabilities: ChatCapabilitiesHandler = (input) => {
    calls.push(input);
    return state.value;
  };
  return { state, calls, chatCapabilities };
}

/** `beforeTurn`, который только записывает обращения. */
function watchedGate() {
  const calls: Array<Parameters<BeforeTurnHandler>[0]> = [];
  const beforeTurn: BeforeTurnHandler = (input) => {
    calls.push(input);
  };
  return { calls, beforeTurn };
}

async function answered(service: ReturnType<typeof setup>["service"], chatId: string, id = "u1", text = "Привет") {
  await readAll(await service.sendMessage("anna", chatId, userMessage(id, text)));
}

const forbidden = (action: keyof ChatCapabilities) => ({ name: "ActionForbiddenError", action });

describe("служба чата: права посетителя (chatCapabilities)", () => {
  it("без функции прав история отдаёт все права true", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    expect((await service.getHistory("anna", chat.id)).capabilities).toEqual(ALL_ALLOWED);
    expect((await service.peekHistory("anna", chat.id)).capabilities).toEqual(ALL_ALLOWED);
  });

  it("частичный ответ приложения: остальные права true; функция получает человека и чат", async () => {
    const { calls, chatCapabilities } = rights({ edit: false, modelChoice: false });
    const { service } = setup({ chatCapabilities });
    const chat = await service.createChat("anna");
    const { capabilities } = await service.getHistory("anna", chat.id);
    expect(capabilities).toEqual({ ...ALL_ALLOWED, edit: false, modelChoice: false });
    expect(calls[0]).toMatchObject({ userId: "anna", chat: { id: chat.id, ownerId: "anna" } });
  });

  it("правка запрещена: ActionForbiddenError, beforeTurn не зван, ничего не записано", async () => {
    const { chatCapabilities, state } = rights();
    const gate = watchedGate();
    const { service, storage, model } = setup({ chatCapabilities, beforeTurn: gate.beforeTurn });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const before = (await storage.listMessages(chat.id)).length;
    gate.calls.length = 0;
    state.value = { edit: false };
    const failure = await service.editMessage("anna", chat.id, "u1", userMessage("u2", "Правка")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ActionForbiddenError);
    expect(failure).toMatchObject(forbidden("edit"));
    expect(gate.calls).toHaveLength(0);
    expect((await storage.listMessages(chat.id)).length).toBe(before);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("поправка запрещена (steer): ActionForbiddenError до записи, beforeTurn не зван", async () => {
    const { chatCapabilities, state } = rights();
    const gate = watchedGate();
    const { service, storage } = setup({ chatCapabilities, beforeTurn: gate.beforeTurn });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const before = (await storage.listMessages(chat.id)).length;
    gate.calls.length = 0;
    state.value = { steer: false };
    await expect(service.steer("anna", chat.id, userMessage("s1", "И покороче"))).rejects.toMatchObject(forbidden("steer"));
    expect(gate.calls).toHaveLength(0);
    expect((await storage.listMessages(chat.id)).length).toBe(before);
  });

  it("переделка запрещена, повтор разрешён — права раздельные", async () => {
    const { chatCapabilities } = rights({ regenerate: false });
    const { service } = setup({ chatCapabilities });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answerId = (await service.getHistory("anna", chat.id)).messages.at(-1)!.id;
    await expect(service.regenerate("anna", chat.id, answerId)).rejects.toMatchObject(forbidden("regenerate"));
    // Право есть: повтор доходит до своей проверки (готовый ответ повторять нечего), а не до запрета.
    await expect(service.retry("anna", chat.id)).rejects.toMatchObject({ name: "NothingToRetryError" });
    const failing = setup({ chatCapabilities: () => ({ retry: false }) });
    const other = await failing.service.createChat("anna");
    await answered(failing.service, other.id);
    await expect(failing.service.retry("anna", other.id)).rejects.toMatchObject(forbidden("retry"));
  });

  it("ветки, модель, правка ответа, переименование, удаление, сжатие — каждое под своим правом", async () => {
    const { chatCapabilities, state } = rights();
    const { service, storage } = setup({ chatCapabilities });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answerId = (await service.getHistory("anna", chat.id)).messages.at(-1)!.id;
    state.value = { branches: false, modelChoice: false, answerEditing: false, chatList: false, compact: false };
    await expect(service.selectBranch("anna", chat.id, answerId)).rejects.toMatchObject(forbidden("branches"));
    const { chat: shown } = await service.getHistory("anna", chat.id);
    await expect(service.setModel("anna", chat.id, { modelId: shown.modelId, providerId: shown.providerId })).rejects.toMatchObject(forbidden("modelChoice"));
    await expect(service.editAnswer("anna", chat.id, answerId, { text: "Правленый ответ" })).rejects.toMatchObject(forbidden("answerEditing"));
    await expect(service.renameChat("anna", chat.id, "Новое имя")).rejects.toMatchObject(forbidden("chatList"));
    await expect(service.deleteChat("anna", chat.id)).rejects.toMatchObject(forbidden("chatList"));
    await expect(service.compactNow("anna", chat.id)).rejects.toMatchObject(forbidden("compact"));
    expect(await storage.getChat(chat.id)).toBeDefined();
  });

  it("файлы в сообщении и адреса вложений — право attachments; голосовое сообщение — право voice", async () => {
    const attachments = fakeAttachments();
    const { service, storage } = setup({ attachments, chatCapabilities: () => ({ attachments: false, voice: false }) });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [fileRef] })).rejects.toMatchObject(forbidden("attachments"));
    expect(attachments.acceptUserParts).not.toHaveBeenCalled();
    await expect(service.assertCapability("anna", chat.id, "attachments")).rejects.toMatchObject(forbidden("attachments"));
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "Привет"), { voiceMode: true })).rejects.toMatchObject(forbidden("voice"));
    expect(await storage.listMessages(chat.id)).toEqual([]);
    // Обычное сообщение без файлов и голоса проходит.
    await answered(service, chat.id, "u3");
    await expect(service.assertCapability("anna", chat.id, "edit")).resolves.toBeUndefined();
  });

  it("чужой чат — «не найден», права не спрошены", async () => {
    const { calls, chatCapabilities } = rights();
    const { service } = setup({ chatCapabilities });
    const chat = await service.createChat("anna");
    await expect(service.assertCapability("boris", chat.id, "edit")).rejects.toMatchObject({ name: "ChatNotFoundError" });
    await expect(service.sendMessage("boris", chat.id, userMessage("u1", "Привет"))).rejects.toMatchObject({ name: "ChatNotFoundError" });
    expect(calls).toHaveLength(0);
  });

  it("не булево значение — ошибка приложения: TypeError, строка в журнал", async () => {
    const logError = vi.fn();
    const { service } = setup({ chatCapabilities: () => ({ edit: "нет" }) as never, logError });
    const chat = await service.createChat("anna");
    await expect(service.getHistory("anna", chat.id)).rejects.toBeInstanceOf(TypeError);
    await expect(service.assertCapability("anna", chat.id, "edit")).rejects.toBeInstanceOf(TypeError);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("chatCapabilities"));
  });

  it("асинхронная функция прав ждётся", async () => {
    const { service } = setup({ chatCapabilities: async () => ({ branches: false }) });
    const chat = await service.createChat("anna");
    expect((await service.getHistory("anna", chat.id)).capabilities.branches).toBe(false);
  });
});

describe("служба чата: закрытый чат", () => {
  it("closeChat ставит флаг и шлёт chat-closed; reopenChat снимает и шлёт chat-reopened", async () => {
    const { service, events } = setup();
    const chat = await service.createChat("anna");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    expect((await service.getHistory("anna", chat.id)).chat.closed).toEqual(CLOSURE);
    expect(events.at(-1)).toEqual({ type: "chat-closed", ownerId: "anna", chatId: chat.id, closed: CLOSURE });
    await service.reopenChat({ ownerId: "anna", chatId: chat.id });
    expect((await service.getHistory("anna", chat.id)).chat.closed).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: "chat-reopened", ownerId: "anna", chatId: chat.id });
  });

  it("чужой чат — ChatNotFoundError; неверный код — TypeError; длинный текст обрезается до 300", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await expect(service.closeChat({ ownerId: "boris", chatId: chat.id, ...CLOSURE })).rejects.toMatchObject({ name: "ChatNotFoundError" });
    await expect(service.reopenChat({ ownerId: "boris", chatId: chat.id })).rejects.toMatchObject({ name: "ChatNotFoundError" });
    await expect(service.closeChat({ ownerId: "anna", chatId: chat.id, code: "Форма Снята", message: "x" })).rejects.toBeInstanceOf(TypeError);
    await service.closeChat({ ownerId: "anna", chatId: chat.id, code: "long", message: "я".repeat(400) });
    expect((await service.getHistory("anna", chat.id)).chat.closed!.message).toHaveLength(300);
  });

  it("закрытый чат отказывает отправке, «Повторить», подтверждению и проверке хода: ChatClosedError с кодом и текстом, beforeTurn не зван", async () => {
    const execute = vi.fn(async () => "удалено");
    const gate = watchedGate();
    const { service, storage, model } = setup(
      { beforeTurn: gate.beforeTurn, agent: { tools: { remove: removeTool(execute) } } },
      [saying("первый"), callTool("remove", "c1")],
    );
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    await answered(service, chat.id, "u2", "Удали");
    const history = await service.getHistory("anna", chat.id);
    const approvalId = (history.messages.at(-1)!.parts.find((part) => part.type === "tool-remove") as { approval: { id: string } }).approval.id;
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    const before = (await storage.listMessages(chat.id)).length;
    const callsBefore = model.doStreamCalls.length;
    gate.calls.length = 0;

    const failure = await service.sendMessage("anna", chat.id, userMessage("u3", "Ещё")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatClosedError);
    expect(failure).toMatchObject(CLOSURE);
    await expect(service.retry("anna", chat.id)).rejects.toMatchObject(CLOSURE);
    await expect(service.answerApproval("anna", chat.id, approvalId, "allow")).rejects.toBeInstanceOf(ChatClosedError);
    await expect(service.assertTurnAllowed("anna", chat.id, "send", "Ещё")).rejects.toBeInstanceOf(ChatClosedError);
    expect(gate.calls).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
    expect((await storage.listMessages(chat.id)).length).toBe(before);
    expect(model.doStreamCalls).toHaveLength(callsBefore);
  });

  it("виджет в закрытом чате: ChatClosedError; закрытие побеждает паузу — виджет закрыт ошибкой", async () => {
    const { service, storage } = setup({ agent: { widgets: { custom: [pickSlot] } } }, [callTool("pick_slot", "w1", { slots: ["10:00", "11:00"] })]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { slot: "10:00" } })).rejects.toBeInstanceOf(ChatClosedError);
    const answer = (await storage.listMessages(chat.id)).filter((message) => message.role === "assistant").at(-1)!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-pick_slot")).toMatchObject({ state: "output-error" });
  });

  it("права проверяются раньше закрытия: запрещённая правка в закрытом чате — ActionForbiddenError", async () => {
    const { service } = setup({ chatCapabilities: () => ({ edit: false }) });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await expect(service.editMessage("anna", chat.id, "u1", userMessage("u2", "Правка"))).rejects.toMatchObject(forbidden("edit"));
  });

  it("после reopenChat ходы снова идут", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await service.reopenChat({ ownerId: "anna", chatId: chat.id });
    await answered(service, chat.id);
    expect((await service.getHistory("anna", chat.id)).messages).toHaveLength(2);
  });

  it("служебное сообщение в закрытый чат пишется без хода", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    const result = await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "готово")], wakeAgent: true, deliveryKey: "k1" });
    expect(result).toMatchObject({ status: "delivered", turnStarted: false });
    expect((await service.getHistory("anna", chat.id)).messages).toHaveLength(3);
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe("закрытие из инструмента (model.closeChat)", () => {
  /** Инструмент, который закрывает чат; `model` последнего хода — в `seen`. */
  function closingTools(seen: { model?: AgentToolsModel }, closure = CLOSURE) {
    return (model: AgentToolsModel) => {
      seen.model = model;
      return {
        finish_form: tool({
          description: "Отправить заявку",
          inputSchema: z.object({}),
          execute: async () => {
            model.closeChat!(closure);
            return "отправлено";
          },
        }),
      };
    };
  }

  it("после хода чат закрыт, кусок data-chat-closed в потоке, событие chat-closed; закрытие после записи ответа", async () => {
    const seen: { model?: AgentToolsModel } = {};
    const { service, storage, events } = setup({ agent: { tools: closingTools(seen) } }, [callTool("finish_form", "c1"), saying("Готово")]);
    const chat = await service.createChat("anna");
    const answerStatusAtClose: string[] = [];
    service.subscribeEvents((event) => {
      if (event.type === "chat-closed") void storage.listMessages(chat.id).then((messages) => answerStatusAtClose.push(messages.at(-1)!.status));
    });
    const chunks: UIMessageChunk[] = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(chunks.filter((chunk) => chunk.type === CHAT_CLOSED_PART_TYPE)).toEqual([{ type: CHAT_CLOSED_PART_TYPE, data: CLOSURE, transient: true }]);
    expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE);
    expect(events.filter((event) => event.type === "chat-closed")).toEqual([{ type: "chat-closed", ownerId: "anna", chatId: chat.id, closed: CLOSURE }]);
    await vi.waitFor(() => expect(answerStatusAtClose).toEqual(["complete"]));
    // В ответе куска нет: признак закрытия живёт в чате, а не в истории.
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(answer.parts.some((part) => part.type === CHAT_CLOSED_PART_TYPE)).toBe(false);
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "Ещё"))).rejects.toBeInstanceOf(ChatClosedError);
  });

  it("неверный код — ошибка инструмента, чат открыт", async () => {
    const seen: { model?: AgentToolsModel } = {};
    const { service, storage } = setup({ agent: { tools: closingTools(seen, { code: "Плохой Код", message: "x" }) } }, [callTool("finish_form", "c1"), saying("Готово")]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    expect((await storage.getChat(chat.id))!.closed).toBeUndefined();
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(answer.parts.find((part) => part.type === "tool-finish_form")).toMatchObject({ state: "output-error" });
  });

  it("позвали после конца хода — не применяется, строка в журнал", async () => {
    const logError = vi.fn();
    const seen: { model?: AgentToolsModel } = {};
    const { service, storage } = setup({ logError, agent: { tools: closingTools(seen) } }, [saying("Привет")]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    seen.model!.closeChat!(CLOSURE);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await storage.getChat(chat.id))!.closed).toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("closeChat"));
  });

  it("«Стоп» после закрытия: закрытие всё равно применяется", async () => {
    let closed!: () => void;
    const closedNow = new Promise<void>((resolve) => (closed = resolve));
    const tools = (model: AgentToolsModel) => ({
      finish_form: tool({
        description: "Отправить заявку",
        inputSchema: z.object({}),
        execute: async (_input, { abortSignal }) => {
          model.closeChat!(CLOSURE);
          closed();
          await new Promise((resolve) => abortSignal?.addEventListener("abort", resolve));
          return "отправлено";
        },
      }),
    });
    const { service, storage } = setup({ agent: { tools } }, [callTool("finish_form", "c1")]);
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь"));
    const reading = readAll(stream);
    await closedNow;
    await service.stop("anna", chat.id);
    await reading;
    await vi.waitFor(async () => expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE));
  });

  it("без вызова closeChat чат не закрывается и событий закрытия нет", async () => {
    const { service, storage, events } = setup();
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    expect((await storage.getChat(chat.id))!.closed).toBeUndefined();
    expect(events.some((event) => event.type === "chat-closed")).toBe(false);
  });
});

describe("права: опечатка в названии права", () => {
  it("неизвестный ключ — TypeError, как не булево значение: опечатка не даёт доступ молча", () => {
    expect(() => resolveChatCapabilities({ edits: false } as never)).toThrow(TypeError);
    expect(() => resolveChatCapabilities({ edit: false, chatlist: false } as never)).toThrow(/chatlist/);
  });

  it("служба: опечатка в ответе приложения — TypeError и строка в журнал, действие не проходит", async () => {
    const logError = vi.fn();
    const { service } = setup({ chatCapabilities: () => ({ regenrate: false }) as never, logError });
    const chat = await service.createChat("anna");
    await expect(service.getHistory("anna", chat.id)).rejects.toBeInstanceOf(TypeError);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("regenrate"));
  });
});

describe("права: одно обращение к приложению на запрос", () => {
  it("история и выбор ветки спрашивают права один раз", async () => {
    const { calls, chatCapabilities } = rights();
    const { service } = setup({ chatCapabilities }, [saying("первый"), saying("второй")]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const history = await service.getHistory("anna", chat.id);
    calls.length = 0;
    await service.getHistory("anna", chat.id);
    expect(calls).toHaveLength(1);
    calls.length = 0;
    await service.selectBranch("anna", chat.id, history.messages.at(-1)!.id);
    expect(calls).toHaveLength(1);
  });
});

/** Хранилище, которое закрывает чат по команде теста: так закрытие попадает между проверкой и замком чата. */
function closableStorage(): { storage: ChatStorage; closeNow: (chatId: string) => Promise<void> } {
  const storage = createInMemoryChatStorage();
  return { storage, closeNow: (chatId) => storage.setChatClosed!(chatId, CLOSURE) };
}

describe("гонка: чат закрыли после проверки, но до начала хода", () => {
  type Attempt = (service: ChatService, chatId: string, answerId: string) => Promise<unknown>;
  const attempts: Array<[string, Attempt]> = [
    // Правка и «Переделать» уводят на другую ветку: закрытие им не мешает.
    ["отправка", (service, chatId) => service.sendMessage("anna", chatId, userMessage("u9", "Ещё"))],
    ["повтор", (service, chatId) => service.retry("anna", chatId)],
  ];

  it.each(attempts)("%s: резерв beforeTurn есть — ChatClosedError под замком, turnNotStarted с причиной chat_closed", async (_name, attempt) => {
    const { storage, closeNow } = closableStorage();
    const turnNotStarted = vi.fn<TurnNotStartedHandler>();
    let closeOnTurn = false;
    const beforeTurn: BeforeTurnHandler = async ({ chat }) => {
      if (closeOnTurn) await closeNow(chat.id);
    };
    // Повтор доходит до хода только у ответа с ошибкой: первый ответ — с ошибкой модели.
    const { service, model } = setup({ storage, beforeTurn, turnNotStarted }, [[streamStart, { type: "error", error: new Error("сбой") }]]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answerId = (await service.getHistory("anna", chat.id)).messages.at(-1)!.id;
    const before = (await storage.listMessages(chat.id)).length;
    const callsBefore = model.doStreamCalls.length;
    turnNotStarted.mockClear();
    closeOnTurn = true;
    const failure = await attempt(service, chat.id, answerId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatClosedError);
    expect(failure).toMatchObject(CLOSURE);
    expect(turnNotStarted).toHaveBeenCalledTimes(1);
    expect(turnNotStarted.mock.calls[0]![0]).toMatchObject({ reason: "chat_closed" });
    expect((await storage.listMessages(chat.id)).length).toBe(before);
    expect(model.doStreamCalls).toHaveLength(callsBefore);
  });

  it("без beforeTurn: закрытие во время проверки прав — ChatClosedError, хода нет", async () => {
    const { storage, closeNow } = closableStorage();
    let closeOnCheck = false;
    const { service, model } = setup({
      storage,
      chatCapabilities: async ({ chat }) => {
        if (closeOnCheck) await closeNow(chat.id);
        return {};
      },
    });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    closeOnCheck = true;
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "Ещё"), { voiceMode: true })).rejects.toBeInstanceOf(ChatClosedError);
    expect(model.doStreamCalls).toHaveLength(1);
    expect((await storage.listMessages(chat.id)).length).toBe(2);
  });

  it("служебное сообщение: чат закрыли в beforeTurn — сообщение без хода, резерв закрыт turnNotStarted", async () => {
    const { storage, closeNow } = closableStorage();
    const turnNotStarted = vi.fn<TurnNotStartedHandler>();
    let closeOnTurn = false;
    const beforeTurn: BeforeTurnHandler = async ({ chat }) => {
      if (closeOnTurn) await closeNow(chat.id);
    };
    const { service, model } = setup({ storage, beforeTurn, turnNotStarted });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    turnNotStarted.mockClear();
    closeOnTurn = true;
    const result = await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "готово")], wakeAgent: true, deliveryKey: "k1" });
    expect(result).toMatchObject({ status: "delivered", turnStarted: false });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(turnNotStarted).toHaveBeenCalledTimes(1);
    expect(turnNotStarted.mock.calls[0]![0]).toMatchObject({ action: "notice", reason: "chat_closed" });
  });

  it("403 и 409 до beforeTurn не зовут turnNotStarted: резерва ещё нет", async () => {
    const turnNotStarted = vi.fn<TurnNotStartedHandler>();
    const { chatCapabilities, state } = rights();
    const { service } = setup({ chatCapabilities, beforeTurn: () => undefined, turnNotStarted });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    turnNotStarted.mockClear();
    state.value = { voice: false };
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "Ещё"), { voiceMode: true })).rejects.toBeInstanceOf(ActionForbiddenError);
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    await expect(service.sendMessage("anna", chat.id, userMessage("u3", "Ещё"))).rejects.toBeInstanceOf(ChatClosedError);
    expect(turnNotStarted).not.toHaveBeenCalled();
  });
});

describe("закрытие из кода", () => {
  it("посреди хода: ход дописывается, дальше ходов нет, событие одно", async () => {
    let service!: ChatService;
    let chatId = "";
    const tools = {
      lookup: tool({
        description: "Справка",
        inputSchema: z.object({}),
        execute: async () => {
          await service.closeChat({ ownerId: "anna", chatId, ...CLOSURE });
          return "готово";
        },
      }),
    };
    const built = setup({ agent: { tools } }, [callTool("lookup", "c1"), saying("Ответ")]);
    service = built.service;
    const chat = await service.createChat("anna");
    chatId = chat.id;
    await answered(service, chat.id);
    const answer = (await built.storage.listMessages(chat.id)).at(-1)!;
    expect(answer.status).toBe("complete");
    expect(built.events.filter((event) => event.type === "chat-closed")).toHaveLength(1);
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "Ещё"))).rejects.toBeInstanceOf(ChatClosedError);
  });

  it("две вкладки закрывают одновременно: без ошибок, чат закрыт одним из закрытий", async () => {
    const { service, storage, events } = setup();
    const chat = await service.createChat("anna");
    const other = { code: "form_cancelled", message: "Заявка отменена." };
    await Promise.all([
      service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE }),
      service.closeChat({ ownerId: "anna", chatId: chat.id, ...other }),
    ]);
    expect([CLOSURE, other]).toContainEqual((await storage.getChat(chat.id))!.closed);
    expect(events.filter((event) => event.type === "chat-closed")).toHaveLength(2);
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "Привет"))).rejects.toBeInstanceOf(ChatClosedError);
  });
});

describe("закрытие побеждает паузу ждущего ответа", () => {
  /** Шаг модели с двумя вызовами сразу. */
  const callTwo = (first: string, second: string, secondInput: object = {}) => [
    streamStart,
    { type: "tool-call" as const, toolCallId: "c1", toolName: first, input: "{}" },
    { type: "tool-call" as const, toolCallId: "c2", toolName: second, input: JSON.stringify(secondInput) },
    finishPart("tool-calls"),
  ];

  const closingTool = (model: AgentToolsModel) =>
    tool({
      description: "Отправить заявку",
      inputSchema: z.object({}),
      execute: async () => {
        model.closeChat!(CLOSURE);
        return "отправлено";
      },
    });

  it("инструмент закрыл чат, а в том же шаге ждёт подтверждение: подтверждение — отказ, ответ законченный", async () => {
    const execute = vi.fn(async () => "удалено");
    const tools = (model: AgentToolsModel) => ({ finish_form: closingTool(model), remove: removeTool(execute) });
    const { service, storage } = setup({ agent: { tools } }, [callTwo("finish_form", "remove")]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-denied" });
    expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE);
    expect(execute).not.toHaveBeenCalled();
  });

  it("инструмент закрыл чат, а в том же шаге ждёт виджет: виджет закрыт ошибкой, ответ законченный", async () => {
    const tools = (model: AgentToolsModel) => ({ finish_form: closingTool(model) });
    const { service, storage } = setup({ agent: { tools, widgets: { custom: [pickSlot] } } }, [callTwo("finish_form", "pick_slot", { slots: ["10:00", "11:00"] })]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-pick_slot")).toMatchObject({ state: "output-error" });
  });

  it("закрытие из кода, пока ответ ждёт подтверждения: запрос — отказ; после reopenChat ответить нечего", async () => {
    const execute = vi.fn(async () => "удалено");
    const { service, storage } = setup({ agent: { tools: { remove: removeTool(execute) } } }, [callTool("remove", "c1")]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const waiting = (await storage.listMessages(chat.id)).at(-1)!;
    expect(waiting.status).toBe("awaiting_approval");
    const approvalId = (waiting.parts.find((part) => part.type === "tool-remove") as { approval: { id: string } }).approval.id;
    await service.closeChat({ ownerId: "anna", chatId: chat.id, ...CLOSURE });
    const closedAnswer = (await storage.listMessages(chat.id)).filter((message) => message.role === "assistant").at(-1)!;
    expect(closedAnswer.status).toBe("complete");
    expect(closedAnswer.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-denied" });
    await service.reopenChat({ ownerId: "anna", chatId: chat.id });
    await expect(service.answerApproval("anna", chat.id, approvalId, "allow")).rejects.toMatchObject({ name: "ApprovalNotPendingError" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("закрытие из кода посреди хода, ход кончился на паузе: запрос — отказ", async () => {
    let service!: ChatService;
    let chatId = "";
    const lookup = tool({
      description: "Справка",
      inputSchema: z.object({}),
      execute: async () => {
        await service.closeChat({ ownerId: "anna", chatId, ...CLOSURE });
        return "готово";
      },
    });
    const built = setup({ agent: { tools: { lookup, remove: removeTool() } } }, [callTwo("lookup", "remove")]);
    service = built.service;
    const chat = await service.createChat("anna");
    chatId = chat.id;
    await answered(service, chat.id);
    const answer = (await built.storage.listMessages(chat.id)).at(-1)!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-denied" });
  });
});

describe("закрытие из инструмента: запись и сбои", () => {
  /** Инструмент закрывает чат и ждёт «Стопа»: ход висит, пока тест не отпустит. */
  function hangingClosingTool(called: () => void) {
    return (model: AgentToolsModel) => ({
      finish_form: tool({
        description: "Отправить заявку",
        inputSchema: z.object({}),
        execute: async (_input, { abortSignal }) => {
          model.closeChat!(CLOSURE);
          called();
          await new Promise((resolve) => abortSignal?.addEventListener("abort", resolve));
          return "отправлено";
        },
      }),
    });
  }

  it("закрытие записано сразу при вызове: сервер упал посреди хода — после восстановления чат закрыт", async () => {
    let called!: () => void;
    const calledNow = new Promise<void>((resolve) => (called = resolve));
    const storage = createInMemoryChatStorage();
    const { service, events } = setup({ storage, agent: { tools: hangingClosingTool(() => called()) } }, [callTool("finish_form", "c1")]);
    const chat = await service.createChat("anna");
    void service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")).then(readAll);
    await calledNow;
    await vi.waitFor(async () => expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE));
    // Событие и кусок потока — только после записи ответа.
    expect(events.some((event) => event.type === "chat-closed")).toBe(false);
    // «Падение»: новая служба на той же базе поднимается и восстанавливает ответы.
    const restarted = noticeService(scriptedModel(), { storage }).service;
    await restarted.recoverInterruptedAnswers();
    expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE);
    await expect(restarted.sendMessage("anna", chat.id, userMessage("u2", "Ещё"))).rejects.toBeInstanceOf(ChatClosedError);
    await service.stop("anna", chat.id);
  });

  it("flush() ждёт закрытия из инструмента: после остановки событие уже ушло", async () => {
    let called!: () => void;
    const calledNow = new Promise<void>((resolve) => (called = resolve));
    const { service, storage, events } = setup({ agent: { tools: hangingClosingTool(() => called()) } }, [callTool("finish_form", "c1")]);
    const chat = await service.createChat("anna");
    void service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")).then(readAll);
    await calledNow;
    await service.flush({ waitForAnswersMs: 0 });
    expect((await storage.getChat(chat.id))!.closed).toEqual(CLOSURE);
    expect(events.filter((event) => event.type === "chat-closed")).toHaveLength(1);
  });

  it("сбой копии закрытия (setChatClosed): чат всё равно закрыт записью в ответе, строка в журнал", async () => {
    const logError = vi.fn();
    const storage = createInMemoryChatStorage();
    storage.setChatClosed = vi.fn(async () => {
      throw new Error("база недоступна");
    });
    const tools = (model: AgentToolsModel) => ({
      finish_form: tool({
        description: "Отправить заявку",
        inputSchema: z.object({}),
        execute: async () => {
          model.closeChat!(CLOSURE);
          return "отправлено";
        },
      }),
    });
    const { service, events } = setup({ storage, logError, agent: { tools } }, [callTool("finish_form", "c1"), saying("Готово")]);
    const chat = await service.createChat("anna");
    const chunks: UIMessageChunk[] = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(chunks.some((chunk) => chunk.type === CHAT_CLOSED_PART_TYPE)).toBe(true);
    expect((await storage.listMessages(chat.id)).at(-1)!.status).toBe("complete");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("Копия закрытия"));
    expect(events.some((event) => event.type === "chat-closed")).toBe(true);
    expect((await service.getHistory("anna", chat.id)).chat.closed).toEqual(CLOSURE);
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "Ещё"))).rejects.toBeInstanceOf(ChatClosedError);
  });
});

describe("создание чата: хук приложения beforeCreateChat", () => {
  it("отказ — ChatCreationRefusedError с кодом и текстом, чат не создан", async () => {
    const calls: unknown[] = [];
    const { service, storage } = setup({
      beforeCreateChat: (input) => {
        calls.push(input);
        return { code: "one_chat_only", message: "У вас уже есть чат." };
      },
    });
    const failure = await service.createChat("anna", { origin: "telegram" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatCreationRefusedError);
    expect(failure).toMatchObject({ code: "one_chat_only", message: "У вас уже есть чат." });
    expect(calls).toEqual([{ userId: "anna", origin: "telegram" }]);
    expect(await storage.listChats("anna")).toEqual([]);
  });

  it("пропуск — чат создан; из веба origin нет", async () => {
    const calls: unknown[] = [];
    const { service } = setup({ beforeCreateChat: async (input) => void calls.push(input) });
    const chat = await service.createChat("anna");
    expect(chat.ownerId).toBe("anna");
    expect(calls).toEqual([{ userId: "anna" }]);
  });

  it("неверный отказ — TypeError и строка в журнал; чат объекта приложения хук не спрашивает", async () => {
    const logError = vi.fn();
    const beforeCreateChat = vi.fn(() => ({ code: "Плохой Код", message: "x" }));
    const { service } = setup({ beforeCreateChat, logError });
    await expect(service.createChat("anna")).rejects.toBeInstanceOf(TypeError);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("beforeCreateChat"));
    beforeCreateChat.mockClear();
    await service.openSubjectChat({ ownerId: "anna", key: "lesson-1" });
    expect(beforeCreateChat).not.toHaveBeenCalled();
  });
});

describe("список чатов: закрытие", () => {
  it("listChats отдаёт closed у закрытого чата, у открытого поля нет", async () => {
    const { service } = setup();
    const open = await service.createChat("anna");
    const closed = await service.createChat("anna");
    await service.closeChat({ ownerId: "anna", chatId: closed.id, ...CLOSURE });
    const list = await service.listChats("anna");
    expect(list.find((item) => item.id === closed.id)!.closed).toEqual(CLOSURE);
    expect(list.find((item) => item.id === open.id)).not.toHaveProperty("closed");
  });
});
