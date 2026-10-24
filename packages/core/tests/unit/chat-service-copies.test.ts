import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ANSWER_STALE_AFTER_MS, STALE_ANSWERS_SWEEP_EVERY_MS } from "../../src/agent-run/answer-liveness";
import { createChatService } from "../../src/chat-service";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import { newStoredMessage } from "../../src/conversation/types";
import type { UsageRecord } from "../../src/conversation/types";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { doneNotice } from "./support/notice-chat";
import { finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const price = { inputPerMillion: 1, outputPerMillion: 4, cachedInputPerMillion: 0.1 };

/** Модель: шаг 1 — вызов `slow`, шаг 2 — ответ текстом; у каждого хода свой сценарий. */
function callThenAnswer() {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const answered = prompt.some((message) => message.role === "tool");
      const parts: LanguageModelV4StreamPart[] = answered
        ? [streamStart, ...textParts(["Готово."]), finishPart()]
        : [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "slow", input: "{}" }, finishPart("tool-calls")];
      return { stream: streamOf(parts) };
    },
  });
}

/** Общее хранилище двух копий сервера; записи журнала расхода видны тесту. */
async function sharedStorage() {
  const memory = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const storage = {
    ...memory,
    insertUsageRecord: async (record: UsageRecord) => {
      written.push(record);
      await memory.insertUsageRecord(record);
    },
  };
  await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.createChat({ id: "c2", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  return { storage, written };
}

/** Копия сервера: инструмент `slow` думает 90 с по часам теста. */
function serverCopy(storage: ChatStorage, logError: (line: string) => void = () => {}) {
  return createChatService({
    storage,
    catalog: mockCatalog({ mock: callThenAnswer() }, { pricing: price }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: {
      instructions: "Ты помощник.",
      tools: {
        slow: tool({ description: "Долго", inputSchema: z.object({}), execute: () => new Promise<string>((resolve) => setTimeout(() => resolve("ок"), 90_000)) }),
      },
    },
    env: mockEnv,
    logError,
  });
}

/** Ответ, оставленный упавшей копией: идёт, последний знак жизни — `aliveAt`, расход шага записан по ходу. */
function abandonedAnswer(id: string, chatId: string, aliveAt: string) {
  return newStoredMessage({
    id,
    chatId,
    role: "assistant",
    parts: [{ type: "text", text: "Начало", state: "streaming" }],
    status: "streaming",
    modelId: mockModelId,
    providerId: "mock",
    createdAt: aliveAt,
    usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 },
  });
}

const statusOf = async (storage: { getMessage(id: string): Promise<{ status?: string } | null> }, id: string) =>
  (await storage.getMessage(id))?.status;

describe("служба чата: несколько копий сервера на одной базе (FR-060)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-01T10:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("новая копия при старте и в проверках не трогает живой ответ соседа; ответ доходит до конца, расход записан один раз", async () => {
    const { storage, written } = await sharedStorage();
    const first = serverCopy(storage);
    const second = serverCopy(storage);
    const stream = await first.sendMessage("anna", "c1", { id: "q1", role: "user", parts: [{ type: "text", text: "Сделай" }] });
    const reading = readAll(stream);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(await second.recoverInterruptedAnswers()).toBe(0);
    // Инструмент молчит ещё 70 с — проверки второй копии идут всё это время.
    await vi.advanceTimersByTimeAsync(80_000);
    await reading;

    const [, answer] = await storage.listMessages("c1");
    expect(answer).toMatchObject({ role: "assistant", status: "complete" });
    expect(written.filter((record) => record.source === "answer")).toHaveLength(1);
    await first.flush();
    await second.flush();
  });

  it("свежий ответ упавшей копии при старте не трогается, а позже его прерывает проверка — без нового вызова", async () => {
    const { storage, written } = await sharedStorage();
    await storage.insertMessage(abandonedAnswer("a1", "c1", new Date().toISOString()));
    const copy = serverCopy(storage);

    expect(await copy.recoverInterruptedAnswers()).toBe(0);
    expect(await statusOf(storage, "a1")).toBe("streaming");

    await vi.advanceTimersByTimeAsync(ANSWER_STALE_AFTER_MS + STALE_ANSWERS_SWEEP_EVERY_MS + 1_000);
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    expect(written).toHaveLength(1);
    await copy.flush();
  });

  it("единственная копия ({ soleServer: true }) прерывает свежий брошенный ответ сразу при старте, расход записан", async () => {
    const { storage, written } = await sharedStorage();
    await storage.insertMessage(abandonedAnswer("a1", "c1", new Date().toISOString()));
    const copy = serverCopy(storage);

    expect(await copy.recoverInterruptedAnswers({ soleServer: true })).toBe(1);
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    expect((await storage.getMessage("a1"))?.parts).toEqual([{ type: "text", text: "Начало", state: "streaming" }]);
    expect(written).toHaveLength(1);
    await copy.flush();
  });

  it("{ soleServer: true } не трогает ответ, который ведёт этот же процесс", async () => {
    const { storage } = await sharedStorage();
    const copy = serverCopy(storage);
    const reading = readAll(await copy.sendMessage("anna", "c1", { id: "q1", role: "user", parts: [{ type: "text", text: "Сделай" }] }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await copy.recoverInterruptedAnswers({ soleServer: true })).toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    await reading;
    expect((await storage.listMessages("c1")).at(-1)).toMatchObject({ role: "assistant", status: "complete" });
    await copy.flush();
  });

  it("брошенный давно ответ прерывается сразу при старте", async () => {
    const { storage } = await sharedStorage();
    await storage.insertMessage(abandonedAnswer("a1", "c1", new Date(Date.now() - ANSWER_STALE_AFTER_MS - 1_000).toISOString()));
    const copy = serverCopy(storage);

    expect(await copy.recoverInterruptedAnswers()).toBe(1);
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    await copy.flush();
  });

  it("две копии восстанавливают один ответ разом — он прерван один раз, расход записан один раз", async () => {
    const { storage, written } = await sharedStorage();
    await storage.insertMessage(abandonedAnswer("a1", "c1", "2026-01-01T00:00:00.000Z"));
    const first = serverCopy(storage);
    const second = serverCopy(storage);

    const counts = await Promise.all([first.recoverInterruptedAnswers(), second.recoverInterruptedAnswers()]);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    expect(written).toHaveLength(1);
    await first.flush();
    await second.flush();
  });

  it("живая копия дописала свою долю сразу после прерывания — восстановление её не вычитает, расход полный и без задвоения", async () => {
    const { storage, written } = await sharedStorage();
    await storage.insertMessage(abandonedAnswer("a1", "c1", "2026-01-01T00:00:00.000Z"));
    const racing: ChatStorage = {
      ...storage,
      finishMessage: async (messageId, final) => {
        await storage.finishMessage(messageId, final);
        // Ход, которого сочли брошенным, жив: узнал о прерывании и записал расход сверх снимка в ответе.
        await storage.insertUsageRecord({
          id: "live-copy",
          ownerId: "anna",
          chatId: "c1",
          messageId,
          source: "answer",
          modelId: mockModelId,
          providerId: "mock",
          inputTokens: 50,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 10,
          reasoningTokens: 0,
          costUsd: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      },
    };
    const copy = serverCopy(racing);

    expect(await copy.recoverInterruptedAnswers()).toBe(1);

    expect(written.reduce((total, record) => total + record.inputTokens, 0)).toBe(150);
    expect(written.reduce((total, record) => total + record.outputTokens, 0)).toBe(30);
    await copy.flush();
  });

  it("битый ответ не держит остальные: восстановление прерывает другие, пишет id битого в журнал сервера, старт не падает", async () => {
    const { storage } = await sharedStorage();
    const long = "2026-01-01T00:00:00.000Z";
    await storage.insertMessage(abandonedAnswer("a1", "c1", long));
    await storage.insertMessage(abandonedAnswer("b1", "c2", long));
    const broken: ChatStorage = {
      ...storage,
      getMessage: async (messageId) => {
        if (messageId === "a1") throw new Error("незнакомый формат записи");
        return storage.getMessage(messageId);
      },
    };
    const logged: string[] = [];
    const copy = serverCopy(broken, (line) => logged.push(line));

    expect(await copy.recoverInterruptedAnswers()).toBe(1);

    expect(await statusOf(storage, "b1")).toBe("interrupted");
    expect(await statusOf(storage, "a1")).toBe("streaming");
    expect(logged.join("\n")).toMatch(/a1.*незнакомый формат записи/);
    await copy.flush();
  });

  it("первая проверка при старте упала — регулярная проверка всё равно идёт", async () => {
    const { storage } = await sharedStorage();
    let failures = 1;
    const flaky: ChatStorage = {
      ...storage,
      listSilentAnswerIds: async (filter) => {
        if (failures-- > 0) throw new Error("база недоступна");
        return storage.listSilentAnswerIds!(filter);
      },
    };
    const copy = serverCopy(flaky);
    await expect(copy.recoverInterruptedAnswers()).rejects.toThrow("база недоступна");
    await storage.insertMessage(abandonedAnswer("a1", "c1", new Date().toISOString()));

    await vi.advanceTimersByTimeAsync(ANSWER_STALE_AFTER_MS + STALE_ANSWERS_SWEEP_EVERY_MS + 1_000);
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    await copy.flush();
  });

  it("штатная остановка: flush закрывает свои идущие ответы как «Стоп» — следующему старту прерывать нечего", async () => {
    const { storage } = await sharedStorage();
    const stopping = serverCopy(storage);
    const stream = await stopping.sendMessage("anna", "c1", { id: "q1", role: "user", parts: [{ type: "text", text: "Сделай" }] });
    const reading = readAll(stream).catch(() => []);
    await vi.advanceTimersByTimeAsync(1_000);

    await stopping.flush();
    const started = serverCopy(storage);
    expect(await started.recoverInterruptedAnswers()).toBe(0);
    const [, answer] = await storage.listMessages("c1");
    expect(answer).toMatchObject({ role: "assistant", status: "stopped" });

    await vi.advanceTimersByTimeAsync(100_000);
    await reading;
    await started.flush();
  });

  it("чтение истории прерывает брошенный дольше порога ответ этого чата сразу; ответы других чатов не трогает", async () => {
    const { storage } = await sharedStorage();
    const long = new Date(Date.now() - ANSWER_STALE_AFTER_MS - 1_000).toISOString();
    await storage.insertMessage(abandonedAnswer("a1", "c1", long));
    await storage.insertMessage(abandonedAnswer("b1", "c2", long));
    const copy = serverCopy(storage);

    const history = await copy.getHistory("anna", "c1");

    expect(history.messages.at(-1)?.metadata?.status).toBe("interrupted");
    expect(history).toMatchObject({ running: false, detachedAnswer: false });
    expect(await statusOf(storage, "b1")).toBe("streaming");
  });

  it("свежий брошенный ответ при чтении истории не трогается, но история говорит, что живого потока здесь нет", async () => {
    const { storage } = await sharedStorage();
    await storage.insertMessage(abandonedAnswer("a1", "c1", new Date().toISOString()));
    const copy = serverCopy(storage);

    const history = await copy.getHistory("anna", "c1");

    expect(history.messages.at(-1)?.metadata?.status).toBe("streaming");
    expect(history).toMatchObject({ running: false, detachedAnswer: true });
    expect(await statusOf(storage, "a1")).toBe("streaming");
  });

  it("живой ответ своей копии — поток есть, признака нет; законченная история — признака нет", async () => {
    const { storage } = await sharedStorage();
    const copy = serverCopy(storage);
    const reading = readAll(await copy.sendMessage("anna", "c1", { id: "q1", role: "user", parts: [{ type: "text", text: "Сделай" }] }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await copy.getHistory("anna", "c1")).toMatchObject({ running: true, detachedAnswer: false });
    await vi.advanceTimersByTimeAsync(100_000);
    await reading;
    expect(await copy.getHistory("anna", "c1")).toMatchObject({ running: false, detachedAnswer: false });
    await copy.flush();
  });

  it("хранилище без listSilentAnswerIds: при старте прерываются все идущие ответы, как раньше, проверок дальше нет, в журнале — предупреждение", async () => {
    const { storage } = await sharedStorage();
    const { listSilentAnswerIds: _absent, markAnswerAlive: _alsoAbsent, ...olderStorage } = storage;
    await storage.insertMessage(abandonedAnswer("a1", "c1", new Date().toISOString()));
    const logged: string[] = [];
    const copy = serverCopy(olderStorage, (line) => logged.push(line));

    expect(await copy.recoverInterruptedAnswers()).toBe(1);
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    expect(logged.join("\n")).toContain("listSilentAnswerIds");

    await storage.insertMessage(abandonedAnswer("b1", "c2", new Date().toISOString()));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await statusOf(storage, "b1")).toBe("streaming");
    expect((await copy.getHistory("anna", "c2")).detachedAnswer).toBe(true);
    expect(await statusOf(storage, "b1")).toBe("streaming");
    await copy.flush();
  });

  it("после flush повторный recoverInterruptedAnswers снова запускает проверку", async () => {
    const { storage } = await sharedStorage();
    const copy = serverCopy(storage);
    await copy.recoverInterruptedAnswers();
    await copy.flush();
    await copy.recoverInterruptedAnswers();
    await storage.insertMessage(abandonedAnswer("a1", "c2", new Date().toISOString()));

    await vi.advanceTimersByTimeAsync(ANSWER_STALE_AFTER_MS + STALE_ANSWERS_SWEEP_EVERY_MS + 1_000);
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    await copy.flush();
  });

  it("после flush проверка остановлена: копия выключается и чужие ответы больше не трогает", async () => {
    const { storage } = await sharedStorage();
    const copy = serverCopy(storage);
    await copy.recoverInterruptedAnswers();
    await copy.flush();
    await storage.insertMessage(abandonedAnswer("a1", "c2", new Date().toISOString()));

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await statusOf(storage, "a1")).toBe("streaming");
  });
});

describe("доставка итогов фона при ходе на другой копии", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-01T10:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const notice = (key: string) => ({ ownerId: "anna", chatId: "c1", notices: [doneNotice("Отчёт", "готово", key)], wakeAgent: true, deliveryKey: key });

  it("ход идёт на соседней копии — чат занят: ничего не пишется, ветка не раздваивается; после хода итог доставляется", async () => {
    const { storage } = await sharedStorage();
    const first = serverCopy(storage);
    const second = serverCopy(storage);
    const reading = readAll(await first.sendMessage("anna", "c1", { id: "q1", role: "user", parts: [{ type: "text", text: "Сделай" }] }));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await second.deliverNotices(notice("k1"))).toEqual({ status: "busy", turnStarted: false });
    expect((await storage.listMessages("c1")).map((message) => message.role)).toEqual(["user", "assistant"]);

    await vi.advanceTimersByTimeAsync(80_000);
    await reading;
    expect(await second.deliverNotices(notice("k1"))).toMatchObject({ status: "delivered", turnStarted: true });
    await vi.advanceTimersByTimeAsync(100_000);
    const messages = await storage.listMessages("c1");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // Итог дописан после законченного ответа, а не рядом с ним.
    expect(messages[2]!.parentId).toBe(messages[1]!.id);
    await first.flush();
    await second.flush();
  });

  it("удаление, пока ход идёт на соседней копии, — «занято»: чат, сообщения и аренда соседа целы, ход доходит до конца (аудит codex-2)", async () => {
    const { storage } = await sharedStorage();
    const first = serverCopy(storage);
    const second = serverCopy(storage);
    const reading = readAll(await first.sendMessage("anna", "c1", { id: "q1", role: "user", parts: [{ type: "text", text: "Сделай" }] }));
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(second.deleteChat("anna", "c1")).rejects.toBeInstanceOf(ChatBusyError);
    expect(await storage.getChat("c1")).not.toBeNull();
    // Аренда соседа на месте: третий её не возьмёт.
    expect(await storage.claimChatTurn?.("c1", "probe", 1_000)).toBe(false);

    await vi.advanceTimersByTimeAsync(80_000);
    await reading;
    expect((await storage.listMessages("c1")).map((message) => [message.role, message.status])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    await second.deleteChat("anna", "c1");
    expect(await storage.getChat("c1")).toBeNull();
    await first.flush();
    await second.flush();
  });

  it("сообщение на соседнюю копию, пока чат удаляется, — «занято»: ход не начинается в удаляемом чате (аудит codex-2)", async () => {
    const { storage } = await sharedStorage();
    let release!: () => void;
    let reach!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const deleting: ChatStorage = {
      ...storage,
      deleteChat: async (chatId) => {
        reach();
        await gate;
        await storage.deleteChat(chatId);
      },
    };
    const first = serverCopy(storage);
    const second = serverCopy(deleting);
    const removal = second.deleteChat("anna", "c1");
    await reached;
    await expect(first.sendMessage("anna", "c1", { id: "q1", role: "user", parts: [{ type: "text", text: "Сделай" }] })).rejects.toBeInstanceOf(ChatBusyError);
    release();
    await removal;
    expect(await storage.getChat("c1")).toBeNull();
    expect(await storage.listMessages("c1")).toEqual([]);
    await first.flush();
    await second.flush();
  });

  it("ответ брошен упавшей копией дольше порога — доставка прерывает его и пишет итог следом", async () => {
    const { storage } = await sharedStorage();
    await storage.insertMessage(abandonedAnswer("a1", "c1", new Date().toISOString()));
    const copy = serverCopy(storage);
    await vi.advanceTimersByTimeAsync(ANSWER_STALE_AFTER_MS + 1_000);

    expect(await copy.deliverNotices({ ...notice("k1"), wakeAgent: false })).toMatchObject({ status: "delivered", turnStarted: false });
    expect(await statusOf(storage, "a1")).toBe("interrupted");
    const messages = await storage.listMessages("c1");
    expect(messages.at(-1)).toMatchObject({ role: "user", parentId: "a1" });
    await copy.flush();
  });
});
