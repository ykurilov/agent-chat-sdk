import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts, finishPart } from "./support/mock-model";

const user = (id: string, text = "Привет") => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

function countingModel() {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ок"]), finishPart()]) }),
  });
  return model;
}

const reached = () => new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: "2099-02-01T00:00:00.000Z" });

/** Лимиты, которые ведёт тест: пока `blocked`, проверка отказывает. */
function fakeLimits() {
  const state = { blocked: false, fail: false };
  const limits: SpendingLimits = {
    assertWithinLimit: vi.fn(async () => {
      if (state.fail) throw new Error("не удалось прочитать расход");
      if (state.blocked) throw reached();
    }),
    status: vi.fn(async () => ({ state: state.blocked ? ("exhausted" as const) : ("ok" as const), scope: "user" as const, period: "month" as const, share: 1, resetsAt: "2099-02-01T00:00:00.000Z" })),
  };
  return { state, limits };
}

function setup(extra: Partial<ChatServiceOptions> = {}) {
  const model = countingModel();
  const storage = createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: mockEnv,
    logError: vi.fn(),
    ...extra,
  });
  return { service, storage, model };
}

async function answered(service: ReturnType<typeof setup>["service"], chatId: string, id: string) {
  await readAll(await service.sendMessage("anna", chatId, user(id)));
}

describe("служба чата: лимит расходов", () => {
  it("лимит не исчерпан — ход идёт как обычно, проверка получила человека и чат", async () => {
    const { state: _state, limits } = fakeLimits();
    const { service, model } = setup({ limits });
    const chat = await service.createChat("anna");
    await answered(service, chat.id, "u1");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(limits.assertWithinLimit).toHaveBeenCalledWith({ userId: "anna", chatId: chat.id });
  });

  it("лимит исчерпан — модель не вызывается, вопрос не сохраняется", async () => {
    const { state, limits } = fakeLimits();
    const { service, model, storage } = setup({ limits });
    const chat = await service.createChat("anna");
    state.blocked = true;
    await expect(service.sendMessage("anna", chat.id, user("u1"))).rejects.toBeInstanceOf(SpendingLimitReachedError);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await storage.listMessages(chat.id)).toEqual([]);
    expect((await service.getHistory("anna", chat.id)).running).toBe(false);
  });

  it("отказ несёт область, период и время обновления", async () => {
    const { state, limits } = fakeLimits();
    const { service } = setup({ limits });
    const chat = await service.createChat("anna");
    state.blocked = true;
    await expect(service.sendMessage("anna", chat.id, user("u1"))).rejects.toMatchObject({
      scope: "user",
      period: "month",
      resetsAt: "2099-02-01T00:00:00.000Z",
    });
  });

  it("повтор, переделка и правка тоже проверяют лимит и ничего не записывают", async () => {
    const { state, limits } = fakeLimits();
    const { service, model, storage } = setup({ limits });
    const chat = await service.createChat("anna");
    await answered(service, chat.id, "u1");
    const history = await service.getHistory("anna", chat.id);
    const answerId = history.messages.at(-1)!.id;
    const before = (await storage.listMessages(chat.id)).length;
    const callsBefore = model.doStreamCalls.length;
    state.blocked = true;
    await expect(service.retry("anna", chat.id)).rejects.toBeInstanceOf(SpendingLimitReachedError);
    await expect(service.regenerate("anna", chat.id, answerId)).rejects.toBeInstanceOf(SpendingLimitReachedError);
    await expect(service.editMessage("anna", chat.id, "u1", user("u2", "Правка"))).rejects.toBeInstanceOf(SpendingLimitReachedError);
    expect((await storage.listMessages(chat.id)).length).toBe(before);
    expect(model.doStreamCalls).toHaveLength(callsBefore);
  });

  it("чужой чат: сначала «не найден», лимит не спрашивается", async () => {
    const { limits } = fakeLimits();
    const { service } = setup({ limits });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("boris", chat.id, user("u1"))).rejects.toMatchObject({ name: "ChatNotFoundError" });
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
  });

  it("сбой самой проверки отказывает в ходе: безопаснее не пропустить", async () => {
    const { state, limits } = fakeLimits();
    const { service, model } = setup({ limits });
    const chat = await service.createChat("anna");
    state.fail = true;
    await expect(service.sendMessage("anna", chat.id, user("u1"))).rejects.toThrow("не удалось прочитать расход");
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("ход пишет расход на владельца чата", async () => {
    const { limits } = fakeLimits();
    const { service, storage } = setup({ limits });
    const chat = await service.createChat("anna");
    await answered(service, chat.id, "u1");
    expect((await storage.sumUsage({ ownerId: "anna" }))[0]).toMatchObject({ inputTokens: 100, outputTokens: 30 });
  });

  it("getSpendingStatus отдаёт состояние от лимитов; чужой чат — «не найден»", async () => {
    const { state, limits } = fakeLimits();
    const { service } = setup({ limits });
    const chat = await service.createChat("anna");
    expect(await service.getSpendingStatus("anna", chat.id)).toMatchObject({ state: "ok" });
    state.blocked = true;
    expect(await service.getSpendingStatus("anna", chat.id)).toMatchObject({ state: "exhausted", scope: "user" });
    await expect(service.getSpendingStatus("boris", chat.id)).rejects.toMatchObject({ name: "ChatNotFoundError" });
  });

  it("без limits ход не проверяется, статус — «в норме»", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna");
    await answered(service, chat.id, "u1");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(await service.getSpendingStatus("anna", chat.id)).toEqual({ state: "ok" });
  });
});

describe("служба чата: правила хода и расход после хода", () => {
  it("turnRules: правила спрашиваются на каждый ход и доходят до хода — потолок вызовов кончает ход итогом", async () => {
    const { tool } = await import("ai");
    const { z } = await import("zod");
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ toolChoice }) => {
        call += 1;
        if (toolChoice?.type === "none") return { stream: streamOf([streamStart, ...textParts(["Итог"]), finishPart()]) };
        return {
          stream: streamOf([streamStart, { type: "tool-call", toolCallId: `c${call}`, toolName: "lookup", input: "{}" }, finishPart("tool-calls")]),
        };
      },
    });
    const { limits } = fakeLimits();
    limits.turnRules = vi.fn(async () => ({ maxToolCalls: 1 }));
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", tools: { lookup: tool({ description: "Поиск", inputSchema: z.object({}), execute: async () => "ок" }) } },
      compaction: false,
      env: mockEnv,
      logError: vi.fn(),
      limits,
    });
    const chat = await service.createChat("anna");
    await answered(service, chat.id, "u1");
    expect(limits.turnRules).toHaveBeenCalledWith({ userId: "anna", chatId: chat.id });
    expect(model.doStreamCalls.map((request) => request.toolChoice?.type)).toEqual(["auto", "none"]);
  });

  it("сбой turnRules — ход не начинается, как при сбое проверки лимита", async () => {
    const { limits } = fakeLimits();
    limits.turnRules = vi.fn(async () => {
      throw new Error("не прочитать правила");
    });
    const { service, model } = setup({ limits });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, user("u1"))).rejects.toThrow("не прочитать правила");
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("afterSpending: зовётся после хода, когда расход уже в журнале; его сбой — в журнал сервера, ход не ломает", async () => {
    const { limits } = fakeLimits();
    const logError = vi.fn();
    const { service, storage } = setup({ limits, logError });
    let journaled = -1;
    limits.afterSpending = vi.fn(async ({ userId }) => {
      journaled = (await storage.sumUsage({ ownerId: userId })).length;
      throw new Error("порог не отправлен");
    });
    const chat = await service.createChat("anna");
    await answered(service, chat.id, "u1");
    await vi.waitFor(() => expect(limits.afterSpending).toHaveBeenCalledWith({ userId: "anna", chatId: chat.id }));
    expect(journaled).toBe(1);
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("порог не отправлен")));
  });
});
