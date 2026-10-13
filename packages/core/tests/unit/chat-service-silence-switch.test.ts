import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { readUIMessageStream } from "ai";
import type { UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STEP_RESET_PART_TYPE, withoutResetSteps } from "../../src/agent-run/step-reset";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import type { StoredMessage, UsageRecord } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import type { UIMessageChunk } from "ai";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { AfterTurnHandler } from "../../src/turn-hooks/turn-hooks";
import { finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts, withoutFrozenContext } from "./support/mock-model";

const userMessage = (id: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text: "Привет" }] });

/** Модель пишет `text` и молчит до отмены. */
const writesThenSilent = (text: string) =>
  new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue(streamStart);
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: text });
          abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
        },
      }),
    }),
  });

/** Модель пишет `text` и заканчивает шаг, только когда тест отпустит. */
function writesUntilReleased(text: string) {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          for (const part of [streamStart, ...textParts([text]).slice(0, -1)]) controller.enqueue(part);
          await released;
          for (const part of [...textParts([text]).slice(-1), finishPart()]) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });
  return { model, release };
}

/** Собранное из потока сообщение, как его видит вкладка. */
async function assembled(stream: ReadableStream<UIMessageChunk>): Promise<UIMessage> {
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream })) last = message;
  return last!;
}

const answering = (text: string) => new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts([text]), finishPart()]) }) });

function setup(
  primary: MockLanguageModelV4,
  backup: MockLanguageModelV4,
  agent: Partial<ChatServiceOptions["agent"]> = {},
  storage: ChatStorage = createInMemoryChatStorage(),
  extra: Partial<ChatServiceOptions> = {},
) {
  const afterTurn = vi.fn<AfterTurnHandler>();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: primary, "mock-backup": backup }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: {
      instructions: "Ты помощник.",
      modelSilenceTimeout: { firstChunkMs: 1_000, betweenChunksMs: 1_000 },
      providerFallback: { onSilence: "restart-step-on-next" },
      ...agent,
    },
    env: mockEnv,
    logError: () => {},
    afterTurn,
    ...extra,
  });
  return { storage, service, afterTurn };
}

async function lastAnswer(storage: ChatStorage, chatId: string): Promise<StoredMessage> {
  return (await storage.listMessages(chatId)).filter((message) => message.role === "assistant").at(-1)!;
}

describe("служба: переход посреди ответа при молчании модели", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("настройка из agent.providerFallback: шаг заново у запасного, клиент получает data-step-reset", async () => {
    const primary = writesThenSilent("Стёртое");
    const backup = answering("Ответ запасного");
    const { service, storage } = setup(primary, backup);
    const chat = await service.createChat("anna");

    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    await vi.advanceTimersByTimeAsync(1_000);
    const chunks = await reading;

    expect(chunks.some((chunk) => chunk.type === STEP_RESET_PART_TYPE)).toBe(true);
    const answer = await lastAnswer(storage, chat.id);
    expect(answer).toMatchObject({ status: "complete", providerId: "mock-backup" });
    expect(withoutFrozenContext(answer.parts)).toMatchObject([{ type: "step-start" }, { type: "text", text: "Ответ запасного" }]);
  });

  it("modelDetails: false — отметка data-step-reset без провайдера: экрану нужен только её тип", async () => {
    const { service } = setup(writesThenSilent("Стёртое"), answering("Ответ запасного"), {}, undefined, { chatCapabilities: () => ({ modelDetails: false }) });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    await vi.advanceTimersByTimeAsync(1_000);
    const chunks = await reading;
    expect(chunks.find((chunk) => chunk.type === STEP_RESET_PART_TYPE)).toEqual({ type: STEP_RESET_PART_TYPE, data: {} });
    expect(JSON.stringify(chunks)).not.toContain("mock-backup");
  });

  it("неверная настройка перехода — ошибка при создании службы", () => {
    expect(() => setup(answering("a"), answering("b"), { providerFallback: { onSilence: "restart" as never } })).toThrow(/onSilence/);
  });

  it("остановка службы началась — нового захода нет: ход остановлен (stopReason: shutdown), запасного не зовут", async () => {
    const primary = writesThenSilent("Начало");
    const backup = answering("Запасной");
    const { service, storage, afterTurn } = setup(primary, backup);
    const chat = await service.createChat("anna");

    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    await vi.advanceTimersByTimeAsync(100);
    const flushing = service.flush({ waitForAnswersMs: 60_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await flushing;
    await reading;

    expect(backup.doStreamCalls).toHaveLength(0);
    expect((await lastAnswer(storage, chat.id)).status).toBe("stopped");
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "stopped", stopReason: "shutdown" });
  });

  it("срок хода идёт и во время перехода: вышел у запасного — ход остановлен, нового захода нет", async () => {
    const primary = writesThenSilent("Начало");
    const backup = writesThenSilent("Запасной пишет");
    const { service, storage, afterTurn } = setup(primary, backup, { turnTimeoutMs: 1_500 });
    const chat = await service.createChat("anna");

    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    await vi.advanceTimersByTimeAsync(5_000);
    const chunks = await reading;

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(chunks.at(-1)?.type).toBe("abort");
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "stopped", parts: expect.arrayContaining([expect.objectContaining({ text: "Запасной пишет" })]) });
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "stopped", stopReason: "timeout" });
  });

  it("вторая вкладка подключилась после стирания: видит только ответ запасного", async () => {
    const primary = writesThenSilent("Стёртое");
    const backup = writesUntilReleased("Ответ запасного");
    const { service } = setup(primary, backup.model);
    const chat = await service.createChat("anna");

    const firstTab = assembled(await service.sendMessage("anna", chat.id, userMessage("u1")));
    await vi.advanceTimersByTimeAsync(1_100);
    const secondTab = assembled((await service.subscribe("anna", chat.id))!);
    backup.release();
    await vi.advanceTimersByTimeAsync(100);

    for (const message of [await firstTab, await secondTab]) {
      const text = withoutResetSteps(message.parts).flatMap((part) => (part.type === "text" ? [part.text] : []));
      expect(text).toEqual(["Ответ запасного"]);
    }
  });

  it("сервер упал после стирания: восстановление пишет в журнал и стёртый шаг основного — он оплачен", async () => {
    const primary = writesThenSilent("а".repeat(3_000));
    const backup = writesUntilReleased("Ответ запасного");
    const { service, storage } = setup(primary, backup.model);
    const chat = await service.createChat("anna");
    void readAll(await service.sendMessage("anna", chat.id, userMessage("u1")));
    await vi.advanceTimersByTimeAsync(2_000);
    // Сервер упал, пока запасной пишет: в базе остался идущий ответ — его и поднимает новый запуск.
    const crashed = await lastAnswer(storage, chat.id);
    const written: UsageRecord[] = [];
    const memory = createInMemoryChatStorage();
    const restartedStorage: ChatStorage = { ...memory, insertUsageRecord: async (record) => void written.push(record) };
    await restartedStorage.createChat({ id: chat.id, ownerId: "anna", modelId: mockModelId, providerId: "mock" });
    await restartedStorage.insertMessage(crashed);
    // Знак жизни ответа давно не обновлялся: ответ брошен.
    await vi.advanceTimersByTimeAsync(30 * 60_000);

    await setup(primary, backup.model, {}, restartedStorage).service.recoverInterruptedAnswers();

    const recovered = await lastAnswer(restartedStorage, chat.id);
    expect(recovered.status).toBe("interrupted");
    expect(recovered.parts.some((part) => part.type === "text" && part.text.includes("ааа"))).toBe(false);
    const primaryRecord = written.find((record) => record.providerId === "mock");
    expect(primaryRecord?.outputTokens).toBeGreaterThanOrEqual(1_500);
    expect(primaryRecord?.estimated).toBe(true);
    backup.release();
  });
});
