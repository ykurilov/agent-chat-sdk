import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { AnswerStatus, StoredMessage } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

/*
 * «Переделать ответ» у оборванного ответа пишет его с чистого листа: части прежнего ответа не переносятся ни в новый
 * вариант, ни в запрос к модели. Продолжение с выполненных шагов — дело «Повторить» (chat-service-retry-continues).
 */

type Part = StoredMessage["parts"][number];

const step: Part = { type: "step-start" };
const hangingQuiz = { type: "tool-start_quiz", toolCallId: "call_old", state: "input-available", input: { kind: "quiz" } } as Part;
const createdTask = (id: string): Part =>
  ({ type: "tool-create_task", toolCallId: id, state: "output-available", input: { title: id }, output: `создана ${id}` }) as Part;

const sayDone = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

function scripted(script: LanguageModelV4StreamPart[][]) {
  let call = 0;
  return new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(script[call++] ?? sayDone("Ещё")) }) });
}

function setup(model: MockLanguageModelV4, storage: ChatStorage = createInMemoryChatStorage()) {
  const startQuiz = vi.fn(async () => "карточка показана");
  const createTask = vi.fn(async ({ title }: { title: string }) => `создана ${title}`);
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: {
      instructions: "Ты помощник.",
      tools: {
        start_quiz: tool({ description: "Показать тест.", inputSchema: z.object({ kind: z.string() }), execute: startQuiz }),
        create_task: tool({ description: "Создать задачу.", inputSchema: z.object({ title: z.string() }), execute: createTask }),
      },
    },
    env: mockEnv,
    compaction: false,
    logError: () => {},
  });
  return { storage, service, startQuiz, createTask };
}

/** Чат «c1»: вопрос «u1» и оборванный ответ «a1» с частями `parts`. */
async function chatWithBrokenAnswer(storage: ChatStorage, status: AnswerStatus, parts: Part[]) {
  await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.insertMessage(
    newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "Давай попробуем" }], createdAt: "2026-01-01T00:00:00.000Z" }),
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
    }),
  );
}

/** Новый вариант начат с чистого листа: в частях только новый текст, первый же шаг — запрос к модели без прежнего ответа. */
async function expectFreshAnswer(service: ReturnType<typeof setup>["service"], model: MockLanguageModelV4, text: string) {
  const { messages } = await service.getHistory("anna", "c1");
  const answer = messages.at(-1)!;
  expect(answer.id).not.toBe("a1");
  expect(answer.metadata?.status).toBe("complete");
  expect(answer.parts).toEqual([step, { type: "text", text, state: "done" }]);
  expect(model.doStreamCalls).toHaveLength(1);
  const roles = model.doStreamCalls[0]!.prompt.map((entry) => entry.role);
  expect(roles).not.toContain("assistant");
  expect(roles).not.toContain("tool");
  return answer;
}

describe("«Переделать ответ» у оборванного ответа — с чистого листа", () => {
  it("ответ прерван на вызове без результата: старый вызов не переносится, первый шаг — запрос к модели", async () => {
    const model = scripted([sayDone("Начнём тест.")]);
    const { storage, service, startQuiz } = setup(model);
    const broken = [step, { type: "reasoning", text: "Start quiz.", state: "done" } as Part, hangingQuiz];
    await chatWithBrokenAnswer(storage, "interrupted", broken);

    await readAll(await service.regenerate("anna", "c1", "a1"));

    const answer = await expectFreshAnswer(service, model, "Начнём тест.");
    expect(JSON.stringify(answer.parts)).not.toContain("call_old");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain("call_old");
    expect(startQuiz).not.toHaveBeenCalled();
    // Прежний ответ — соседний вариант, как был.
    expect(await storage.getMessage("a1")).toMatchObject({ status: "interrupted", parts: broken });
    const { forks } = await service.getHistory("anna", "c1");
    expect(forks).toEqual([{ messageId: answer.id, siblingIds: ["a1", answer.id] }]);
  });

  it("ответ с ошибкой и выполненными вызовами: вызовы не копируются", async () => {
    const model = scripted([sayDone("С нуля.")]);
    const { storage, service, createTask } = setup(model);
    await chatWithBrokenAnswer(storage, "error", [step, createdTask("t1"), step, createdTask("t2")]);

    await readAll(await service.regenerate("anna", "c1", "a1"));

    await expectFreshAnswer(service, model, "С нуля.");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("остановленный ответ без инструментов: написанный текст не переносится", async () => {
    const model = scripted([sayDone("Другой ответ.")]);
    const { storage, service } = setup(model);
    await chatWithBrokenAnswer(storage, "stopped", [step, { type: "text", text: "Начал было", state: "done" }]);

    await readAll(await service.regenerate("anna", "c1", "a1"));

    const answer = await expectFreshAnswer(service, model, "Другой ответ.");
    expect(JSON.stringify(answer.parts)).not.toContain("Начал было");
  });

  it("правка вопроса после оборванного ответа: старый вызов не попадает ни в ответ, ни в запрос", async () => {
    const model = scripted([sayDone("Ответ на правку.")]);
    const { storage, service } = setup(model);
    await chatWithBrokenAnswer(storage, "interrupted", [step, hangingQuiz]);

    await readAll(await service.editMessage("anna", "c1", "u1", { id: "u2", role: "user", parts: [{ type: "text", text: "Давай тест" }] }));

    const answer = await expectFreshAnswer(service, model, "Ответ на правку.");
    expect((await storage.getMessage(answer.id))?.parentId).toBe("u2");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain("call_old");
  });
});
