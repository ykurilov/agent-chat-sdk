import { APICallError, readUIMessageStream, tool } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentChatMessage, StoredMessage, UsageRecord } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { finishPart, mockCatalog, mockModel, mockModelId, readAll, streamOf, streamStart, textParts, withoutFrozenContext } from "../support/mock-model";
import { chatId, savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

type Part = StoredMessage["parts"][number];

const copiedParts: Part[] = [
  { type: "step-start" },
  { type: "text", text: "Создаю задачи", state: "done" },
  { type: "tool-create_task", toolCallId: "c1", state: "output-available", input: { title: "Первая" }, output: "создана" } as Part,
  { type: "step-start" },
  { type: "tool-create_task", toolCallId: "c2", state: "output-available", input: { title: "Вторая" }, output: "создана" } as Part,
];

/** Вопрос в хранилище и сосед-продолжение «a1» с копией выполненных шагов: записывает его сам ход. */
async function storageWithCopy(): Promise<{ storage: ChatStorage; message: AgentChatMessage }> {
  const storage = await storageWithQuestion();
  const message: AgentChatMessage = { id: "a1", role: "assistant", parts: copiedParts, metadata: { reasoningDurationsMs: {} } };
  return { storage, message };
}

function createTaskTool() {
  const execute = vi.fn(async ({ title }: { title: string }) => `создана ${title}`);
  return { execute, tools: { create_task: tool({ description: "Создать задачу.", inputSchema: z.object({ title: z.string() }), execute }) } };
}

const answering = (text = "Третья создана") => mockModel(() => streamOf([streamStart, ...textParts([text]), finishPart()]));

function replayTurn(storage: ChatStorage, message: AgentChatMessage, model: MockLanguageModelV4, extra: Parameters<typeof startTurn>[2] = {}) {
  return startTurn(storage, model, {
    history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Создай три задачи" }] }, message],
    resume: { message, usage: null, replay: true },
    ...extra,
  });
}

async function assemble(chunks: UIMessageChunk[]): Promise<AgentChatMessage> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let last: AgentChatMessage | undefined;
  for await (const message of readUIMessageStream<AgentChatMessage>({ stream })) last = message;
  return last!;
}

describe("runAgentTurn: продолжение с копией выполненных шагов (resume.replay, FR-024, FR-025)", () => {
  it("клиент получает один start, затем куски копии, затем новые куски — и собирает копию плюс продолжение", async () => {
    const { storage, message } = await storageWithCopy();
    const chunks = await readAll(replayTurn(storage, message, answering()));

    expect(chunks[0]).toEqual({ type: "start", messageId: "a1", messageMetadata: { modelId: mockModelId, providerId: "mock" } });
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    // Копия идёт сразу за start: первый вызов приходит раньше любого куска модели.
    const firstCopied = chunks.findIndex((chunk) => chunk.type === "tool-input-available");
    const firstNew = chunks.findIndex((chunk) => chunk.type === "text-delta" && chunk.delta === "Третья создана");
    expect(firstCopied).toBeGreaterThan(0);
    expect(firstCopied).toBeLessThan(firstNew);

    const assembled = await assemble(chunks);
    expect(assembled.id).toBe("a1");
    expect(assembled.parts.slice(0, copiedParts.length)).toEqual(copiedParts);
    expect(textOf(assembled.parts)).toBe("Создаю задачиТретья создана");
  });

  it("сохранение идёт от скопированных частей: копия не задвоена, продолжение дописано", async () => {
    const { storage, message } = await storageWithCopy();
    await readAll(replayTurn(storage, message, answering()));

    const answer = (await savedAnswer(storage))!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.slice(0, copiedParts.length)).toEqual(copiedParts);
    expect(answer.parts.filter((part) => part.type === "tool-create_task")).toHaveLength(2);
    expect(textOf(answer.parts)).toBe("Создаю задачиТретья создана");
  });

  it("исходное сообщение продолжения не меняется: сохранение собирает свою копию", async () => {
    const { storage, message } = await storageWithCopy();
    const before = structuredClone(message);
    await readAll(replayTurn(storage, message, answering()));
    expect(message).toEqual(before);
  });

  it("модель видит выполненные вызовы с результатами; инструмент заново не вызывается", async () => {
    const { storage, message } = await storageWithCopy();
    const model = answering();
    const { execute, tools } = createTaskTool();
    await readAll(replayTurn(storage, message, model, { tools }));

    expect(execute).not.toHaveBeenCalled();
    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
    expect(prompt).toContain("Первая");
    expect(prompt).toContain("Вторая");
    expect(model.doStreamCalls[0]!.prompt.filter((entry) => entry.role === "tool")).toHaveLength(2);
  });

  it("в журнал расходов идёт только новый ход, расход ответа — тоже только его (FR-027)", async () => {
    const { storage, message } = await storageWithCopy();
    const written: UsageRecord[] = [];
    const recording = { ...storage, insertUsageRecord: async (record: UsageRecord) => void written.push(record) };
    await readAll(replayTurn(recording, message, answering(), { ownerId: "anna" }));

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ inputTokens: 100, outputTokens: 30 });
    expect((await savedAnswer(storage))!.usage).toMatchObject({ inputTokens: 100, outputTokens: 30 });
  });

  it("куски копии не считаются началом ответа: перегруженный провайдер уступает запасному (FR-029)", async () => {
    const { storage, message } = await storageWithCopy();
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseHeaders: { "retry-after-ms": "1" } });
      },
    });
    const backup = answering("Ответ запасного");
    const logged: string[] = [];
    const chunks = await readAll(
      replayTurn(storage, message, primary, {
        catalog: mockCatalog({ mock: primary, "mock-backup": backup }),
        providerFallback: {},
        logError: (line) => logged.push(line),
      }),
    );

    expect(backup.doStreamCalls).toHaveLength(1);
    expect(logged.some((line) => line.startsWith("[запасной провайдер]"))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    const answer = (await savedAnswer(storage))!;
    expect(answer).toMatchObject({ status: "complete", providerId: "mock-backup" });
    expect(answer.parts.filter((part) => part.type === "tool-create_task")).toHaveLength(2);
    expect(textOf(answer.parts)).toBe("Создаю задачиОтвет запасного");
  });

  it("обрыв до первого куска модели: в базе — копия с ошибкой, без задвоения", async () => {
    const { storage, message } = await storageWithCopy();
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "400", url: "https://p.test", requestBodyValues: {}, statusCode: 400 });
      },
    });
    await readAll(replayTurn(storage, message, failing, { logError: () => {} }));

    const answer = (await savedAnswer(storage))!;
    expect(answer.status).toBe("error");
    expect(withoutFrozenContext(answer.parts)).toEqual(copiedParts);
  });
});
