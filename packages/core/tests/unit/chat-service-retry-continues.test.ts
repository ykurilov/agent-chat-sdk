import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { AnswerStatus, StoredMessage, UsageRecord } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { extendCatalog } from "../../src/models/catalog-changes";
import type { ProviderDescription } from "../../src/models/model-catalog";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import { HANGING_TOOL_CALL_REASON } from "../../src/tool-approval/approval-parts";
import { controlledModel, finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

type Part = StoredMessage["parts"][number];

const step: Part = { type: "step-start" };
const created = (id: string, title: string): Part =>
  ({ type: "tool-create_task", toolCallId: id, state: "output-available", input: { title }, output: `создана ${title}` }) as Part;
const twoCreated: Part[] = [step, { type: "text", text: "Создаю", state: "done" }, created("c1", "Первая"), step, created("c2", "Вторая")];

const callCreate = (id: string, title: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: "create_task", input: JSON.stringify({ title }) },
  finishPart("tool-calls"),
];
const sayDone = (text = "Готово"): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Модель по сценарию: n-й запрос отдаёт n-й список кусков; `Error` — запрос падает этой ошибкой. */
function scripted(script: Array<LanguageModelV4StreamPart[] | Error>) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = script[call++] ?? sayDone();
      if (next instanceof Error) throw next;
      return { stream: streamOf(next) };
    },
  });
}

const badRequest = () => new APICallError({ message: "400", url: "https://p.test", requestBodyValues: {}, statusCode: 400, responseBody: "плохо" });
const busy = () => new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseHeaders: { "retry-after-ms": "1" } });

function createTaskTool() {
  const execute = vi.fn(async ({ title }: { title: string }) => `создана ${title}`);
  return { execute, create_task: tool({ description: "Создать задачу.", inputSchema: z.object({ title: z.string() }), execute }) };
}

function setup(models: { mock: MockLanguageModelV4; backup?: MockLanguageModelV4 }, storage: ChatStorage = createInMemoryChatStorage()) {
  const taskTool = createTaskTool();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: models.mock, "mock-backup": models.backup ?? scripted([]) }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", tools: { create_task: taskTool.create_task } },
    env: mockEnv,
    logError: () => {},
  });
  return { storage, service, execute: taskTool.execute };
}

/** Чат «c1»: вопрос «u1» и ответ «a1» с частями `parts`, вставленные прямо в хранилище. */
async function chatWithAnswer(storage: ChatStorage, status: AnswerStatus, parts: Part[], fields: Partial<StoredMessage> = {}) {
  await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.insertMessage(
    newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "Создай три задачи" }], createdAt: "2026-01-01T00:00:00.000Z" }),
  );
  await storage.insertMessage(
    newStoredMessage({
      id: "a1",
      chatId: "c1",
      parentId: "u1",
      role: "assistant",
      parts,
      status,
      modelId: mockModelId,
      providerId: "mock",
      createdAt: "2026-01-01T00:00:01.000Z",
      ...fields,
    }),
  );
}

async function currentAnswer(service: ReturnType<typeof setup>["service"]) {
  const { messages } = await service.getHistory("anna", "c1");
  return messages.at(-1)!;
}

const toolParts = (parts: readonly Part[]) => parts.filter((part) => part.type === "tool-create_task") as Array<Part & { toolCallId: string; state: string }>;

describe("«Повторить» продолжает ход (US2)", () => {
  it.each<AnswerStatus>(["error", "interrupted", "stopped"])(
    "ответ %s с двумя выполненными вызовами — новый ответ с этими вызовами, модель продолжает с третьего шага (сц. 1–3)",
    async (status) => {
      const model = scripted([callCreate("c3", "Третья"), sayDone("Три задачи готовы")]);
      const { storage, service, execute } = setup({ mock: model });
      await chatWithAnswer(storage, status, [...twoCreated, { type: "text", text: "И треть", state: "streaming" }]);

      await readAll(await service.retry("anna", "c1"));

      const answer = await currentAnswer(service);
      expect(answer.id).not.toBe("a1");
      expect(answer.metadata?.status).toBe("complete");
      expect(answer.parts.slice(0, twoCreated.length)).toEqual(twoCreated);
      expect(toolParts(answer.parts).map((part) => part.toolCallId)).toEqual(["c1", "c2", "c3"]);
      // Хвостовой текст оборванного ответа не скопирован.
      expect(JSON.stringify(answer.parts)).not.toContain("И треть");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ title: "Третья" }, expect.anything());
      // Модель видела выполненные шаги в первом же запросе.
      expect(model.doStreamCalls[0]!.prompt.filter((entry) => entry.role === "tool")).toHaveLength(2);
      // Прежний ответ — соседняя ветка без изменений.
      expect((await storage.getMessage("a1"))?.status).toBe(status);
      const { forks } = await service.getHistory("anna", "c1");
      expect(forks).toEqual([{ messageId: answer.id, siblingIds: ["a1", answer.id] }]);
    },
  );

  it("ответ без выполненных вызовов — новый ответ с нуля, как раньше (сц. 4, FR-028)", async () => {
    const model = scripted([sayDone("С нуля")]);
    const { storage, service } = setup({ mock: model });
    await chatWithAnswer(storage, "error", [step, { type: "text", text: "Начал", state: "done" }]);

    await readAll(await service.retry("anna", "c1"));

    const answer = await currentAnswer(service);
    expect(answer.parts).toEqual([step, { type: "text", text: "С нуля", state: "done" }]);
    expect(model.doStreamCalls[0]!.prompt.some((entry) => entry.role === "assistant")).toBe(false);
  });

  it("пустой complete — новый ответ с нуля (FR-028)", async () => {
    const model = scripted([sayDone("С нуля")]);
    const { storage, service } = setup({ mock: model });
    await chatWithAnswer(storage, "complete", [step, created("c1", "Первая")]);

    await readAll(await service.retry("anna", "c1"));

    expect(toolParts((await currentAnswer(service)).parts)).toEqual([]);
  });

  it("вызов, оборванный посреди выполнения, в новом ответе закрыт «результат неизвестен» (сц. 5)", async () => {
    const model = scripted([sayDone("Проверю сначала")]);
    const { storage, service, execute } = setup({ mock: model });
    await chatWithAnswer(storage, "interrupted", [step, created("c1", "Первая"), step, { type: "tool-create_task", toolCallId: "c2", state: "input-available", input: { title: "Вторая" } } as Part]);

    await readAll(await service.retry("anna", "c1"));

    const answer = await currentAnswer(service);
    expect(toolParts(answer.parts)[1]).toMatchObject({ toolCallId: "c2", state: "output-error", errorText: HANGING_TOOL_CALL_REASON });
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain(HANGING_TOOL_CALL_REASON);
    expect(execute).not.toHaveBeenCalled();
  });

  it("прежний вариант «‹ 1/2 ›» показывает оборванный ответ целиком, как был (сц. 6)", async () => {
    const original = [...twoCreated, { type: "text", text: "И треть", state: "streaming" } as Part];
    const { storage, service } = setup({ mock: scripted([sayDone()]) });
    await chatWithAnswer(storage, "error", original, { error: { kind: "other" } });

    await readAll(await service.retry("anna", "c1"));
    const history = await service.selectBranch("anna", "c1", "a1");

    expect(history.messages.at(-1)).toMatchObject({ id: "a1", parts: original, metadata: { status: "error" } });
  });

  it("поток /retry начинается с копии: клиент видит оба вызова до первого куска модели (FR-025)", async () => {
    const controlled = controlledModel();
    const { storage, service } = setup({ mock: controlled.model });
    await chatWithAnswer(storage, "error", twoCreated);

    const reader = (await service.retry("anna", "c1")).getReader();
    await controlled.opened;
    const early: UIMessageChunk[] = [];
    while (early.filter((chunk) => chunk.type === "tool-output-available").length < 2) early.push((await reader.read()).value!);
    expect(early[0]).toMatchObject({ type: "start" });
    expect(early.filter((chunk) => chunk.type === "tool-input-available").map((chunk) => (chunk as { toolCallId: string }).toolCallId)).toEqual(["c1", "c2"]);

    // Переподключение во время продолжения тоже получает копию с начала, а история прячет идущий ответ.
    const resubscribed = (await service.subscribe("anna", "c1"))!;
    const history = await service.getHistory("anna", "c1");
    expect(history.running).toBe(true);
    expect(history.messages.map((message) => message.id)).toEqual(["u1"]);

    controlled.push(...sayDone("Готово"));
    controlled.end();
    await readAll(new ReadableStream({ pull: async (c) => { const r = await reader.read(); if (r.done) c.close(); else c.enqueue(r.value); } }));
    const replayed = await readAll(resubscribed);
    expect(replayed[0]).toMatchObject({ type: "start" });
    expect(replayed.filter((chunk) => chunk.type === "tool-input-available")).toHaveLength(2);
  });

  it("расход: у нового ответа только его ход, в журнале расходов — одна запись нового хода (FR-027)", async () => {
    const storage = createInMemoryChatStorage();
    const written: UsageRecord[] = [];
    const recording: ChatStorage = { ...storage, insertUsageRecord: async (record) => void written.push(record) };
    const { service } = setup({ mock: scripted([sayDone()]) }, recording);
    await chatWithAnswer(storage, "error", twoCreated, { usage: { inputTokens: 999, cachedInputTokens: 0, outputTokens: 999, reasoningTokens: 0 } });

    await readAll(await service.retry("anna", "c1"));

    expect(written).toHaveLength(1);
    expect((await currentAnswer(service)).metadata?.usage).toMatchObject({ inputTokens: 100, outputTokens: 30 });
  });

  it("продолжение после смены провайдера чата: рассуждения прежнего не уходят (FR-026)", async () => {
    const backup = scripted([sayDone()]);
    const { storage, service } = setup({ mock: scripted([]), backup });
    const withReasoning: Part[] = [
      step,
      { type: "reasoning", text: "тайное рассуждение", state: "done", providerMetadata: { mock: { signature: "s" } } } as Part,
      created("c1", "Первая"),
    ];
    await chatWithAnswer(storage, "error", withReasoning);
    await service.setModel("anna", "c1", { modelId: mockModelId, providerId: "mock-backup" });

    await readAll(await service.retry("anna", "c1"));

    const answer = await currentAnswer(service);
    expect(answer.metadata?.providerId).toBe("mock-backup");
    expect(answer.parts.some((part) => part.type === "reasoning")).toBe(false);
    expect(JSON.stringify(backup.doStreamCalls[0]!.prompt)).not.toContain("тайное рассуждение");
    expect(toolParts(answer.parts)).toHaveLength(1);
  });

  it("продолжение у перегруженного провайдера переходит на запасного (FR-029)", async () => {
    const primary = scripted([busy(), busy(), busy(), busy()]);
    const backup = scripted([sayDone("Ответ запасного")]);
    const { storage, service } = setup({ mock: primary, backup });
    await chatWithAnswer(storage, "error", twoCreated);

    const chunks = await readAll(await service.retry("anna", "c1"));

    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    const answer = await currentAnswer(service);
    expect(answer.metadata).toMatchObject({ status: "complete", providerId: "mock-backup" });
    expect(toolParts(answer.parts)).toHaveLength(2);
  });

  it("SC-002: «создай три задачи», обрыв на третьей, «Повторить» — инструмент вызван ровно 3 раза за оба хода (20 прогонов)", async () => {
    for (let run = 0; run < 20; run++) {
      const model = scripted([callCreate("c1", "Первая"), callCreate("c2", "Вторая"), badRequest(), callCreate("c3", "Третья"), sayDone("Готово")]);
      const { service, execute } = setup({ mock: model });
      const chat = await service.createChat("anna");
      await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Создай три задачи" }] }));
      const failed = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
      expect(failed.metadata?.status).toBe("error");

      await readAll(await service.retry("anna", chat.id));

      const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
      expect(answer.metadata?.status).toBe("complete");
      expect(execute).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls.map(([input]) => input.title)).toEqual(["Первая", "Вторая", "Третья"]);
      expect(toolParts(answer.parts).map((part) => part.toolCallId)).toEqual(["c1", "c2", "c3"]);
    }
  });
});

describe("«Повторить»-продолжение: гонки и сбои запуска", () => {
  it("второй «Повторить», пока идёт продолжение, — ChatBusyError, второго соседа нет", async () => {
    const controlled = controlledModel();
    const { storage, service } = setup({ mock: controlled.model });
    await chatWithAnswer(storage, "error", twoCreated);

    const first = await service.retry("anna", "c1");
    await controlled.opened;
    await expect(service.retry("anna", "c1")).rejects.toBeInstanceOf(ChatBusyError);

    controlled.push(...sayDone());
    controlled.end();
    await readAll(first);
    expect((await storage.listMessages("c1")).filter((message) => message.role === "assistant")).toHaveLength(2);
  });

  it("«Стоп» во время продолжения: ответ stopped, скопированные вызовы на месте, «Повторить» снова продолжает с них", async () => {
    const controlled = controlledModel();
    const { storage, service, execute } = setup({ mock: controlled.model });
    await chatWithAnswer(storage, "error", twoCreated);

    const stream = await service.retry("anna", "c1");
    await controlled.opened;
    expect(await service.stop("anna", "c1")).toBe(true);
    await readAll(stream);

    const stopped = await currentAnswer(service);
    expect(stopped.id).not.toBe("a1");
    expect(stopped.metadata?.status).toBe("stopped");
    expect(stopped.parts.slice(0, twoCreated.length)).toEqual(twoCreated);
    expect(execute).not.toHaveBeenCalled();
  });

  it("запуск продолжения не удался — соседа нет: текущий ответ прежний, переключателя «‹ 2/2 ›» нет, ошибка доходит", async () => {
    const storage = createInMemoryChatStorage();
    // Чат не находится именно при запуске хода (например, его удалили в этот миг).
    const failingLaunch: ChatStorage = {
      ...storage,
      getChat: async (chatId) => {
        if (new Error().stack?.includes("launchTurn")) throw new Error("хранилище недоступно");
        return storage.getChat(chatId);
      },
    };
    const { service } = setup({ mock: scripted([sayDone()]) }, failingLaunch);
    await chatWithAnswer(storage, "error", twoCreated);

    await expect(service.retry("anna", "c1")).rejects.toThrow("хранилище недоступно");

    expect((await storage.listMessages("c1")).map((message) => message.id)).toEqual(["u1", "a1"]);
    const history = await service.getHistory("anna", "c1");
    expect(history.messages.at(-1)?.id).toBe("a1");
    expect(history.forks).toEqual([]);
  });

  it("выбор чата подменён (ключа нет): уровень рассуждений продолжения — как у подставленного выбора, а не сброшен", async () => {
    const leveled = { id: "leveled", displayName: "Leveled", contextWindowTokens: 1000, acceptsImages: false };
    const answering = scripted([sayDone()]);
    const provider = (id: string, apiKeyEnv: string): ProviderDescription => ({
      id,
      displayName: id,
      apiKeyEnv,
      createLanguageModel: () => answering,
      requestOptions: () => ({}),
      reasoningRequest: (level) => ({ providerOptions: { [id]: { level } } }),
    });
    const catalog = extendCatalog(mockCatalog({ mock: scripted([]) }), {
      addModels: [{ ...leveled, reasoning: { replayPastTurns: true, levels: ["low", "high"], defaultLevel: "low" }, providerModelIds: { acme: "l-1", spare: "l-1" } }],
      addProviders: [provider("acme", "ACME_KEY"), provider("spare", "SPARE_KEY")],
    });
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog,
      // Ключа выбранного в чате провайдера нет: ход идёт на выборе по умолчанию с уровнем high.
      defaultChoice: { modelId: "leveled", providerId: "spare", reasoning: "high" },
      agent: { instructions: "Ты помощник.", tools: { create_task: createTaskTool().create_task } },
      env: { ...mockEnv, SPARE_KEY: "k" },
      logError: () => {},
    });
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: "leveled", providerId: "acme", reasoning: "low" });
    await storage.insertMessage(newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "Создай" }], createdAt: "2026-01-01T00:00:00.000Z" }));
    await storage.insertMessage(
      newStoredMessage({
        id: "a1",
        chatId: "c1",
        parentId: "u1",
        role: "assistant",
        status: "error",
        parts: twoCreated,
        modelId: "leveled",
        providerId: "spare",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    await readAll(await service.retry("anna", "c1"));

    expect(answering.doStreamCalls[0]!.providerOptions).toMatchObject({ spare: { level: "high" } });
  });
});
