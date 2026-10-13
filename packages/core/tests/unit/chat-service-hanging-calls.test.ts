import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import type { ChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { AnswerStatus, StoredMessage } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { HANGING_TOOL_CALL_REASON, RESULT_UNKNOWN_REASON } from "../../src/tool-approval/approval-parts";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

type Part = StoredMessage["parts"][number];

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const callsOpenTask: LanguageModelV4StreamPart[] = [
  streamStart,
  { type: "tool-call", toolCallId: "call-1", toolName: "open_task", input: JSON.stringify({ id: "2" }) },
  finishPart("tool-calls"),
];

/** Модель: на первый запрос — вызов «открой задачу 2», дальше — короткий текст. */
function scriptedModel(first: LanguageModelV4StreamPart[] = callsOpenTask) {
  let call = 0;
  return mockModel(() => streamOf(call++ === 0 ? first : [streamStart, ...textParts(["Готово"]), finishPart()]));
}

/** Инструмент, который запускается и не отвечает: `started` — когда он запущен. */
function hangingTool() {
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const openTask = tool({
    description: "Открыть задачу.",
    inputSchema: z.object({ id: z.string() }),
    execute: async () => {
      markStarted();
      return new Promise<string>(() => {});
    },
  });
  return { openTask, started };
}

function setup(storage: ChatStorage = createInMemoryChatStorage(), model = scriptedModel()) {
  const { openTask, started } = hangingTool();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", tools: { open_task: openTask } },
    env: mockEnv,
  });
  return { storage, model, service, started };
}

async function lastAnswer(service: ChatService, chatId: string) {
  const { messages } = await service.getHistory("anna", chatId);
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

const hangingCall = (fields: Record<string, unknown> = {}): Part =>
  ({ type: "tool-open_task", toolCallId: "call-1", state: "input-available", input: { id: "2" }, ...fields }) as Part;

/** Чат с вопросом и ответом с частями `parts`, вставленными прямо в хранилище. */
async function chatWithAnswer(storage: ChatStorage, status: AnswerStatus, parts: Part[]) {
  await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.insertMessage(
    newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "Открой задачу 2" }], createdAt: "2026-01-01T00:00:00.000Z" }),
  );
  await storage.insertMessage(
    newStoredMessage({
      id: "a1",
      chatId: "c1",
      parentId: "u1",
      role: "assistant",
      parts: [{ type: "step-start" }, ...parts],
      status,
      modelId: mockModelId,
      providerId: "mock",
      createdAt: "2026-01-01T00:00:01.000Z",
    }),
  );
}

/** Модель, которая сразу отвечает текстом. */
const answeringModel = () => scriptedModel([streamStart, ...textParts(["Готово"]), finishPart()]);

const promptOf = (model: ReturnType<typeof scriptedModel>, call: number) => JSON.stringify(model.doStreamCalls[call]?.prompt);

describe("служба чата: висящие вызовы при восстановлении", () => {
  it("recoverInterruptedAnswers закрывает вызов без результата постоянным текстом", async () => {
    const { storage, service } = setup();
    await chatWithAnswer(storage, "streaming", [hangingCall()]);

    expect(await service.recoverInterruptedAnswers()).toBe(1);
    const answer = await storage.getMessage("a1");
    expect(answer?.status).toBe("interrupted");
    expect(answer?.parts.find((part) => part.type === "tool-open_task")).toMatchObject({
      state: "output-error",
      errorText: HANGING_TOOL_CALL_REASON,
    });
  });

  it("разрешённый вызов без результата закрыт прежним текстом подтверждений", async () => {
    const { storage, service } = setup();
    await chatWithAnswer(storage, "streaming", [hangingCall({ state: "approval-responded", approval: { id: "ap-1", approved: true } })]);

    await service.recoverInterruptedAnswers();
    expect((await storage.getMessage("a1"))?.parts.find((part) => part.type === "tool-open_task")).toMatchObject({
      state: "output-denied",
      approval: { approved: false, reason: RESULT_UNKNOWN_REASON },
    });
  });

  it("нечего закрывать — части не переписываются", async () => {
    const { storage, service } = setup();
    await chatWithAnswer(storage, "streaming", [hangingCall({ state: "output-available", output: "открыта" })]);
    const finishMessage = vi.spyOn(storage, "finishMessage");

    await service.recoverInterruptedAnswers();
    expect(finishMessage).toHaveBeenCalledWith("a1", { status: "interrupted" });
  });
});

describe("служба чата: после висящего вызова чат работает (SC-001, по 20 прогонов)", () => {
  const runs = 20;

  it("«Стоп» во время инструмента → новое сообщение → complete, модель вызвана", async () => {
    let completed = 0;
    for (let run = 0; run < runs; run++) {
      const { service, model, started } = setup();
      const chat = await service.createChat("anna");
      const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Открой задачу 2"))).catch(() => []);
      await started;
      expect(await service.stop("anna", chat.id)).toBe(true);
      await reading;
      expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("stopped");

      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Что с задачей?")));
      const answer = await lastAnswer(service, chat.id);
      expect(model.doStreamCalls).toHaveLength(2);
      expect(promptOf(model, 1)).toContain(HANGING_TOOL_CALL_REASON);
      if (answer.metadata?.status === "complete") completed++;
    }
    expect(completed).toBe(runs);
  });

  it("падение сервера во время инструмента (recoverInterruptedAnswers) → новое сообщение → complete", async () => {
    let completed = 0;
    for (let run = 0; run < runs; run++) {
      const { storage, service, model } = setup(createInMemoryChatStorage(), answeringModel());
      await chatWithAnswer(storage, "streaming", [hangingCall()]);
      await service.recoverInterruptedAnswers();

      await readAll(await service.sendMessage("anna", "c1", userMessage("u2", "Что с задачей?")));
      const answer = await lastAnswer(service, "c1");
      expect(model.doStreamCalls).toHaveLength(1);
      expect(promptOf(model, 0)).toContain(HANGING_TOOL_CALL_REASON);
      if (answer.metadata?.status === "complete") completed++;
    }
    expect(completed).toBe(runs);
  });

  it("старый ответ с висящим вызовом в базе → новое сообщение → complete, база не изменилась", async () => {
    let completed = 0;
    for (let run = 0; run < runs; run++) {
      const { storage, service, model } = setup(createInMemoryChatStorage(), answeringModel());
      await chatWithAnswer(storage, "stopped", [hangingCall()]);
      const before = await storage.getMessage("a1");

      await readAll(await service.sendMessage("anna", "c1", userMessage("u2", "Что с задачей?")));
      const answer = await lastAnswer(service, "c1");
      expect(model.doStreamCalls).toHaveLength(1);
      expect(promptOf(model, 0)).toContain(HANGING_TOOL_CALL_REASON);
      expect(await storage.getMessage("a1")).toEqual(before);
      if (answer.metadata?.status === "complete") completed++;
    }
    expect(completed).toBe(runs);
  });

  it("запрос после «Стоп» и запрос после восстановления начинаются одинаково: закрытие в базе и в запросе совпадает", async () => {
    const stopped = setup();
    const chat = await stopped.service.createChat("anna");
    const reading = readAll(await stopped.service.sendMessage("anna", chat.id, userMessage("u1", "Открой задачу 2"))).catch(() => []);
    await stopped.started;
    await stopped.service.stop("anna", chat.id);
    await reading;
    await readAll(await stopped.service.sendMessage("anna", chat.id, userMessage("u2", "Что с задачей?")));

    const old = setup(createInMemoryChatStorage(), answeringModel());
    await chatWithAnswer(old.storage, "stopped", [hangingCall()]);
    await readAll(await old.service.sendMessage("anna", "c1", userMessage("u2", "Что с задачей?")));

    const closedCall = (prompt: string) => JSON.parse(prompt).find((message: { role: string }) => message.role === "tool");
    expect(closedCall(promptOf(stopped.model, 1))).toEqual(closedCall(promptOf(old.model, 0)));
  });
});

describe("служба чата: начатый вызов в базе до выполнения инструмента", () => {
  it("падение посреди инструмента: вызов уже записан; восстановление показывает его прерванным, «Повторить» продолжает с ним", async () => {
    const live = setup(createInMemoryChatStorage(), scriptedModel());
    const chat = await live.service.createChat("anna");
    void readAll(await live.service.sendMessage("anna", chat.id, userMessage("u1", "Открой задачу 2"))).catch(() => []);
    await live.started;
    // Сервер упал, как только инструмент начал работу: в базе только то, что записано к этой минуте.
    const saved = (await live.storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(saved.parts).toContainEqual(expect.objectContaining({ type: "tool-open_task", toolCallId: "call-1", state: "input-available" }));

    const restarted = setup(createInMemoryChatStorage(), answeringModel());
    await chatWithAnswer(restarted.storage, "streaming", saved.parts.filter((part) => part.type !== "step-start"));
    expect(await restarted.service.recoverInterruptedAnswers()).toBe(1);
    const recovered = await lastAnswer(restarted.service, "c1");
    expect(recovered.parts).toContainEqual(
      expect.objectContaining({ type: "tool-open_task", toolCallId: "call-1", state: "output-error", errorText: HANGING_TOOL_CALL_REASON }),
    );

    await readAll(await restarted.service.retry("anna", "c1"));
    // «Повторить» продолжает с прерванного вызова: модель видит его закрытым, инструмент второй раз сам не запускается.
    expect(promptOf(restarted.model, 0)).toContain(HANGING_TOOL_CALL_REASON);
    expect((await lastAnswer(restarted.service, "c1")).parts).toContainEqual(expect.objectContaining({ toolCallId: "call-1", state: "output-error" }));
  });
});
