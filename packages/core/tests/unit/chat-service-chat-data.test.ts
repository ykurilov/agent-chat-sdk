import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { ChatNotFoundError } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { Chat } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { AfterTurnHandler, BeforeTurnHandler } from "../../src/turn-hooks/turn-hooks";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const formData = { formId: "f1", mode: "test", source: "telegram" };

function toolThenTextModel() {
  const scripts: LanguageModelV4StreamPart[][] = [
    [streamStart, { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: "{}" }, finishPart("tool-calls")],
    [streamStart, ...textParts(["Ответ"]), finishPart()],
  ];
  let call = 0;
  return mockModel(() => streamOf(scripts[call++ % scripts.length]!));
}

function setup(extra: Partial<ChatServiceOptions> = {}) {
  const storage = extra.storage ?? createInMemoryChatStorage();
  const model = toolThenTextModel();
  const seen: AgentToolsModel[] = [];
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: {
      instructions: "Ты помощник.",
      tools: (toolsModel) => ({
        lookup: tool({
          description: "Справка",
          inputSchema: z.object({}),
          execute: async () => {
            seen.push(toolsModel);
            return "справка";
          },
        }),
      }),
    },
    env: mockEnv,
    logError: vi.fn(),
    ...extra,
  });
  return { service, storage, model, seen };
}

async function ask(service: ReturnType<typeof setup>["service"], chatId: string, text = "Привет") {
  return readAll(await service.sendMessage("anna", chatId, { id: `u-${crypto.randomUUID()}`, role: "user", parts: [{ type: "text", text }] }));
}

describe("данные чата: создание и чтение", () => {
  it("createChat с data: чат обычный (без ключа объекта), данные записаны; subjectData — тот же объект", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna", { data: formData });
    expect(chat).toMatchObject({ ownerId: "anna", data: formData, subjectData: formData });
    expect(chat).not.toHaveProperty("subjectKey");
    expect(await storage.getChat(chat.id)).toMatchObject({ data: formData });
    // Обычный чат — виден в списке без флагов.
    expect((await service.listChats("anna")).map((item) => item.id)).toEqual([chat.id]);
  });

  it("createChat с data и приветствием: данные у чата с приветствием тоже", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna", { data: formData, greeting: { text: "Здравствуйте!" } });
    expect((await storage.getChat(chat.id))?.data).toEqual(formData);
    expect(await storage.listMessages(chat.id)).toHaveLength(1);
  });

  it("openSubjectChat с data: данные видны и как data, и как subjectData", async () => {
    const { service } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", data: { lessonId: 1 } });
    expect(chat).toMatchObject({ data: { lessonId: 1 }, subjectData: { lessonId: 1 } });
  });

  it("data не JSON-объект или больше 16 КБ — TypeError, чат не создан", async () => {
    const { service, storage } = setup();
    await expect(service.createChat("anna", { data: [] as unknown as Record<string, unknown> })).rejects.toBeInstanceOf(TypeError);
    await expect(service.createChat("anna", { data: { text: "я".repeat(9000) } })).rejects.toBeInstanceOf(TypeError);
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
  });

  it("getHistory: данные чата в браузер не уходят ни как data, ни как subjectData", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna", { data: formData });
    const history = await service.getHistory("anna", chat.id);
    expect(history.chat).not.toHaveProperty("data");
    expect(history.chat).not.toHaveProperty("subjectData");
  });
});

describe("данные чата: чтение без записи (getChatData)", () => {
  it("отдаёт данные копией и ничего не пишет; без данных — {}", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna", { data: formData });
    const update = vi.spyOn(storage, "updateChatData");
    const events: ChatEvent[] = [];
    service.subscribeEvents((event) => events.push(event));
    const data = await service.getChatData("anna", chat.id);
    expect(data).toEqual(formData);
    data.formId = "испорчено";
    expect((await storage.getChat(chat.id))?.data).toEqual(formData);
    expect(update).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    const empty = await service.createChat("anna");
    expect(await service.getChatData("anna", empty.id)).toEqual({});
  });

  it("чужой и несуществующий чат — ChatNotFoundError", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna", { data: formData });
    await expect(service.getChatData("boris", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.getChatData("anna", "missing")).rejects.toBeInstanceOf(ChatNotFoundError);
  });
});

describe("данные чата: правка", () => {
  it("updateChatData сливает верхние ключи и возвращает итог; хранилище получает его", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna", { data: formData });
    const data = await service.updateChatData("anna", chat.id, { utm: { campaign: "autumn" }, mode: "live" });
    expect(data).toEqual({ formId: "f1", mode: "live", source: "telegram", utm: { campaign: "autumn" } });
    expect((await storage.getChat(chat.id))?.data).toEqual(data);
  });

  it("ключ со значением undefined удаляется", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna", { data: formData });
    expect(await service.updateChatData("anna", chat.id, { source: undefined })).toEqual({ formId: "f1", mode: "test" });
  });

  it("чужой и несуществующий чат — ChatNotFoundError, ничего не записано", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna", { data: formData });
    await expect(service.updateChatData("boris", chat.id, { a: 1 })).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.updateChatData("anna", "missing", { a: 1 })).rejects.toBeInstanceOf(ChatNotFoundError);
    expect((await storage.getChat(chat.id))?.data).toEqual(formData);
  });

  it("патч не объект или итог больше 16 КБ — TypeError, данные не изменены", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna", { data: { keep: "я".repeat(5000) } });
    await expect(service.updateChatData("anna", chat.id, null as unknown as Record<string, unknown>)).rejects.toBeInstanceOf(TypeError);
    await expect(service.updateChatData("anna", chat.id, { more: "я".repeat(5000) })).rejects.toBeInstanceOf(TypeError);
    expect((await storage.getChat(chat.id))?.data).toEqual({ keep: "я".repeat(5000) });
  });

  it("ключ __proto__ в данных, правке и фильтре — TypeError с понятным текстом, ничего не записано", async () => {
    const { service, storage } = setup();
    const withProto = () => JSON.parse('{"__proto__":{"admin":true},"mode":"x"}') as Record<string, unknown>;
    await expect(service.createChat("anna", { data: withProto() })).rejects.toThrow(/__proto__/);
    expect(await storage.listChats("anna")).toEqual([]);
    const chat = await service.createChat("anna", { data: formData });
    await expect(service.updateChatData("anna", chat.id, withProto())).rejects.toThrow(/__proto__/);
    await expect(service.listChats("anna", { data: JSON.parse('{"__proto__":1}') as never })).rejects.toThrow(/__proto__/);
    expect((await storage.getChat(chat.id))?.data).toEqual(formData);
  });

  it("символ NUL в данных, правке и фильтре — TypeError: PostgreSQL такие данные не читает, отказ одинаков везде", async () => {
    const { service, storage } = setup();
    await expect(service.createChat("anna", { data: { note: "a\u0000b" } })).rejects.toThrow(/NUL/);
    await expect(service.openSubjectChat({ ownerId: "anna", key: "lesson:1", data: { ["k\u0000"]: 1 } })).rejects.toThrow(/NUL/);
    expect(await storage.listChats("anna")).toEqual([]);
    const chat = await service.createChat("anna", { data: formData });
    await expect(service.updateChatData("anna", chat.id, { deep: { list: ["\u0000"] } })).rejects.toThrow(/NUL/);
    await expect(service.listChats("anna", { data: { mode: "\u0000" } })).rejects.toThrow(/NUL/);
    expect((await storage.getChat(chat.id))?.data).toEqual(formData);
  });

  it("хранилище без updateChatData: понятная ошибка", async () => {
    const base = createInMemoryChatStorage();
    const { updateChatData: _unused, ...withoutUpdate } = base;
    const { service } = setup({ storage: withoutUpdate as ChatStorage });
    const chat = await service.createChat("anna");
    await expect(service.updateChatData("anna", chat.id, { a: 1 })).rejects.toThrow(/updateChatData/);
  });

  it("createChat с data на хранилище без updateChatData: та же понятная ошибка, чат не создан, данные не теряются молча", async () => {
    const base = createInMemoryChatStorage();
    const { updateChatData: _unused, ...withoutUpdate } = base;
    const { service } = setup({ storage: withoutUpdate as ChatStorage });
    await expect(service.createChat("anna", { data: formData })).rejects.toThrow(/updateChatData/);
    expect(await base.listChats("anna")).toEqual([]);
    await expect(service.createChat("anna")).resolves.toBeDefined();
  });

  it("событие chat-data-changed: после записи, без самих данных; при отказе события нет", async () => {
    const { service } = setup();
    const events: ChatEvent[] = [];
    service.subscribeEvents((event) => events.push(event));
    const chat = await service.createChat("anna", { data: formData });
    await expect(service.updateChatData("anna", chat.id, { text: "я".repeat(9000) })).rejects.toBeInstanceOf(TypeError);
    expect(events).toEqual([]);
    await service.updateChatData("anna", chat.id, { mode: "live" });
    expect(events).toEqual([{ type: "chat-data-changed", ownerId: "anna", chatId: chat.id }]);
  });
});

describe("данные чата: список", () => {
  it("listChats с data отдаёт только подходящие чаты; без data — все", async () => {
    const { service } = setup();
    const test = await service.createChat("anna", { data: { formId: "f1", mode: "test" } });
    await service.createChat("anna", { data: { formId: "f1", mode: "live" } });
    await service.createChat("anna");
    expect((await service.listChats("anna", { data: { formId: "f1", mode: "test" } })).map((item) => item.id)).toEqual([test.id]);
    expect(await service.listChats("anna")).toHaveLength(3);
  });

  it("фильтр сочетается с subjects", async () => {
    const { service } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "form:1", data: { formId: "f1" } });
    await service.createChat("anna", { data: { formId: "f1" } });
    expect(await service.listChats("anna", { data: { formId: "f1" } })).toHaveLength(1);
    expect((await service.listChats("anna", { data: { formId: "f1" }, subjects: "only" })).map((item) => item.id)).toEqual([chat.id]);
  });

  it("значение-объект в фильтре — TypeError; хранилище без updateChatData — понятная ошибка", async () => {
    const { service } = setup();
    await expect(service.listChats("anna", { data: { utm: { a: 1 } } as never })).rejects.toBeInstanceOf(TypeError);
    const base = createInMemoryChatStorage();
    const { updateChatData: _unused, ...withoutUpdate } = base;
    const old = setup({ storage: withoutUpdate as ChatStorage });
    await expect(old.service.listChats("anna", { data: { a: 1 } })).rejects.toThrow(/updateChatData/);
  });
});

describe("данные чата: кто их видит на ходе", () => {
  it("инструмент видит model.chat.data на всех шагах; у чата без данных поле data не задано", async () => {
    const { service, seen } = setup();
    const chat = await service.createChat("anna", { data: formData });
    await ask(service, chat.id);
    const plain = await service.createChat("anna");
    await ask(service, plain.id);
    expect(seen[0]!.chat).toEqual({ data: formData });
    expect(seen[1]!.chat).toEqual({});
    expect("data" in seen[1]!.chat!).toBe(false);
  });

  it("beforeTurn и chatInstructions получают чат с data", async () => {
    const chats: Chat[] = [];
    const beforeTurn: BeforeTurnHandler = ({ chat }) => {
      chats.push(chat);
    };
    const instructionChats: Chat[] = [];
    const chatInstructions = async (chat: Chat) => {
      instructionChats.push(chat);
      return `Форма ${String(chat.data?.formId)}`;
    };
    const { service } = setup({ beforeTurn, chatInstructions });
    const chat = await service.createChat("anna", { data: formData });
    await ask(service, chat.id);
    expect(chats[0]!.data).toEqual(formData);
    expect(instructionChats[0]!.data).toEqual(formData);
  });

  it("afterTurn получает turn.chatData; у чата без данных поля нет", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service } = setup({ afterTurn });
    const chat = await service.createChat("anna", { data: formData });
    await ask(service, chat.id);
    const plain = await service.createChat("anna");
    await ask(service, plain.id);
    expect(afterTurn.mock.calls[0]![0].chatData).toEqual(formData);
    expect("chatData" in afterTurn.mock.calls[1]![0]).toBe(false);
  });

  it("итог, доделанный после перезапуска, тоже получает chatData", async () => {
    const storage = createInMemoryChatStorage();
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock", data: formData });
    await storage.insertMessage(newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "Привет" }] }));
    await storage.insertMessage(
      newStoredMessage({
        id: "a1",
        chatId: "c1",
        parentId: "u1",
        role: "assistant",
        parts: [{ type: "text", text: "Начало", state: "done" }],
        modelId: mockModelId,
        providerId: "mock",
        createdAt: "2026-03-01T10:00:00.000Z",
        status: "complete",
        afterTurn: "pending",
      }),
    );
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service } = setup({ storage, afterTurn });
    await service.recoverInterruptedAnswers();
    await vi.waitFor(() => expect(afterTurn).toHaveBeenCalledTimes(1));
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ recovered: true, chatData: formData });
  });

  /** Инструмент, который посреди хода меняет данные чата: `afterTurn` должен увидеть их на момент итога. */
  function changingDataTools(service: () => ReturnType<typeof setup>["service"], patch: Record<string, unknown>, before?: () => void) {
    return {
      instructions: "Ты помощник.",
      tools: (toolsModel: AgentToolsModel) => ({
        lookup: tool({
          description: "Справка",
          inputSchema: z.object({}),
          execute: async () => {
            await service().updateChatData("anna", toolsModel.chatId, patch);
            before?.();
            return "справка";
          },
        }),
      }),
    };
  }

  it("afterTurn получает данные на момент итога: правка посреди хода видна", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const holder: { service?: ReturnType<typeof setup>["service"] } = {};
    const { service } = setup({ afterTurn, agent: changingDataTools(() => holder.service!, { mode: "live" }) });
    holder.service = service;
    const chat = await service.createChat("anna", { data: formData });
    await ask(service, chat.id);
    expect(afterTurn.mock.calls[0]![0].chatData).toEqual({ ...formData, mode: "live" });
  });

  it("не прочитались данные на момент итога: afterTurn получает данные начала хода, сбой — в logError", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const logError = vi.fn();
    const base = createInMemoryChatStorage();
    let failReads = false;
    const storage: ChatStorage = Object.create(base, {
      getChat: {
        value: async (chatId: string) => {
          if (failReads) throw new Error("база недоступна");
          return base.getChat(chatId);
        },
      },
    });
    const holder: { service?: ReturnType<typeof setup>["service"] } = {};
    const { service } = setup({ storage, afterTurn, logError, agent: changingDataTools(() => holder.service!, { mode: "live" }, () => void (failReads = true)) });
    holder.service = service;
    const chat = await service.createChat("anna", { data: formData });
    await ask(service, chat.id);
    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(afterTurn.mock.calls[0]![0].chatData).toEqual(formData);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });

  it("новое значение после updateChatData инструмент видит со следующего хода", async () => {
    const { service, seen } = setup();
    const chat = await service.createChat("anna", { data: formData });
    await ask(service, chat.id);
    await service.updateChatData("anna", chat.id, { mode: "live" });
    await ask(service, chat.id, "Ещё");
    expect(seen[0]!.chat!.data!.mode).toBe("test");
    expect(seen[1]!.chat!.data!.mode).toBe("live");
  });

  it("запрос к модели в чате с данными тот же, что в обычном: данные модели не уходят", async () => {
    const plain = setup();
    const plainChat = await plain.service.createChat("anna");
    await ask(plain.service, plainChat.id);
    const withData = setup();
    const chat = await withData.service.createChat("anna", { data: { secret: "тайна-формы" } });
    await ask(withData.service, chat.id);
    const requests = (model: ReturnType<typeof setup>["model"], chatId: string) =>
      JSON.stringify(model.doStreamCalls.map(({ prompt, tools, providerOptions }) => ({ prompt, tools, providerOptions }))).replaceAll(chatId, "CHAT");
    expect(requests(withData.model, chat.id)).toBe(requests(plain.model, plainChat.id));
    expect(requests(withData.model, chat.id)).not.toContain("тайна-формы");
  });
});
