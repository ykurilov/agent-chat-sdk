import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { createCompactionService } from "../../../src/compaction/compaction-service";
import { summaryFrame } from "../../../src/compaction/compaction-task";
import type { CompactionSettings } from "../../../src/compaction/compaction-settings";
import type { StoredMessage } from "../../../src/conversation/types";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import type { ModelPrice } from "../../../src/models/model-catalog";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { generateResult, mockCatalog, mockEnv, mockModelId } from "../support/mock-model";
import { compactionRecord, conversation, timeAt } from "../support/compaction-fixtures";
import { newStoredMessage } from "../../../src/conversation/types";
import { channelPart } from "../../../src/agent-run/channel-notes";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";

const choice = { modelId: mockModelId, providerId: "mock" };
const settingsInput: CompactionSettings = { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 };

/** Ответы модели сжатия по очереди; сколько раз её спросили — `calls`. */
function summarizer(results: Array<string | Error> = ["## Цель\nсводка"]) {
  const queue = [...results];
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      if (next instanceof Error) throw next;
      return generateResult(next, { output: 20 });
    },
  });
  return model;
}

/** Модель сжатия, которая держит сводку, пока тест не отпустит; на сигнал отмены отвечает ошибкой. */
function heldSummarizer() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const model = new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        void held.then(resolve);
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
      });
      return generateResult("## Цель\nсводка", { output: 20 });
    },
  });
  return { model, release };
}

async function setup(input: {
  contexts: Array<number | null>;
  messages?: StoredMessage[];
  model?: MockLanguageModelV4;
  backup?: MockLanguageModelV4;
  settings?: CompactionSettings | false;
  now?: () => number;
  pricing?: ModelPrice;
}) {
  const storage: ChatStorage = createInMemoryChatStorage();
  await storage.createChat({ id: "chat-1", ownerId: "anna", ...choice });
  for (const message of input.messages ?? conversation(input.contexts)) await storage.insertMessage(message);
  const model = input.model ?? summarizer();
  const logError = vi.fn();
  const service = createCompactionService({
    storage,
    catalog: mockCatalog({ mock: model, ...(input.backup && { "mock-backup": input.backup }) }, input.pricing ? { pricing: input.pricing } : {}),
    env: mockEnv,
    agent: { instructions: "Ты помощник." },
    settings: resolveCompactionSettings(input.settings ?? settingsInput),
    logError,
    ...(input.now && { now: input.now }),
  });
  const branch = async (): Promise<StoredMessage[]> => (await storage.listMessages("chat-1")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { storage, model, service, logError, branch };
}

/** Ждёт, пока идущее сжатие закончится. */
async function settled(service: { isCompacting(chatId: string): boolean }): Promise<void> {
  await vi.waitFor(() => expect(service.isCompacting("chat-1")).toBe(false));
}

describe("сжатие после ответа", () => {
  it("повторный compactNow использует первый успешный app anchor всей ветки, даже если после fallback он за новой границей", async () => {
    const messages = conversation([100, 300, 600, 700]);
    for (let n = 1; n <= 4; n++) messages[n * 2 - 1]!.parts.unshift({ type: FROZEN_CONTEXT_PART_TYPE, data: {
      blocks: [{ key: "profile", text: n === 4 ? "FRESH_ROOT_APP" : "OLD_FALLBACK_APP" }],
      ...(n === 1 ? { appContextFrom: "u1" } : n === 4 ? { appContextFrom: "u2" } : {}),
      base: n === 1 ? null : `a${n - 1}`, sent: n === 1 ? "all" : { changed: n === 4 ? ["profile"] : [], removed: [] },
    } });
    const { storage, service, model } = await setup({ contexts: [], messages,
      settings: { thresholdTokens: 1_000_000, tailTokens: 350, summaryCeilingTokens: 100 } });
    await storage.insertCompaction(compactionRecord({ id: "first", throughMessageId: "a1", createdAt: timeAt(2) }));
    expect(await service.compactNow("chat-1", choice)).toBe("compacted");
    const records = await storage.listCompactions("chat-1");
    expect(records.at(-1)!.throughMessageId).toBe("a2");
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain("FRESH_ROOT_APP"); expect(prompt).not.toContain("OLD_FALLBACK_APP");
    expect(prompt).not.toContain("вопрос 3"); expect(prompt).not.toContain("ответ 4");
  });

  it("group/privacy берутся со всей ветки, даже если групповое сообщение осталось за границей сжатия", async () => {
    const messages = conversation([100, 300, 600]);
    messages.find(m => m.id === "a1")!.parts.unshift({ type: FROZEN_CONTEXT_PART_TYPE, data: {
      blocks: [{ key: "profile", text: "PUBLIC_PROFILE" }, { key: "private", text: "PRIVATE_BEFORE_GROUP", private: true }], base: null, sent: "all",
    } });
    messages.find(m => m.id === "u3")!.parts.push(channelPart("web", { author: "Anna", allowedTools: [] })!);
    const { service, model } = await setup({ contexts: [], messages });
    expect(await service.compactNow("chat-1", choice)).toBe("compacted");
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain("PUBLIC_PROFILE"); expect(prompt).not.toContain("PRIVATE_BEFORE_GROUP");
  });

  it("контекст выше порога — фоном появляется запись с границами, сводкой, размером и расходом", async () => {
    const { storage, service } = await setup({ contexts: [100, 300, 600] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(service.isCompacting("chat-1")).toBe(true);
    await settled(service);
    const [record] = await storage.listCompactions("chat-1");
    expect(record).toMatchObject({
      chatId: "chat-1",
      fromMessageId: "u1",
      throughMessageId: "a2",
      summary: "## Цель\nсводка",
      summaryTokens: 20,
      modelId: mockModelId,
      providerId: "mock",
    });
    expect(record?.usage?.outputTokens).toBe(20);
    expect(service.isCompacting("chat-1")).toBe(false);
  });

  it("оригиналы сообщений остаются как были", async () => {
    const { storage, service } = await setup({ contexts: [100, 300, 600] });
    const before = await storage.listMessages("chat-1");
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    expect(await storage.listMessages("chat-1")).toEqual(before);
  });

  it("контекст не выше порога — не сжимает", async () => {
    const { storage, service, model } = await setup({ contexts: [100, 300, 500] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(service.isCompacting("chat-1")).toBe(false);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await storage.listCompactions("chat-1")).toEqual([]);
  });

  it("всё в пределах хвоста — записи нет и повтора нет", async () => {
    const { storage, service, model } = await setup({ contexts: [600] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a1" });
    await settled(service);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await storage.listCompactions("chat-1")).toEqual([]);
  });

  it("сжатие выключено настройкой — не запускается", async () => {
    const { service, model } = await setup({ contexts: [100, 300, 600], settings: false });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(service.isCompacting("chat-1")).toBe(false);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("ответ не последний на ветке (пришло новое сообщение) — не запускается", async () => {
    const { service, model, storage } = await setup({ contexts: [100, 300, 600] });
    await storage.insertMessage({ ...conversation([0])[0]!, id: "u4", parentId: "a3", createdAt: "2026-06-01T00:00:00.000Z" });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("одно сжатие на чат: второй вызов во время сжатия ничего не запускает", async () => {
    const { service, model } = await setup({ contexts: [100, 300, 600] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("после записи тот же ответ повторно сжатие не запускает (ответ дан до записи)", async () => {
    const { service, model } = await setup({ contexts: [100, 300, 600] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(service.isCompacting("chat-1")).toBe(false);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("сбой: записи нет, в журнале причина без текста, 5 минут повторов нет, потом снова пробует", async () => {
    let clock = 1_000_000;
    const model = summarizer([new Error("упало"), "## Цель\nсводка"]);
    const { storage, service, logError } = await setup({ contexts: [100, 300, 600], model, now: () => clock });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    expect(await storage.listCompactions("chat-1")).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toContain("chat-1");

    clock += 4 * 60_000;
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(model.doGenerateCalls).toHaveLength(1);

    clock += 2 * 60_000;
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
  });

  it("сжимает моделью из настроек, если она задана", async () => {
    const answering = summarizer(["сводка ответчика"]);
    const chosen = summarizer(["сводка выбранной"]);
    const { storage, service } = await setup({
      contexts: [100, 300, 600],
      model: answering,
      backup: chosen,
      settings: { ...settingsInput, model: { modelId: mockModelId, providerId: "mock-backup" } },
    });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    expect(answering.doGenerateCalls).toHaveLength(0);
    const [record] = await storage.listCompactions("chat-1");
    expect(record).toMatchObject({ summary: "сводка выбранной", providerId: "mock-backup" });
  });
});

describe("команда «сжать сейчас»", () => {
  it("сжимает, не глядя на порог и на паузу после сбоя", async () => {
    let clock = 0;
    const model = summarizer([new Error("упало"), "## Цель\nсводка"]);
    const { storage, service } = await setup({ contexts: [100, 300, 400], model, now: () => clock });
    expect(await service.compactNow("chat-1", choice)).toBe("failed");
    expect(await service.compactNow("chat-1", choice)).toBe("compacted");
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
  });

  it("нечего сжимать — так и говорит", async () => {
    const { service } = await setup({ contexts: [100] });
    expect(await service.compactNow("chat-1", choice)).toBe("nothing-to-compact");
  });

  it("повторно поверх активной записи: новая запись начинается с начала прежней, прежняя сводка уходит в запрос", async () => {
    const { storage, service, model } = await setup({ contexts: [100, 300, 600] });
    expect(await service.compactNow("chat-1", choice)).toBe("compacted");
    let parent = "a3";
    for (const [index, context] of [250, 450].entries()) {
      const at = Date.now() + (index + 1) * 10_000;
      const question = newStoredMessage({ id: `q${index}`, chatId: "chat-1", role: "user", parentId: parent, parts: [{ type: "text", text: "ещё вопрос" }], createdAt: new Date(at).toISOString() });
      const answer = newStoredMessage({
        id: `r${index}`,
        chatId: "chat-1",
        role: "assistant",
        parentId: question.id,
        parts: [{ type: "text", text: "ещё ответ" }],
        usage: { inputTokens: context - 10, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 0, contextTokens: context },
        createdAt: new Date(at + 1000).toISOString(),
      });
      await storage.insertMessage(question);
      await storage.insertMessage(answer);
      parent = answer.id;
    }
    expect(await service.compactNow("chat-1", choice)).toBe("compacted");
    const records = await storage.listCompactions("chat-1");
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ fromMessageId: "u1", throughMessageId: "r0" });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("<conversation_summary>");
  });
});

describe("история для ответа", () => {
  it("без записей — ветка как есть", async () => {
    const { service, branch } = await setup({ contexts: [100, 300] });
    const history = await service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice });
    expect(history.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("с активной записью — сводка и хвост", async () => {
    const { service, branch } = await setup({ contexts: [100, 300, 600] });
    await service.compactNow("chat-1", choice);
    const history = await service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice });
    expect(history.map((message) => message.id)).toEqual(["u3", "a3"]);
    expect(history[0]?.parts[0]).toMatchObject({ type: "text", text: summaryFrame("## Цель\nсводка") });
  });

  it("идущее сжатие ответ не ждёт, пока до предела окна далеко: история полная", async () => {
    const { service, branch } = await setup({ contexts: [100, 300, 600] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    const history = await service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice });
    expect(history.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
    await settled(service);
  });

  it("контекст у предела окна (≥ 90%) — ответ дожидается идущего сжатия и берёт сводку", async () => {
    const { service, branch } = await setup({ contexts: [100, 400, 900] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(service.isCompacting("chat-1")).toBe(true);
    const history = await service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice });
    expect(history.map((message) => message.id)).toEqual(["u3", "a3"]);
  });

  it("контекст у предела окна и сжатие не идёт — запускает и ждёт", async () => {
    const { service, branch, model } = await setup({ contexts: [100, 400, 900], settings: { ...settingsInput, thresholdTokens: 5000, tailTokens: 100 } });
    const history = await service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(history.map((message) => message.id)).toEqual(["u3", "a3"]);
  });

  it("при сбое ожидающий ответ идёт с полным контекстом", async () => {
    const { service, branch } = await setup({ contexts: [100, 400, 900], model: summarizer([new Error("упало")]) });
    const history = await service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice });
    expect(history.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  });
});

describe("«стоп» во время ожидания сжатия", () => {
  it("ответ, ждущий сжатия у предела окна, отменяется сразу; сжатие доделывается и записывается", async () => {
    const { model, release } = heldSummarizer();
    const { storage, service, branch } = await setup({ contexts: [100, 400, 900], model });
    const controller = new AbortController();
    const waiting = service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice, abortSignal: controller.signal });
    await vi.waitFor(() => expect(service.isCompacting("chat-1")).toBe(true));
    controller.abort();
    const outcome = await Promise.race([waiting.then(() => "history", () => "aborted"), new Promise((resolve) => setTimeout(() => resolve("still waiting"), 500))]);
    expect(outcome).toBe("aborted");
    expect(service.isCompacting("chat-1")).toBe(true);

    release();
    await settled(service);
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
  });

  it("сигнал уже отменён — история не строится, сжатие не запускается", async () => {
    const { service, branch, model } = await setup({ contexts: [100, 400, 900] });
    const controller = new AbortController();
    controller.abort();
    await expect(service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice, abortSignal: controller.signal })).rejects.toBeDefined();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("штатная остановка сервера", () => {
  it("drain дожидается идущего сжатия, и запись уже в хранилище", async () => {
    const { model, release } = heldSummarizer();
    const { storage, service } = await setup({ contexts: [100, 300, 600], model });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    let drained = false;
    const draining = service.drain().then(() => (drained = true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(drained).toBe(false);
    release();
    await draining;
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
    expect(service.isCompacting("chat-1")).toBe(false);
  });

  it("сжатие дольше предела отменяется: полусводки нет, в журнале ничего, пауза после сбоя не включается", async () => {
    const { model } = heldSummarizer();
    const { storage, service, logError } = await setup({ contexts: [100, 300, 600], model, settings: { ...settingsInput, flushWaitMs: 40 } });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    const started = Date.now();
    await service.drain();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await storage.listCompactions("chat-1")).toEqual([]);
    expect(service.isCompacting("chat-1")).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });

  it("drain дожидается и решения «нужно ли сжимать», которое ещё принимается", async () => {
    const { model, release } = heldSummarizer();
    const { storage, service } = await setup({ contexts: [100, 300, 600], model });
    void service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    const draining = service.drain();
    release();
    await draining;
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
  });
});

describe("признак «идёт сжатие»", () => {
  it("ставится сразу, как ответ дан, ещё до решения, нужно ли сжимать; если не нужно — снимается", async () => {
    const { service } = await setup({ contexts: [100, 300, 600], settings: { ...settingsInput, thresholdTokens: 5_000 } });
    const deciding = service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(service.isCompacting("chat-1")).toBe(true);
    await deciding;
    expect(service.isCompacting("chat-1")).toBe(false);
  });

  it("сжатие выключено — признака нет", async () => {
    const { service } = await setup({ contexts: [100, 300, 600], settings: false });
    const deciding = service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    expect(service.isCompacting("chat-1")).toBe(false);
    await deciding;
  });
});

describe("пауза после пустой попытки", () => {
  it("«нечего сжимать» у предела окна: следующие сообщения не повторяют попытку, пока не пройдёт пауза", async () => {
    let clock = 1_000_000;
    const { service, storage, branch } = await setup({ contexts: [950], now: () => clock });
    const listMessages = vi.spyOn(storage, "listMessages");
    const history = async () => (await service.historyForAnswer({ chatId: "chat-1", branch: await branch(), choice })).map((message) => message.id);
    expect(await history()).toEqual(["u1", "a1"]);
    const afterFirst = listMessages.mock.calls.length;
    expect(await history()).toEqual(["u1", "a1"]);
    expect(await history()).toEqual(["u1", "a1"]);
    // Своих чтений у службы после первой попытки нет: `branch()` читает сам тест, его вызовы вычитаем.
    const testReads = 2 * 1;
    expect(listMessages.mock.calls.length - afterFirst - testReads).toBe(0);

    clock += 6 * 60_000;
    const before = listMessages.mock.calls.length;
    await history();
    expect(listMessages.mock.calls.length - before).toBeGreaterThan(1);
  });

  it("«сжать сейчас» паузу игнорирует", async () => {
    const { service, storage } = await setup({ contexts: [950] });
    await service.historyForAnswer({ chatId: "chat-1", branch: (await storage.listMessages("chat-1")), choice });
    const listMessages = vi.spyOn(storage, "listMessages");
    expect(await service.compactNow("chat-1", choice)).toBe("nothing-to-compact");
    expect(listMessages).toHaveBeenCalled();
  });
});

describe("записи для экрана", () => {
  it("маркеры — записи, чьё последнее сообщение на текущей ветке; чужие ветки не в счёте", async () => {
    const { storage, service, branch } = await setup({ contexts: [100, 300, 600] });
    await service.compactNow("chat-1", choice);
    await storage.insertCompaction({
      id: "foreign",
      chatId: "chat-1",
      fromMessageId: "u1",
      throughMessageId: "no-such-message",
      summary: "чужая",
      summaryTokens: 1,
      modelId: "m",
      providerId: "p",
      usage: null,
      createdAt: new Date().toISOString(),
    });
    const markers = await service.markers("chat-1", await branch());
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ fromMessageId: "u1", throughMessageId: "a2", summary: "## Цель\nсводка", summaryTokens: 20 });
    expect(Object.keys(markers[0]!).sort()).toEqual(["createdAt", "fromMessageId", "id", "summary", "summaryTokens", "throughMessageId"]);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("сжатие: расход токенов", () => {
  it("удавшееся сжатие дописывает запись расхода на владельца чата", async () => {
    const { storage, service } = await setup({ contexts: [100, 300, 600] });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    const [sum] = await storage.sumUsage({ ownerId: "anna" });
    expect(sum).toMatchObject({ modelId: mockModelId, providerId: "mock", inputTokens: 100, cachedInputTokens: 60, outputTokens: 20 });
  });

  it("удавшееся сжатие стоит денег по ценам модели на момент сжатия", async () => {
    const price = { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: 0.1 };
    const { storage, service } = await setup({ contexts: [100, 300, 600], pricing: price });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    const [sum] = await storage.sumUsage({ ownerId: "anna" });
    expect(sum?.costUsd).toBeCloseTo((40 * 1 + 60 * 0.1 + 20 * 2) / 1_000_000, 12);
  });

  it("сжатие, кончившееся ошибкой провайдера до ответа, расхода не пишет: платить не за что", async () => {
    const { storage, service } = await setup({ contexts: [100, 300, 600], model: summarizer([new Error("сбой")]) });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
  });

  it("оплаченное, но неудавшееся сжатие (пустая сводка) расход всё равно записывает", async () => {
    const price = { inputPerMillion: 1, outputPerMillion: 2 };
    const { storage, service } = await setup({ contexts: [100, 300, 600], model: summarizer(["   "]), pricing: price });
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    expect(await storage.listCompactions("chat-1")).toHaveLength(0);
    const [sum] = await storage.sumUsage({ ownerId: "anna" });
    expect(sum).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(sum?.costUsd).toBeGreaterThan(0);
  });

  it("расход сжатия датируется началом сжатия", async () => {
    const { storage, service } = await setup({ contexts: [100, 300, 600] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-31T23:59:00.000Z"));
    const original = storage.insertUsageRecord;
    const written: string[] = [];
    storage.insertUsageRecord = async (record) => {
      written.push(record.createdAt);
      await original(record);
    };
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    vi.setSystemTime(new Date("2099-02-01T00:05:00.000Z"));
    await settled(service);
    vi.useRealTimers();
    expect(written).toEqual(["2099-01-31T23:59:00.000Z"]);
  });

  it("сбой записи расхода не отменяет сжатие и попадает в журнал", async () => {
    const { storage, service, logError } = await setup({ contexts: [100, 300, 600] });
    const original = storage.insertUsageRecord;
    storage.insertUsageRecord = async () => {
      throw new Error("база недоступна");
    };
    await service.afterAnswer({ chatId: "chat-1", answerId: "a3" });
    await settled(service);
    storage.insertUsageRecord = original;
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/расход.*база недоступна/i));
  });
});
