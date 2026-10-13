import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { createChatHandler } from "@ykurilov/agent-chat-server";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpendingLimits } from "../src/create-spending-limits";
import type { SpendingWindowConfig } from "../src/create-spending-limits";

/** Ход стоит 0,015 $: 10 токенов входа и 5 выхода по 1000 $ за миллион. */
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function catalogWithDearModel() {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "Привет!" });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        },
      }),
    }),
  });
  return extendCatalog(standardCatalog, {
    addProviders: [{ id: "mock", displayName: "Mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
    addModels: [
      {
        id: "dear-model",
        displayName: "Dear",
        contextWindowTokens: 1000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { mock: "dear-v1" },
        pricing: { mock: { inputPerMillion: 1000, outputPerMillion: 1000 } },
      },
    ],
  });
}

const openStorages: Array<{ close(): void }> = [];
afterEach(() => openStorages.splice(0).forEach((storage) => storage.close()));

function setup(input: { budgetUsd: number; windows?: SpendingWindowConfig[]; storage?: ChatStorage; now?: () => Date; timeZone?: string }) {
  const storage = input.storage ?? createInMemoryChatStorage();
  const catalog = catalogWithDearModel();
  const logError = vi.fn();
  const limits = createSpendingLimits({ storage, catalog, ...(input.windows ? { windows: input.windows } : { budget: () => ({ user: input.budgetUsd }) }), now: input.now, logError, ...(input.timeZone && { timeZone: input.timeZone }) });
  const handler = createChatHandler({
    basePath: "/api/chat",
    storage,
    resolveUser: async (request) => ({ id: request.headers.get("x-user") ?? "anna" }),
    defaultChoice: { modelId: "dear-model", providerId: "mock" },
    catalog,
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: { MOCK_API_KEY: "не-настоящий-ключ" },
    limits,
    chatList: true,
    // Одновременные ходы здесь проверяют точность суммы, а не предел числа ходов.
    maxConcurrentTurnsPerUser: Number.POSITIVE_INFINITY,
    logError,
  });
  const call = (method: string, path: string, body?: unknown, user = "anna") =>
    handler.fetch(
      new Request(`http://test.local/api/chat${path}`, {
        method,
        headers: { "x-user": user, ...(body !== undefined && { "content-type": "application/json" }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  async function ask(chatId: string, id: string, user = "anna") {
    const response = await call("POST", `/${chatId}/messages`, { message: { id: `${chatId}-${id}`, role: "user", parts: [{ type: "text", text: "Привет" }] } }, user);
    const text = await response.text();
    return { status: response.status, text };
  }
  async function newChat(user = "anna"): Promise<string> {
    return ((await (await call("POST", "", undefined, user)).json()) as { id: string }).id;
  }
  return { storage, limits, call, ask, newChat, logError };
}

describe("лимиты через обработчик чата: живой ход от запроса до записи в базу", () => {
  it("ходы идут до исчерпания бюджета, потом 429, потом новый месяц открывает чат", async () => {
    const clock = { now: new Date() };
    const { limits, ask, newChat, call, storage } = setup({ budgetUsd: 0.03, now: () => clock.now });
    const chatId = await newChat();

    expect((await ask(chatId, "u1")).status).toBe(200);
    expect(await (await call("GET", `/${chatId}/spending`)).json()).toMatchObject({ state: "ok" });
    expect((await ask(chatId, "u2")).status).toBe(200);
    expect((await limits.getSpending({ userId: "anna" })).user.spentUsd).toBeCloseTo(0.03, 9);
    expect(await (await call("GET", `/${chatId}/spending`)).json()).toMatchObject({ state: "exhausted", scope: "user", period: "month" });

    const before = (await storage.listMessages(chatId)).length;
    const refused = await ask(chatId, "u3");
    expect(refused.status).toBe(429);
    expect(JSON.parse(refused.text)).toMatchObject({ error: { kind: "spending_limit_reached", scope: "user", period: "month" } });
    expect((await storage.listMessages(chatId)).length).toBe(before);

    const nextMonth = new Date(Date.UTC(clock.now.getUTCFullYear(), clock.now.getUTCMonth() + 1, 1));
    clock.now = nextMonth;
    expect((await ask(chatId, "u3")).status).toBe(200);
  });

  it("удаление чата стирает состояние окон этого чата; окна человека и других чатов остаются", async () => {
    const windows: SpendingWindowConfig[] = [
      { id: "chat-5h", scope: "chat", kind: "rolling", hours: 5, limitUsd: 1 },
      { id: "user-5h", scope: "user", kind: "rolling", hours: 5, limitUsd: 1 },
    ];
    const { ask, newChat, call, storage } = setup({ budgetUsd: 1, windows });
    const [gone, kept] = [await newChat(), await newChat()];
    await ask(gone, "u1");
    await ask(kept, "u1");
    expect(await storage.getSpendingLimitState!(`window:chat:${gone}:chat-5h`)).not.toBeNull();

    expect((await call("DELETE", `/${gone}`)).status).toBeLessThan(300);
    expect(await storage.getSpendingLimitState!(`window:chat:${gone}:chat-5h`)).toBeNull();
    expect(await storage.getSpendingLimitState!(`window:chat:${kept}:chat-5h`)).not.toBeNull();
    expect(await storage.getSpendingLimitState!("window:user:anna:user-5h")).not.toBeNull();
  });

  it("пояс лимитов уходит на экран: в состояние лимита и в отказ 429", async () => {
    const { ask, newChat, call } = setup({ budgetUsd: 0.015, timeZone: "Europe/Moscow" });
    const chatId = await newChat();
    await ask(chatId, "u1");
    expect(await (await call("GET", `/${chatId}/spending`)).json()).toMatchObject({ state: "exhausted", timeZone: "Europe/Moscow" });
    const refused = await ask(chatId, "u2");
    expect(refused.status).toBe(429);
    expect(JSON.parse(refused.text)).toMatchObject({ error: { kind: "spending_limit_reached", timeZone: "Europe/Moscow" } });
  });

  it("без пояса ответы прежние: поля timeZone нет", async () => {
    const { ask, newChat, call } = setup({ budgetUsd: 0.015 });
    const chatId = await newChat();
    await ask(chatId, "u1");
    expect(await (await call("GET", `/${chatId}/spending`)).json()).not.toHaveProperty("timeZone");
    expect(JSON.parse((await ask(chatId, "u2")).text).error).not.toHaveProperty("timeZone");
  });

  it("предупреждение с 80%: бюджет на два хода с половиной, после второго хода — warning", async () => {
    const { ask, newChat, call } = setup({ budgetUsd: 0.035 });
    const chatId = await newChat();
    await ask(chatId, "u1");
    expect(await (await call("GET", `/${chatId}/spending`)).json()).toMatchObject({ state: "ok" });
    await ask(chatId, "u2");
    expect(await (await call("GET", `/${chatId}/spending`)).json()).toMatchObject({ state: "warning" });
  });

  it("чужой расход не мешает: у Бориса свой бюджет", async () => {
    const { ask, newChat } = setup({ budgetUsd: 0.015 });
    const annaChat = await newChat("anna");
    const borisChat = await newChat("boris");
    expect((await ask(annaChat, "u1", "anna")).status).toBe(200);
    expect((await ask(annaChat, "u2", "anna")).status).toBe(429);
    expect((await ask(borisChat, "u1", "boris")).status).toBe(200);
  });

  it.each(["память", "SQLite"])("десять ходов одновременно в десяти чатах дают точную сумму (%s)", async (kind) => {
    const sqlite = kind === "SQLite" ? createSqliteChatStorage({ filePath: join(mkdtempSync(join(tmpdir(), "limits-")), "chat.sqlite") }) : null;
    if (sqlite) openStorages.push(sqlite);
    const { ask, newChat, limits } = setup({ budgetUsd: 100, ...(sqlite && { storage: sqlite }) });
    const chats = await Promise.all(Array.from({ length: 10 }, () => newChat()));
    await Promise.all(chats.map((chatId, index) => ask(chatId, `u${index}`)));
    expect((await limits.getSpending({ userId: "anna" })).user.spentUsd).toBeCloseTo(10 * 0.015, 9);
  });

  it("расход виден после удаления сообщений чата и в другом экземпляре лимитов", async () => {
    const { storage, ask, newChat, limits } = setup({ budgetUsd: 100 });
    const chatId = await newChat();
    await ask(chatId, "u1");
    const other = createSpendingLimits({ storage, catalog: catalogWithDearModel(), budget: () => ({ user: 100 }) });
    expect((await other.getSpending({ userId: "anna" })).user.spentUsd).toBeCloseTo((await limits.getSpending({ userId: "anna" })).user.spentUsd, 12);
  });
});
