import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatEvents } from "../../src/chat-events/chat-events";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { createChatService } from "../../src/chat-service";
import type { ChatService, ChatServiceOptions } from "../../src/chat-service";
import { FROZEN_CONTEXT_PART_TYPE } from "../../src/frozen-context/context-blocks";
import { newStoredMessage } from "../../src/conversation/types";
import type { StoredMessage } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { AfterTurnHandler, TurnResult } from "../../src/turn-hooks/turn-hooks";
import { onFakeClock } from "./support/fake-clock";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const price = { inputPerMillion: 1, outputPerMillion: 2 };

/** Модель: на каждый вызов следующий сценарий; после списка — «Ответ». */
function scriptedModel(scripts: LanguageModelV4StreamPart[][] = []) {
  let call = 0;
  return mockModel(() => streamOf(scripts[call++] ?? [streamStart, ...textParts(["Ответ"]), finishPart()]));
}

function setup(extra: Partial<ChatServiceOptions> & { model?: ReturnType<typeof scriptedModel>; priced?: boolean } = {}) {
  const { model = scriptedModel(), priced, ...options } = extra;
  const storage = options.storage ?? createInMemoryChatStorage();
  const chatEvents = createChatEvents();
  const events: ChatEvent[] = [];
  chatEvents.subscribe((event) => events.push(event));
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }, priced ? { pricing: price } : {}),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    chatEvents,
    logError,
    ...options,
  });
  return { storage, service, model, events, logError };
}

async function ask(service: ChatService, text = "Привет", chatId?: string) {
  const id = chatId ?? (await service.createChat("anna")).id;
  const chunks = await readAll(await service.sendMessage("anna", id, userMessage(`u-${crypto.randomUUID()}`, text)));
  return { chatId: id, chunks };
}

async function lastAnswer(storage: ChatStorage, chatId: string): Promise<StoredMessage> {
  return (await storage.listMessages(chatId)).filter((message) => message.role === "assistant").at(-1)!;
}

const appEventChunks = (chunks: UIMessageChunk[]) => chunks.filter((chunk) => chunk.type === "data-app-event");

describe("afterTurn: итог хода для приложения", () => {
  it("хук получает итог хода: текст, части, расход, цену, кто и откуда", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service, storage } = setup({ afterTurn, priced: true });
    const { chatId } = await ask(service);
    const answer = await lastAnswer(storage, chatId);

    expect(afterTurn).toHaveBeenCalledTimes(1);
    const result = afterTurn.mock.calls[0]![0];
    expect(result).toEqual({
      ownerId: "anna",
      actorId: "anna",
      chatId,
      messageId: answer.id,
      status: "complete",
      text: "Ответ",
      // Служебная часть с блоками контекста приложению не отдаётся (R3).
      parts: answer.parts.filter((part) => part.type !== FROZEN_CONTEXT_PART_TYPE),
      usage: answer.usage,
      costUsd: expect.any(Number),
      trigger: "send",
      channel: "web",
      recovered: false,
    } satisfies TurnResult);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(answer.afterTurn).toBe("done");
  });

  it("у модели без цены costUsd — null", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service } = setup({ afterTurn });
    await ask(service);
    expect(afterTurn.mock.calls[0]![0].costUsd).toBeNull();
  });

  it("ход ждёт хук: итог уже записан с pending, а finish клиенту и свободный чат — только после хука", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let called!: () => void;
    const hookCalled = new Promise<void>((resolve) => (called = resolve));
    const { service, storage } = setup({
      afterTurn: async () => {
        called();
        await gate;
        return { events: [{ type: "lesson_passed", data: { lesson: 3 } }] };
      },
    });
    const chat = await service.createChat("anna");
    const chunks: UIMessageChunk[] = [];
    const reading = (async () => {
      for await (const chunk of await service.sendMessage("anna", chat.id, userMessage("u1", "зачёт"))) chunks.push(chunk);
    })();
    await hookCalled;

    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "complete", afterTurn: "pending" });
    expect(chunks.some((chunk) => chunk.type === "finish" || chunk.type === "message-metadata")).toBe(false);
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "ещё"))).rejects.toThrow();

    release();
    await reading;
    const types = chunks.map((chunk) => chunk.type);
    expect(types.indexOf("data-app-event")).toBeLessThan(types.lastIndexOf("message-metadata"));
    expect(types.at(-1)).toBe("finish");
    expect(appEventChunks(chunks)).toEqual([{ type: "data-app-event", data: { type: "lesson_passed", data: { lesson: 3 } } }]);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "свободен")));
  });

  it("события хука лежат в ответе после перезагрузки, а модели не уходят: запрос побайтно как без них", async () => {
    const withEvents = setup({ afterTurn: () => ({ events: [{ type: "lesson_passed", data: { score: 5 } }] }) });
    const withoutEvents = setup({ afterTurn: () => {} });
    for (const { service } of [withEvents, withoutEvents]) {
      const { chatId } = await ask(service, "первый");
      await ask(service, "второй", chatId);
    }
    const history = await withEvents.service.getHistory("anna", (await withEvents.service.listChats("anna"))[0]!.id);
    const firstAnswer = history.messages.find((message) => message.role === "assistant")!;
    expect(firstAnswer.parts.at(-1)).toEqual({ type: "data-app-event", data: { type: "lesson_passed", data: { score: 5 } } });

    const prompt = (setupResult: typeof withEvents) => JSON.stringify(setupResult.model.doStreamCalls[1]!.prompt);
    expect(prompt(withEvents)).toBe(prompt(withoutEvents));
  });

  it("без afterTurn состояние хука не пишется, а поток тот же, что у хука без событий", async () => {
    const plain = setup();
    const setAfterTurnState = vi.spyOn(plain.storage, "setAfterTurnState");
    const { chatId, chunks } = await ask(plain.service);
    expect((await lastAnswer(plain.storage, chatId)).afterTurn ?? null).toBeNull();
    expect(setAfterTurnState).not.toHaveBeenCalled();

    const hooked = setup({ afterTurn: () => {} });
    const hookedChunks = (await ask(hooked.service)).chunks;
    expect(hookedChunks.map((chunk) => chunk.type)).toEqual(chunks.map((chunk) => chunk.type));
  });

  it("хранилище без состояния хука и afterTurn — понятная ошибка при создании службы", () => {
    const { setAfterTurnState: _set, listPendingAfterTurn: _list, ...storage } = createInMemoryChatStorage();
    expect(() => setup({ storage, afterTurn: () => {} })).toThrow(/хранилище не помнит состояние хука итога/);
    expect(() => setup({ storage })).not.toThrow();
  });

  it("неверные пределы хука — ошибка при создании службы", () => {
    expect(() => setup({ afterTurn: () => {}, afterTurnTimeoutMs: 0 })).toThrow(TypeError);
    expect(() => setup({ afterTurn: () => {}, afterTurnAttempts: 0 })).toThrow(TypeError);
  });

  it("сбой хука повторяется с паузами; удачная попытка — done", async () => {
    let calls = 0;
    const { service, storage, events } = setup({
      afterTurn: () => {
        calls += 1;
        if (calls < 3) throw new Error("база приложения лежит");
        return { events: [{ type: "ok" }] };
      },
    });
    const { chatId, chunks } = await onFakeClock(() => ask(service));
    expect(calls).toBe(3);
    expect(appEventChunks(chunks)).toHaveLength(1);
    expect((await lastAnswer(storage, chatId)).afterTurn).toBe("done");
    expect(events.some((event) => event.type === "after-turn-failed")).toBe(false);
  });

  it("все попытки упали: журнал, событие after-turn-failed, failed; ответ цел, finish ушёл, чат свободен", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>(async () => {
      throw new Error("не вышло");
    });
    const { service, storage, events, logError } = setup({ afterTurn, afterTurnAttempts: 2 });
    const { chatId, chunks } = await onFakeClock(() => ask(service));
    const answer = await lastAnswer(storage, chatId);

    expect(afterTurn).toHaveBeenCalledTimes(2);
    expect(answer).toMatchObject({ status: "complete", afterTurn: "failed" });
    expect(answer.parts.some((part) => part.type === "text")).toBe(true);
    expect(chunks.at(-1)?.type).toBe("finish");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("afterTurn не отработал"));
    expect(events).toContainEqual({ type: "after-turn-failed", ownerId: "anna", chatId, messageId: answer.id });
    await readAll(await service.sendMessage("anna", chatId, userMessage("u-next", "дальше")));
  });

  it("хук не уложился в срок: failed, поток кончается", async () => {
    const { service, storage, events } = setup({ afterTurn: () => new Promise(() => {}), afterTurnTimeoutMs: 5000 });
    const { chatId, chunks } = await onFakeClock(() => ask(service));
    expect((await lastAnswer(storage, chatId)).afterTurn).toBe("failed");
    expect(chunks.at(-1)?.type).toBe("finish");
    expect(events.some((event) => event.type === "after-turn-failed")).toBe(true);
  });

  it("«Стоп» во время хука: поток кончается сразу, чат свободен; хук доделывается в фоне, события — в ответ и через watch", async () => {
    let release: ((value: { events: { type: string }[] }) => void) | undefined;
    // Первый хук ждёт, пока тест его отпустит; хук следующего хода отвечает сразу.
    const afterTurn = vi.fn<AfterTurnHandler>(() => (release ? undefined : new Promise((resolve) => (release = resolve))));
    const { service, storage, events } = setup({ afterTurn });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сдаю урок")));
    await vi.waitFor(() => expect(afterTurn).toHaveBeenCalledTimes(1));

    expect(await service.stop("anna", chat.id)).toBe(true);
    const chunks = await reading;
    expect(chunks.at(-1)?.type).toBe("finish");
    expect(appEventChunks(chunks)).toEqual([]);
    const answer = await lastAnswer(storage, chat.id);
    expect(answer).toMatchObject({ status: "complete", afterTurn: "pending" });
    // Чат свободен: следующий ход начинается, пока хук ещё идёт.
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "дальше")));

    release!({ events: [{ type: "lesson_passed" }] });
    await vi.waitFor(async () => expect((await storage.getMessage(answer.id))?.afterTurn).toBe("done"));
    expect((await storage.getMessage(answer.id))!.parts.at(-1)).toEqual({ type: "data-app-event", data: { type: "lesson_passed" } });
    expect(events).toContainEqual({ type: "app-event", ownerId: "anna", chatId: chat.id, messageId: answer.id, event: { type: "lesson_passed" } });
  });

  it("состояние уже закрыто (другая копия успела): события хука не дописываются и в поток не идут", async () => {
    let storage!: ChatStorage;
    const afterTurn = vi.fn<AfterTurnHandler>(async (result) => {
      await storage.setAfterTurnState!(result.messageId, "done");
      return { events: [{ type: "lesson_passed" }] };
    });
    const made = setup({ afterTurn });
    storage = made.storage;
    const { chatId, chunks } = await ask(made.service);
    const answer = await lastAnswer(storage, chatId);
    expect(answer.afterTurn).toBe("done");
    expect(answer.parts.some((part) => part.type === "data-app-event")).toBe(false);
    expect(appEventChunks(chunks)).toEqual([]);
  });

  it("событие не по правилам — сбой без повторов", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>(() => ({ events: [{ type: "" }] }));
    const { service, storage } = setup({ afterTurn });
    const { chatId, chunks } = await ask(service);
    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect((await lastAnswer(storage, chatId)).afterTurn).toBe("failed");
    expect(appEventChunks(chunks)).toEqual([]);
  });

  it("хук получает и ошибку хода", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const failing = mockModel(() => {
      throw Object.assign(new Error("Invalid API key"), { statusCode: 401 });
    });
    const { service } = setup({ afterTurn, model: failing });
    await ask(service);
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "error", error: { kind: expect.any(String) } });
  });

  it("ход действием: переделать — regenerate, повторить — retry, правка — edit", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    // Переделанный ответ пустой: такой можно повторить.
    const answered = [streamStart, ...textParts(["Ответ"]), finishPart()];
    const { service, storage } = setup({ afterTurn, model: scriptedModel([answered, [streamStart, finishPart()]]) });
    const { chatId } = await ask(service);
    await readAll(await service.regenerate("anna", chatId, (await lastAnswer(storage, chatId)).id));
    await readAll(await service.retry("anna", chatId));
    const question = (await storage.listMessages(chatId)).find((message) => message.role === "user")!;
    await readAll(await service.editMessage("anna", chatId, question.id, userMessage("u-edit", "иначе")));
    expect(afterTurn.mock.calls.map(([result]) => result.trigger)).toEqual(["send", "regenerate", "retry", "edit"]);
  });
});

describe("afterTurn и подтверждение вызова", () => {
  const remove = tool({
    description: "Удалить",
    inputSchema: z.object({ path: z.string() }),
    needsApproval: true,
    execute: async () => "удалено",
  });
  const asksApproval: LanguageModelV4StreamPart[] = [
    streamStart,
    { type: "tool-call", toolCallId: "c1", toolName: "remove", input: JSON.stringify({ path: "a" }) },
    finishPart("tool-calls"),
  ];

  it("ждущий ответ — первый вызов, продолжение после решения — второй, с тем же messageId", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>(({ status }) => ({ events: [{ type: `after-${status}` }] }));
    const { service, storage } = setup({ afterTurn, model: scriptedModel([asksApproval]), agent: { instructions: "Ты помощник.", tools: { remove } } });
    const { chatId } = await ask(service, "удали a");
    const waiting = await lastAnswer(storage, chatId);
    expect(waiting).toMatchObject({ status: "awaiting_approval", afterTurn: "done" });
    const approvalId = (waiting.parts.find((part) => part.type === "tool-remove") as { approval: { id: string } }).approval.id;

    await service.answerApproval("anna", chatId, approvalId, "allow");
    await readAll((await service.subscribe("anna", chatId))!);

    expect(afterTurn.mock.calls.map(([result]) => [result.messageId, result.status, result.trigger])).toEqual([
      [waiting.id, "awaiting_approval", "send"],
      [waiting.id, "complete", "approval"],
    ]);
    const finished = await lastAnswer(storage, chatId);
    expect(finished.afterTurn).toBe("done");
    expect(finished.parts.filter((part) => part.type === "data-app-event")).toEqual([
      { type: "data-app-event", data: { type: "after-awaiting_approval" } },
      { type: "data-app-event", data: { type: "after-complete" } },
    ]);
  });
});

describe("afterTurn после перезапуска", () => {
  async function storageWith(answer: Partial<StoredMessage>) {
    const storage = createInMemoryChatStorage();
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
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
        ...answer,
      }),
    );
    return storage;
  }

  /** Ждёт, пока хуки восстановления (они идут в фоне) закроют состояние. */
  async function settled(storage: ChatStorage) {
    await vi.waitFor(async () => expect(await storage.listPendingAfterTurn!()).toEqual([]));
  }

  it("ждущий хук доделывается при старте: recovered, события в ответе", async () => {
    const storage = await storageWith({ status: "complete", afterTurn: "pending" });
    const afterTurn = vi.fn<AfterTurnHandler>(() => ({ events: [{ type: "lesson_passed" }] }));
    const { service } = setup({ storage, afterTurn });
    await service.recoverInterruptedAnswers();
    await settled(storage);

    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ messageId: "a1", status: "complete", recovered: true, text: "Начало", trigger: null, ownerId: "anna" });
    const answer = await storage.getMessage("a1");
    expect(answer).toMatchObject({ afterTurn: "done" });
    expect(answer!.parts.at(-1)).toEqual({ type: "data-app-event", data: { type: "lesson_passed" } });
  });

  it("ответ, прерванный восстановлением, получает хук со статусом interrupted", async () => {
    const storage = await storageWith({ status: "streaming" });
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service } = setup({ storage, afterTurn });
    expect(await service.recoverInterruptedAnswers()).toBe(1);
    await settled(storage);

    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ messageId: "a1", status: "interrupted", recovered: true });
    expect((await storage.getMessage("a1"))?.afterTurn).toBe("done");
  });

  it("свежий ждущий хук (его может вести другая копия) при старте не трогается; доделывается проверкой, когда срок с запасом вышел", async () => {
    vi.useFakeTimers({ now: new Date("2026-03-01T10:00:01.000Z") });
    try {
      const storage = await storageWith({ status: "complete", afterTurn: "pending" });
      const afterTurn = vi.fn<AfterTurnHandler>();
      const { service } = setup({ storage, afterTurn, afterTurnTimeoutMs: 1000 });
      await service.recoverInterruptedAnswers();
      await vi.advanceTimersByTimeAsync(0);
      expect(afterTurn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(afterTurn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(70_000);
      expect(afterTurn).toHaveBeenCalledTimes(1);
      expect(afterTurn.mock.calls[0]![0]).toMatchObject({ messageId: "a1", recovered: true });
      await service.flush();
    } finally {
      vi.useRealTimers();
    }
  });

  it("без afterTurn восстановление состояние хука не пишет", async () => {
    const storage = await storageWith({ status: "streaming" });
    const { service } = setup({ storage });
    await service.recoverInterruptedAnswers();
    expect((await storage.getMessage("a1"))?.afterTurn ?? null).toBeNull();
  });
});

describe("afterTurn: сообщения агента без хода", () => {
  it("приветствие нового чата и импорт переписки хук не зовут, ни сразу, ни при восстановлении", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service, storage } = setup({ afterTurn });
    const greeted = await service.createChat("anna", { greeting: { text: "Здравствуйте! Чем помочь?" } });
    const { chatId: imported } = await service.importChat({
      ownerId: "anna",
      chat: {},
      messages: [
        { role: "user", createdAt: "2025-01-01T10:00:00.000Z", parts: [{ type: "text", text: "Привет" }] },
        { role: "assistant", createdAt: "2025-01-01T10:01:00.000Z", parts: [{ type: "text", text: "Здравствуйте" }] },
      ],
    });
    await service.recoverInterruptedAnswers();

    expect(afterTurn).not.toHaveBeenCalled();
    for (const chatId of [greeted.id, imported]) expect((await lastAnswer(storage, chatId)).afterTurn ?? null).toBeNull();
    expect(await storage.listPendingAfterTurn!()).toEqual([]);
  });
});

describe("события приложения от инструмента и вне хода", () => {
  it("model.emitAppEvent: часть в ответе сразу и в потоке; неверное событие — ошибка инструмента", async () => {
    const award = tool({
      description: "Зачесть урок",
      inputSchema: z.object({ bad: z.boolean() }),
      execute: async () => "ok",
    });
    const calls: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "tool-call", toolCallId: "c1", toolName: "award", input: JSON.stringify({ bad: false }) },
      { type: "tool-call", toolCallId: "c2", toolName: "award", input: JSON.stringify({ bad: true }) },
      finishPart("tool-calls"),
    ];
    const { service, storage } = setup({
      model: scriptedModel([calls]),
      agent: {
        instructions: "Ты помощник.",
        tools: (model) => ({
          award: tool({
            ...award,
            execute: async ({ bad }) => {
              model.emitAppEvent!(bad ? { type: "" } : { type: "lesson_passed", data: { by: "tool" } });
              return "ok";
            },
          }),
        }),
      },
    });
    const { chatId, chunks } = await ask(service);
    expect(appEventChunks(chunks)).toEqual([{ type: "data-app-event", data: { type: "lesson_passed", data: { by: "tool" } } }]);
    const answer = await lastAnswer(storage, chatId);
    expect(answer.parts.filter((part) => part.type === "data-app-event")).toHaveLength(1);
    expect(answer.parts.find((part) => part.type === "tool-award" && (part as { toolCallId: string }).toolCallId === "c2")).toMatchObject({ state: "output-error" });
  });

  it("publishAppEvent: событие app-event для наблюдателей чата, без записи в историю", async () => {
    const { service, storage, events } = setup();
    const { chatId } = await ask(service);
    const before = await storage.listMessages(chatId);

    await service.publishAppEvent({ ownerId: "anna", chatId, event: { type: "lesson_passed", data: { lesson: 1 } } });
    expect(events.at(-1)).toEqual({ type: "app-event", ownerId: "anna", chatId, event: { type: "lesson_passed", data: { lesson: 1 } } });
    expect(await storage.listMessages(chatId)).toEqual(before);

    await expect(service.publishAppEvent({ ownerId: "boris", chatId, event: { type: "x" } })).rejects.toThrow();
    await expect(service.publishAppEvent({ ownerId: "anna", chatId, event: { type: "" } })).rejects.toThrow(TypeError);
  });
});
