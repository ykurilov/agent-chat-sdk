import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ANSWER_STALE_AFTER_MS } from "../../src/agent-run/answer-liveness";
import { ApprovalNotPendingError, ChatNotFoundError, NothingToRetryError, createChatService } from "../../src/chat-service";
import type { ContextBlocksSource } from "../../src/frozen-context/context-blocks";
import type { ChatService } from "../../src/chat-service";
import { createRunningAnswerRegistry } from "../../src/running-answers/running-answer-registry";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import {
  ALWAYS_IN_CHAT,
  ALWAYS_OFFERED_REASON,
  DENIED_BY_USER_REASON,
  IGNORED_REASON,
  INTERRUPTED_REASON,
  RESULT_UNKNOWN_REASON,
} from "../../src/tool-approval/approval-parts";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const toolCall = (id: string, path: string): LanguageModelV4StreamPart => ({
  type: "tool-call",
  toolCallId: id,
  toolName: "remove",
  input: JSON.stringify({ path }),
});

/** Модель: на каждый вызов берёт следующий сценарий; после списка — короткий текст. */
function scriptedModel(scripts: LanguageModelV4StreamPart[][]) {
  let call = 0;
  return mockModel(() => {
    const script = scripts[call++];
    return streamOf(script ?? [streamStart, ...textParts(["Готово"]), finishPart()]);
  });
}

const callsRemove = (...calls: Array<[string, string]>): LanguageModelV4StreamPart[] => [
  streamStart,
  ...calls.map(([id, path]) => toolCall(id, path)),
  finishPart("tool-calls"),
];

function setup(
  scripts: LanguageModelV4StreamPart[][],
  storage: ChatStorage = createInMemoryChatStorage(),
  extra: { needsApproval?: boolean | ((input: { path: string }) => boolean); limits?: SpendingLimits; contextBlocks?: ContextBlocksSource } = {},
) {
  const execute = vi.fn(async ({ path }: { path: string }) => `удалено ${path}`);
  const model = scriptedModel(scripts);
  const build = (chatStorage: ChatStorage): ChatService =>
    createChatService({
      storage: chatStorage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        contextBlocks: extra.contextBlocks,
        tools: {
          remove: tool({ description: "Удалить", title: "Удалить файл", inputSchema: z.object({ path: z.string() }), needsApproval: extra.needsApproval ?? true, execute }),
        },
      },
      ...(extra.limits && { limits: extra.limits }),
      env: mockEnv,
    });
  return { storage, execute, model, service: build(storage), build };
}

async function askAndWaitForRequest(service: ChatService, text = "удали a") {
  const chat = await service.createChat("anna");
  const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", text)));
  return { chat, chunks };
}

async function lastAnswer(service: ChatService, chatId: string) {
  const { messages } = await service.getHistory("anna", chatId);
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

const requestedApprovalId = async (service: ChatService, chatId: string) => {
  const part = (await lastAnswer(service, chatId)).parts.find((p) => p.type === "tool-remove") as { approval?: { id: string } };
  return part.approval!.id;
};

const promptText = (model: ReturnType<typeof scriptedModel>, call: number) => JSON.stringify(model.doStreamCalls[call]!.prompt);

describe("подтверждение вызова инструмента", () => {

  it("approval resume retains the original human id/text and does not classify approval as a new question", async () => {
    const source = vi.fn<ContextBlocksSource>(async ({ userMessage }) => [{ key: "classify", text: `human:${userMessage?.id}:${userMessage?.text}` }]);
    const { service, model } = setup([callsRemove(["c1", "a"])], undefined, { contextBlocks: source });
    const { chat } = await askAndWaitForRequest(service, "удали только a");
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(source.mock.calls).toHaveLength(2);
    for (const [input] of source.mock.calls) expect(input.userMessage).toEqual({ id: "u1", text: "удали только a" });
    expect(promptText(model, 1).split("human:u1:удали только a")).toHaveLength(2);
  });

  it("ход останавливается на запросе: инструмент не выполнен, ответ ждёт решения", async () => {
    const { service, execute } = setup([callsRemove(["c1", "a"])]);
    const { chat, chunks } = await askAndWaitForRequest(service);
    expect(chunks.some((chunk) => chunk.type === "tool-approval-request")).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    const history = await service.getHistory("anna", chat.id);
    expect(history.running).toBe(false);
    const answer = history.messages.at(-1)!;
    expect(answer.metadata?.status).toBe("awaiting_approval");
    expect(answer.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "approval-requested", input: { path: "a" } });
  });

  it("«Разрешить»: инструмент выполнен один раз, ответ дописан в то же сообщение", async () => {
    const { service, execute, model } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    const before = await lastAnswer(service, chat.id);
    const result = await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
    expect(result).toEqual({ resumed: true });
    const chunks = await readAll((await service.subscribe("anna", chat.id))!);
    expect(chunks[0]).toMatchObject({ type: "start", messageId: before.id });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({ path: "a" });
    const after = await lastAnswer(service, chat.id);
    expect(after.id).toBe(before.id);
    expect(after.metadata?.status).toBe("complete");
    expect(after.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-available", output: "удалено a" });
    expect(after.parts.at(-1)).toMatchObject({ type: "text", text: "Готово" });
    expect(promptText(model, 1)).toContain("удалено a");
    expect((await service.getHistory("anna", chat.id)).messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("«Отклонить»: инструмент не выполнен, модель получает причину и продолжает", async () => {
    const { service, execute, model } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "deny");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(execute).not.toHaveBeenCalled();
    expect(promptText(model, 1)).toContain(DENIED_BY_USER_REASON);
    const after = await lastAnswer(service, chat.id);
    expect(after.metadata?.status).toBe("complete");
    expect(after.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-denied" });
    expect(after.parts.at(-1)).toMatchObject({ type: "text", text: "Готово" });
  });

  it("запрос модели после решения начинается так же, как раньше: инструкция и инструмент те же", async () => {
    const { service, model } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    const [first, second] = model.doStreamCalls;
    expect(second!.tools).toEqual(first!.tools);
    expect(JSON.stringify(second!.prompt).startsWith(JSON.stringify(first!.prompt).slice(0, -2))).toBe(true);
    expect(JSON.stringify(first!.tools)).not.toContain("needsApproval");
  });

  it("«Всегда в этом чате»: тот же инструмент дальше без вопроса, в другом чате — с вопросом", async () => {
    const { service, execute } = setup([callsRemove(["c1", "a"]), undefined as never, callsRemove(["c2", "b"])]);
    const { chat } = await askAndWaitForRequest(service);
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "always");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(execute).toHaveBeenCalledTimes(1);

    // Модель зовёт инструмент снова: вопроса нет.
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "и b")));
    expect(execute).toHaveBeenCalledTimes(2);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });

  it("«Всегда» действует только в своём чате", async () => {
    const { service, execute } = setup([callsRemove(["c1", "a"]), undefined as never, callsRemove(["c9", "z"])]);
    const { chat } = await askAndWaitForRequest(service);
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "always");
    await readAll((await service.subscribe("anna", chat.id))!);
    const other = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", other.id, userMessage("o1", "тоже")));
    // Вызов в другом чате: карточка есть, инструмент не выполнен.
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await lastAnswer(service, other.id)).metadata?.status).toBe("awaiting_approval");
  });

  it("новое сообщение вместо ответа: запрос закрыт как отклонённый, ход идёт дальше", async () => {
    const { service, execute, model } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    const first = await lastAnswer(service, chat.id);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "лучше не надо")));
    expect(execute).not.toHaveBeenCalled();
    const { messages } = await service.getHistory("anna", chat.id);
    const closed = messages.find((message) => message.id === first.id)!;
    expect(closed.metadata?.status).toBe("complete");
    expect(closed.parts.find((part) => part.type === "tool-remove")).toMatchObject({
      state: "output-denied",
      approval: { approved: false, reason: IGNORED_REASON },
    });
    expect(messages.map((message) => message.id).slice(0, 3)).toEqual(["u1", first.id, "u2"]);
    expect(promptText(model, 1)).toContain(IGNORED_REASON);
    expect(messages.at(-1)!.parts.at(-1)).toMatchObject({ type: "text", text: "Готово" });
  });

  it("новое сообщение не сохранилось (повтор id) — запрос подтверждения так и ждёт ответа", async () => {
    const { service, execute } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "лучше не надо"))).rejects.toThrow();
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  describe("сообщение сохранилось, а запрос подтверждения не закрылся (сбой базы)", () => {
    /** Хранилище, у которого первое закрытие запроса падает. */
    function closingFailsOnce() {
      const memory = createInMemoryChatStorage();
      let failed = false;
      const storage: ChatStorage = {
        ...memory,
        updateAwaitingMessage: async (messageId, patch) => {
          if (!failed && patch.status === "complete") {
            failed = true;
            throw new Error("connection terminated");
          }
          await memory.updateAwaitingMessage(messageId, patch);
        },
      };
      return storage;
    }

    async function afterFailedSend() {
      const { service, execute, model } = setup([callsRemove(["c1", "a"])], closingFailsOnce());
      const { chat } = await askAndWaitForRequest(service);
      const asked = await lastAnswer(service, chat.id);
      await expect(service.sendMessage("anna", chat.id, userMessage("u2", "лучше не надо"))).rejects.toThrow("connection terminated");
      return { service, execute, model, chat, asked };
    }

    async function expectClosedAndAnswered(service: ChatService, chatId: string, askedId: string, model: ReturnType<typeof scriptedModel>) {
      const { messages } = await service.getHistory("anna", chatId);
      expect(messages.map((message) => message.id).slice(0, 3)).toEqual(["u1", askedId, "u2"]);
      expect(messages.filter((message) => message.id === "u2")).toHaveLength(1);
      const closed = messages.find((message) => message.id === askedId)!;
      expect(closed.metadata?.status).toBe("complete");
      expect(closed.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-denied" });
      expect(promptText(model, 1)).toContain(IGNORED_REASON);
      expect(messages.at(-1)!.parts.at(-1)).toMatchObject({ type: "text", text: "Готово" });
    }

    it("повтор того же сообщения (тот же id) доводит приём до конца: запрос закрыт, ответ есть, копии сообщения нет", async () => {
      const { service, execute, model, chat, asked } = await afterFailedSend();
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "лучше не надо")));
      expect(execute).not.toHaveBeenCalled();
      await expectClosedAndAnswered(service, chat.id, asked.id, model);
    });

    it("«Повторить» тоже сначала закрывает запрос, а потом отвечает", async () => {
      const { service, execute, model, chat, asked } = await afterFailedSend();
      await readAll(await service.retry("anna", chat.id));
      expect(execute).not.toHaveBeenCalled();
      await expectClosedAndAnswered(service, chat.id, asked.id, model);
    });

    it("тот же id у сообщения, на которое уже есть ответ, — по-прежнему отказ", async () => {
      const { service, chat } = await afterFailedSend();
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "лучше не надо")));
      await expect(service.sendMessage("anna", chat.id, userMessage("u2", "лучше не надо"))).rejects.toThrow();
    });
  });

  it("несколько запросов в одном шаге: ход ждёт ответа на все", async () => {
    const { service, execute } = setup([callsRemove(["c1", "a"], ["c2", "b"])]);
    const { chat } = await askAndWaitForRequest(service);
    const parts = (await lastAnswer(service, chat.id)).parts.filter((part) => part.type === "tool-remove") as Array<{ approval: { id: string } }>;
    expect(parts).toHaveLength(2);
    expect(await service.answerApproval("anna", chat.id, parts[0]!.approval.id, "allow")).toEqual({ resumed: false });
    expect(execute).not.toHaveBeenCalled();
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
    expect(await service.answerApproval("anna", chat.id, parts[1]!.approval.id, "deny")).toEqual({ resumed: true });
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({ path: "a" });
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });

  it("чужой чат, неизвестный и уже решённый запрос — ошибки", async () => {
    const { service } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    const id = await requestedApprovalId(service, chat.id);
    await expect(service.answerApproval("boris", chat.id, id, "allow")).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.answerApproval("anna", chat.id, "нет-такого", "allow")).rejects.toBeInstanceOf(ApprovalNotPendingError);
    await service.answerApproval("anna", chat.id, id, "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    await expect(service.answerApproval("anna", chat.id, id, "allow")).rejects.toBeInstanceOf(ApprovalNotPendingError);
  });

  it("ожидание переживает рестарт: запрос остаётся, ответить можно новой службой", async () => {
    const { service, storage, execute, build } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    const id = await requestedApprovalId(service, chat.id);
    const restarted = build(storage);
    expect(await restarted.recoverInterruptedAnswers()).toBe(0);
    expect((await lastAnswer(restarted, chat.id)).metadata?.status).toBe("awaiting_approval");
    await restarted.answerApproval("anna", chat.id, id, "allow");
    await readAll((await restarted.subscribe("anna", chat.id))!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await lastAnswer(restarted, chat.id)).metadata?.status).toBe("complete");
  });

  it("при ожидании «Стоп» ничего не останавливает, «Ещё раз» — нечего повторять", async () => {
    const { service } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    expect(await service.stop("anna", chat.id)).toBe(false);
    await expect(service.retry("anna", chat.id)).rejects.toBeInstanceOf(NothingToRetryError);
  });

  it("пока ход продолжается, история отдаёт сообщение с уже принятым решением", async () => {
    const { service } = setup([callsRemove(["c1", "a"])]);
    const { chat } = await askAndWaitForRequest(service);
    const first = await lastAnswer(service, chat.id);
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
    const during = await service.getHistory("anna", chat.id);
    expect(during.running).toBe(true);
    const shown = during.messages.find((message) => message.id === first.id);
    expect(shown?.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "approval-responded" });
    await readAll((await service.subscribe("anna", chat.id))!);
    expect((await service.getHistory("anna", chat.id)).running).toBe(false);
  });

  it("ошибка модели при продолжении: инструмент выполнен, ответ в состоянии error, написанное на месте", async () => {
    const execute = vi.fn(async () => "ок");
    let call = 0;
    const model = mockModel(() => {
      if (call++ === 0) return streamOf(callsRemove(["c1", "a"]));
      return streamOf([streamStart, { type: "error", error: new Error("boom") }]);
    });
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "x",
        tools: { remove: tool({ description: "d", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute }) },
      },
      env: mockEnv,
      logError: () => {},
    });
    const { chat } = await askAndWaitForRequest(service);
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("error");
    expect(answer.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-available" });
  });

  describe("сбои после «Разрешить»", () => {
    const toolPartOf = async (service: ChatService, chatId: string) =>
      (await lastAnswer(service, chatId)).parts.find((part) => part.type === "tool-remove") as { state: string; approval?: { approved?: boolean; reason?: string } };

    it("запуск продолжения упал: вызов закрыт отказом, следующее сообщение уходит модели без ошибки", async () => {
      const real = createRunningAnswerRegistry();
      let failStart = false;
      const registry = {
        ...real,
        start: (...args: Parameters<typeof real.start>) => {
          if (failStart) throw new Error("не запустилось");
          return real.start(...args);
        },
      };
      const storage = createInMemoryChatStorage();
      const model = scriptedModel([callsRemove(["c1", "a"])]);
      const service = createChatService({
        storage,
        registry,
        catalog: mockCatalog({ mock: model }),
        defaultChoice: { modelId: mockModelId, providerId: "mock" },
        agent: { instructions: "x", tools: { remove: tool({ description: "d", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute: async () => "ок" }) } },
        env: mockEnv,
      });
      const { chat } = await askAndWaitForRequest(service);
      failStart = true;
      await expect(service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow")).rejects.toThrow("не запустилось");
      failStart = false;
      const part = await toolPartOf(service, chat.id);
      expect(part).toMatchObject({ state: "output-denied", approval: { approved: false, reason: INTERRUPTED_REASON } });
      expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("interrupted");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
      expect(promptText(model, 1)).toContain(INTERRUPTED_REASON);
    });

    it("сервер упал сразу после «Разрешить»: при восстановлении вызов без результата закрыт отказом", async () => {
      const { service, storage, execute, build } = setup([callsRemove(["c1", "a"])]);
      const { chat } = await askAndWaitForRequest(service);
      const waiting = (await storage.listMessages(chat.id)).find((message) => message.status === "awaiting_approval")!;
      const responded = waiting.parts.map((part) =>
        part.type === "tool-remove" ? ({ ...part, state: "approval-responded", approval: { id: (part as never as { approval: { id: string } }).approval.id, approved: true } } as typeof part) : part,
      );
      await storage.updateAwaitingMessage(waiting.id, { parts: responded, status: "streaming", alive: "now" });
      // Копия упала и больше не отмечалась: сервер поднят снова, когда знак жизни уже старше порога (FR-060).
      vi.useFakeTimers({ now: Date.now() + ANSWER_STALE_AFTER_MS + 1_000, toFake: ["Date"] });
      try {
        const restarted = build(storage);
        expect(await restarted.recoverInterruptedAnswers()).toBe(1);
        expect(execute).not.toHaveBeenCalled();
        expect(await toolPartOf(restarted, chat.id)).toMatchObject({ state: "output-denied", approval: { approved: false, reason: RESULT_UNKNOWN_REASON } });
        expect((await lastAnswer(restarted, chat.id)).metadata?.status).toBe("interrupted");
        await restarted.flush();
      } finally {
        vi.useRealTimers();
      }
    });

    it("«Стоп» во время выполнения разрешённого инструмента: причина «результат неизвестен», а не «пользователь отклонил»", async () => {
      let markStarted = () => {};
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const execute = vi.fn(async () => {
        markStarted();
        return new Promise<string>(() => {});
      });
      const model = scriptedModel([callsRemove(["c1", "a"])]);
      const service = createChatService({
        storage: createInMemoryChatStorage(),
        catalog: mockCatalog({ mock: model }),
        defaultChoice: { modelId: mockModelId, providerId: "mock" },
        agent: { instructions: "x", tools: { remove: tool({ description: "d", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute }) } },
        env: mockEnv,
      });
      const { chat } = await askAndWaitForRequest(service);
      await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
      await started;
      expect(await service.stop("anna", chat.id)).toBe(true);
      await readAll((await service.subscribe("anna", chat.id))!).catch(() => []);
      const part = await toolPartOf(service, chat.id);
      expect(part).toMatchObject({ state: "output-denied", approval: { approved: false, reason: RESULT_UNKNOWN_REASON } });
      expect(part.approval?.reason).not.toContain("отклонил");
    });
  });

  describe("«Всегда в этом чате»: только для инструментов с простым флагом", () => {
    const approvalOf = async (service: ChatService, chatId: string) =>
      ((await lastAnswer(service, chatId)).parts.find((part) => part.type === "tool-remove") as { approval?: { requestReason?: string; reason?: string } }).approval;

    it("флаг true: запрос несёт метку «Всегда» доступна", async () => {
      const { service } = setup([callsRemove(["c1", "a"])]);
      const { chat } = await askAndWaitForRequest(service);
      expect((await approvalOf(service, chat.id))?.requestReason).toBe(ALWAYS_OFFERED_REASON);
    });

    it("функция: метки нет, «Всегда» сводится к «Разрешить», следующий вызов снова проверяется по входным данным", async () => {
      const needsApproval = vi.fn((input: { path: string }) => input.path !== "safe");
      const { service, execute } = setup(
        [callsRemove(["c1", "a"]), undefined as never, callsRemove(["c2", "b"]), callsRemove(["c3", "safe"])],
        undefined,
        { needsApproval },
      );
      const { chat } = await askAndWaitForRequest(service);
      expect((await approvalOf(service, chat.id))?.requestReason).toBeUndefined();
      await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "always");
      await readAll((await service.subscribe("anna", chat.id))!);
      expect(execute).toHaveBeenCalledTimes(1);
      expect((await approvalOf(service, chat.id))?.reason).not.toBe(ALWAYS_IN_CHAT);

      // Тот же инструмент с другими данными: метка не обходит проверку.
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "и b")));
      expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
      expect(execute).toHaveBeenCalledTimes(1);

      // Безопасные данные функция пропускает сама.
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "и safe")));
      expect(execute).toHaveBeenCalledTimes(2);
    });
  });

  it("смена модели во время ожидания: продолжение идёт на модели, которая задала вопрос", async () => {
    const asking = scriptedModel([callsRemove(["c1", "a"])]);
    const other = scriptedModel([]);
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: asking, "mock-backup": other }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "x", tools: { remove: tool({ description: "d", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute: async () => "ок" }) } },
      env: mockEnv,
    });
    const { chat } = await askAndWaitForRequest(service);
    await service.setModel("anna", chat.id, { modelId: mockModelId, providerId: "mock-backup" });
    await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(asking.doStreamCalls).toHaveLength(2);
    expect(other.doStreamCalls).toHaveLength(0);
    expect((await lastAnswer(service, chat.id)).metadata).toMatchObject({ providerId: "mock", status: "complete" });
  });

  describe("лимиты расходов", () => {
    const blockedLimits = () => {
      const state = { blocked: false };
      const limits: SpendingLimits = {
        assertWithinLimit: vi.fn(async () => {
          if (state.blocked) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
        }),
        status: vi.fn(async () => ({ state: "ok" as const })),
      };
      return { state, limits };
    };

    it("лимит исчерпан: «Разрешить» отказано, запрос остаётся ждать, инструмент не выполнен", async () => {
      const { state, limits } = blockedLimits();
      const { service, execute, storage } = setup([callsRemove(["c1", "a"])], undefined, { limits });
      const { chat } = await askAndWaitForRequest(service);
      const id = await requestedApprovalId(service, chat.id);
      state.blocked = true;
      await expect(service.answerApproval("anna", chat.id, id, "allow")).rejects.toBeInstanceOf(SpendingLimitReachedError);
      expect(execute).not.toHaveBeenCalled();
      expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
      expect((await storage.listMessages(chat.id)).find((message) => message.status === "awaiting_approval")).toBeDefined();
      state.blocked = false;
      await service.answerApproval("anna", chat.id, id, "allow");
      await readAll((await service.subscribe("anna", chat.id))!);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("расход паузы и продолжения не считается дважды: в записях ровно то, что потратили два запроса к модели", async () => {
      const { service, storage } = setup([callsRemove(["c1", "a"])]);
      const { chat } = await askAndWaitForRequest(service);
      await service.answerApproval("anna", chat.id, await requestedApprovalId(service, chat.id), "allow");
      await readAll((await service.subscribe("anna", chat.id))!);
      // mockUsage: вход 100, выход 30 на каждый запрос; запросов два.
      expect((await storage.sumUsage({ ownerId: "anna" }))[0]).toMatchObject({ inputTokens: 200, outputTokens: 60 });
    });
  });
});
