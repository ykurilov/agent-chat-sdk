import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel, ChatEvent, StateChangedHandler, StateChangedInput } from "../../src/index";
import { newStoredMessage } from "../../src/conversation/types";
import type { AgentChatMessage } from "../../src/conversation/types";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockModel, readAll, streamOf } from "./support/mock-model";
import { callTool, noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

const writeTool = (model: AgentToolsModel) => ({
  write: tool({
    description: "Записать поле",
    inputSchema: z.object({ field: z.string(), value: z.string() }),
    execute: async ({ field, value }) => {
      model.state!.set(`fields.${field}`, value);
      return "записано";
    },
  }),
  close_form: tool({
    description: "Закрыть заявку",
    inputSchema: z.object({}),
    execute: async () => {
      model.closeChat!({ code: "form_sent", message: "Заявка отправлена" });
      return "закрыто";
    },
  }),
});

function setup(scripts: Parameters<typeof scriptedModel>[0], extra: Parameters<typeof noticeService>[1] = {}) {
  const calls: StateChangedInput[] = [];
  const onStateChanged: StateChangedHandler = (input) => {
    calls.push(input);
  };
  const events: ChatEvent[] = [];
  const built = noticeService(scriptedModel(scripts), { onStateChanged, agent: { tools: writeTool }, ...extra });
  built.service.subscribeEvents((event) => events.push(event));
  return { ...built, calls, events };
}

const write = (field: string, value: string, id = `w-${field}-${value}`) => callTool("write", id, { field, value });

async function send(service: ReturnType<typeof setup>["service"], chatId: string, id: string, text = "запиши") {
  return readAll(await service.sendMessage("anna", chatId, userMessage(id, text)));
}

describe("onStateChanged: после хода", () => {
  it("ход записал состояние — хук с reason turn, «до» и «после» без служебных ключей; вкладке — событие state-changed", async () => {
    const { service, calls, events } = setup([write("email", "a@x.ru"), saying("Записал")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const state = await service.getChatState("anna", chat.id);
    expect(calls[0]).toEqual({
      ownerId: "anna",
      chatId: chat.id,
      reason: "turn",
      state: { fields: { email: "a@x.ru" } },
      previousState: {},
      atMessageId: state.atMessageId,
    });
    expect(events.filter((event) => event.type === "state-changed")).toEqual([
      { type: "state-changed", ownerId: "anna", chatId: chat.id, reason: "turn", state: { fields: { email: "a@x.ru" } }, atMessageId: state.atMessageId },
    ]);
  });

  it("ход ничего не записал — хука и события нет", async () => {
    const { service, calls, events } = setup([saying("Привет")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "привет");
    await service.flush();
    expect(calls).toEqual([]);
    expect(events.some((event) => event.type === "state-changed")).toBe(false);
  });

  it("закрытие из инструмента меняет только служебный ключ — хук не зовётся", async () => {
    const { service, calls } = setup([callTool("close_form", "c1"), saying("Готово")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await service.flush();
    expect(calls).toEqual([]);
    expect((await service.getHistory("anna", chat.id)).chat.closed).toMatchObject({ code: "form_sent" });
  });
});

describe("onStateChanged: смена ветки", () => {
  it("правка, выбор ветки и «Переделать» — свои причины, состояние новой ветки", async () => {
    const { service, calls } = setup([write("email", "a@x.ru"), saying("Записал"), saying("Без почты"), saying("Снова без")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1-edit", "почты нет")));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ reason: "editMessage", state: {}, previousState: { fields: { email: "a@x.ru" } } });

    await service.selectBranch("anna", chat.id, "u1");
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]).toMatchObject({ reason: "selectBranch", state: { fields: { email: "a@x.ru" } }, previousState: {} });

    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    await readAll(await service.regenerate("anna", chat.id, answer.id));
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[3]).toMatchObject({ reason: "regenerate", state: {}, previousState: { fields: { email: "a@x.ru" } } });
  });

  it("editAnswer переносит записи — состояние то же, хука нет", async () => {
    const { service, calls } = setup([write("email", "a@x.ru"), saying("Записал")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    await service.editAnswer("anna", chat.id, answer.id, { text: "Записал почту." });
    await service.flush();
    expect(calls).toHaveLength(1);
  });
});

describe("onStateChanged: сбои и остановка", () => {
  it("хук упал все попытки — logError и событие state-changed-failed; ход цел", async () => {
    const logError = vi.fn();
    const handler = vi.fn(async () => {
      throw new Error("база приложения недоступна");
    });
    const { service, events, storage } = setup([write("email", "a@x.ru"), saying("Записал")], {
      onStateChanged: handler,
      onStateChangedAttempts: 2,
      logError,
    });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await vi.waitFor(() => expect(events.some((event) => event.type === "state-changed-failed")).toBe(true), { timeout: 5000 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("onStateChanged"));
    expect(events.find((event) => event.type === "state-changed-failed")).toEqual({ type: "state-changed-failed", ownerId: "anna", chatId: chat.id });
    expect((await storage.listMessages(chat.id)).at(-1)!.status).toBe("complete");
  });

  it("неверные пределы — TypeError при создании службы", () => {
    expect(() => noticeService(scriptedModel(), { onStateChanged: () => {}, onStateChangedAttempts: 0 })).toThrow(TypeError);
    expect(() => noticeService(scriptedModel(), { onStateChanged: () => {}, onStateChangedTimeoutMs: -1 })).toThrow(TypeError);
  });

  it("flush ждёт идущий хук", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const finished: string[] = [];
    let started = false;
    const { service } = setup([write("email", "a@x.ru"), saying("Записал")], {
      onStateChanged: async () => {
        started = true;
        await held;
        finished.push("хук");
      },
    });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await vi.waitFor(() => expect(started).toBe(true));
    const flushing = service.flush().then(() => finished.push("flush"));
    release();
    await flushing;
    expect(finished).toEqual(["хук", "flush"]);
  });

  it("после flush хук и событие снова идут: flush — не только остановка сервера", async () => {
    const { service, calls, events } = setup([write("email", "a@x.ru"), saying("Записал"), write("phone", "+7"), saying("Записал")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await service.flush();
    expect(calls).toHaveLength(1);
    await send(service, chat.id, "u2");
    await service.flush();
    expect(calls.map((call) => call.state)).toEqual([{ fields: { email: "a@x.ru" } }, { fields: { email: "a@x.ru", phone: "+7" } }]);
    expect(events.filter((event) => event.type === "state-changed")).toHaveLength(2);
  });

  it("чат удалён во время хода: хук не зовётся с пустым состоянием удалённого чата, журнал чист", async () => {
    const calls: StateChangedInput[] = [];
    const errors: string[] = [];
    let call = 0;
    let hanging!: () => void;
    const thirdOpened = new Promise<void>((resolve) => (hanging = resolve));
    // Третий ответ модели висит, пока ход не остановят.
    const model = mockModel(({ abortSignal }) => {
      call++;
      if (call === 1) return streamOf(write("a", "1"));
      if (call === 2) return streamOf(saying("Записал"));
      return new ReadableStream({
        start(controller) {
          abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          hanging();
        },
      });
    });
    // Хвост хода читает состояние медленнее, чем идёт удаление: так бывает с базой по сети.
    const storage = createInMemoryChatStorage();
    const readParts = storage.listMessagePartsOfTypes!.bind(storage);
    const reads: Promise<unknown>[] = [];
    storage.listMessagePartsOfTypes = (...args) => {
      const reading = new Promise((resolve) => setTimeout(resolve, 20)).then(() => readParts(...args));
      reads.push(reading);
      return reading;
    };
    const { service } = noticeService(model, { onStateChanged: (input) => void calls.push(input), agent: { tools: writeTool }, logError: (message) => void errors.push(message), storage });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
    await thirdOpened;
    await service.deleteChat("anna", chat.id);
    await reading.catch(() => {});
    // Все чтения хвоста хода закончились, и он успел разослать, что прочитал.
    await Promise.all(reads);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe("состояние ветки читается без текстов сообщений", () => {
  it("getChatState и проверка закрытия при отправке не зовут listMessages, если есть listMessagePartsOfTypes", async () => {
    const storage = createInMemoryChatStorage();
    const { service } = setup([write("email", "a@x.ru"), saying("Записал")], { storage });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    const listMessages = vi.spyOn(storage, "listMessages");
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ fields: { email: "a@x.ru" } });
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("хранилище без listMessagePartsOfTypes — то же состояние через listMessages", async () => {
    const storage = createInMemoryChatStorage();
    delete (storage as { listMessagePartsOfTypes?: unknown }).listMessagePartsOfTypes;
    const { service } = setup([write("email", "a@x.ru"), saying("Записал")], { storage });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1");
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ fields: { email: "a@x.ru" } });
  });
});

describe("служебные ключи не уходят в браузер", () => {
  const reservedRecord = { set: { $closed: { code: "done", message: "Закрыт" }, "fields.name": "Анна" }, unset: ["$draft", "fields.old"] };

  it("история: из частей data-app-state убраны $-ключи, служебное сообщение без частей не отдаётся", async () => {
    const { service, storage } = setup([saying("Привет")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "привет");
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    await storage.insertMessage(
      newStoredMessage({ id: "s1", chatId: chat.id, parentId: answer.id, role: "user", parts: [{ type: "data-app-state", data: reservedRecord }] as AgentChatMessage["parts"] }),
    );
    await storage.insertMessage(
      newStoredMessage({
        id: "s2",
        chatId: chat.id,
        parentId: "s1",
        role: "user",
        parts: [{ type: "data-app-state", data: { unset: ["$closed"] } }] as AgentChatMessage["parts"],
      }),
    );
    for (const history of [await service.getHistory("anna", chat.id), await service.peekHistory("anna", chat.id)]) {
      expect(history.messages.map((message) => message.id)).toEqual(["u1", answer.id, "s1"]);
      expect(history.messages[2]!.parts).toEqual([{ type: "data-app-state", data: { set: { "fields.name": "Анна" }, unset: ["fields.old"] } }]);
      expect(JSON.stringify(history)).not.toContain("$closed");
    }
  });

  it("поток хода: $-ключи вычищены, запись только со служебными ключами не уходит; в хранилище — как есть", async () => {
    const { service, storage } = setup([callTool("close_form", "c1"), write("email", "a@x.ru"), saying("Готово")]);
    const chat = await service.createChat("anna");
    const chunks: UIMessageChunk[] = await send(service, chat.id, "u1");
    const stateChunks = chunks.filter((chunk) => chunk.type === "data-app-state");
    expect(stateChunks).toEqual([{ type: "data-app-state", data: { set: { "fields.email": "a@x.ru" } } }]);
    expect(JSON.stringify(chunks)).not.toContain("$closed");
    const stored = (await storage.listMessages(chat.id)).at(-1)!;
    expect(JSON.stringify(stored.parts)).toContain("$closed");
  });
});
