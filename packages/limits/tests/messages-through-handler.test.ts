import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { createChatServer } from "@ykurilov/agent-chat-server";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpendingLimits } from "../src/create-spending-limits";
import type { SpendingWindowConfig } from "../src/create-spending-limits";

/** Ответ стоит копейки: денежные окна здесь не мешают счёту сообщений. */
function cheapCatalog() {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "Ответ" });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          });
          controller.close();
        },
      }),
    }),
  });
  return extendCatalog(standardCatalog, {
    addProviders: [{ id: "mock", displayName: "Mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
    addModels: [
      {
        id: "cheap-model",
        displayName: "Cheap",
        contextWindowTokens: 10_000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { mock: "cheap-v1" },
        pricing: { mock: { inputPerMillion: 1, outputPerMillion: 1 } },
      },
    ],
  });
}

const openStorages: Array<{ close(): void }> = [];
afterEach(() => openStorages.splice(0).forEach((storage) => storage.close()));

const RESETS_AT = "2026-10-08T00:00:00.000Z";

function setup(input: { windows: SpendingWindowConfig[]; storage?: ChatStorage }) {
  const storage = input.storage ?? createInMemoryChatStorage();
  const catalog = cheapCatalog();
  const logError = vi.fn();
  const limits = createSpendingLimits({ storage, catalog, windows: input.windows, now: () => new Date("2026-10-07T12:00:00.000Z"), logError });
  const { handler, service } = createChatServer({
    basePath: "/api/chat",
    storage,
    resolveUser: async (request) => ({ id: request.headers.get("x-user") ?? "anna" }),
    defaultChoice: { modelId: "cheap-model", providerId: "mock" },
    catalog,
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: { MOCK_API_KEY: "не-настоящий-ключ" },
    limits,
    chatList: true,
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
  const userMessage = (id: string) => ({ id, role: "user", parts: [{ type: "text", text: "Привет" }] });
  async function send(chatId: string, id: string, user = "anna") {
    const response = await call("POST", `/${chatId}/messages`, { message: userMessage(id) }, user);
    return { status: response.status, body: await response.text() };
  }
  async function newChat(user = "anna"): Promise<string> {
    return ((await (await call("POST", "", undefined, user)).json()) as { id: string }).id;
  }
  async function used(user = "anna", chatId = "none") {
    const status = await limits.status({ userId: user, chatId });
    return status.windows?.find((window) => window.id === "day")?.used;
  }
  return { storage, limits, service, call, send, newChat, used, userMessage, logError };
}

const day = (limitMessages: number): SpendingWindowConfig => ({ id: "day", scope: "user", kind: "calendar", unit: "day", limitMessages });

describe("лимит сообщений через обработчик чата", () => {
  it("сообщения сверх суток — 429 spending_limit_reached с unit messages; сообщение не записано", async () => {
    const { send, newChat, storage } = setup({ windows: [day(2)] });
    const chatId = await newChat();
    expect((await send(chatId, "m1")).status).toBe(200);
    expect((await send(chatId, "m2")).status).toBe(200);
    const refused = await send(chatId, "m3");
    expect(refused.status).toBe(429);
    expect(JSON.parse(refused.body)).toEqual({
      error: { kind: "spending_limit_reached", scope: "user", period: "day", resetsAt: RESETS_AT, reason: "limit", windowId: "day", unit: "messages" },
    });
    expect((await storage.listMessages(chatId)).map((message) => message.id)).not.toContain("m3");
  });

  it("правка считается, переделка и повтор — нет", async () => {
    const { send, newChat, call, used, userMessage, storage } = setup({ windows: [day(3)] });
    const chatId = await newChat();
    await send(chatId, "m1");
    expect(await used()).toBe(1);
    const answer = (await storage.listMessages(chatId)).find((message) => message.role === "assistant")!;
    const regenerated = await call("POST", `/${chatId}/regenerate`, { messageId: answer.id });
    expect(regenerated.status).toBe(200);
    await regenerated.text();
    expect(await used()).toBe(1);
    const edited = await call("POST", `/${chatId}/edit`, { editedMessageId: "m1", message: userMessage("m1-edit") });
    expect(edited.status).toBe(200);
    await edited.text();
    expect(await used()).toBe(2);
    // Приём вопроса оборвался до ответа: вопрос записан, ответа нет. Повтор хода и повтор той же отправки места не берут.
    const lastAnswer = (await storage.listMessages(chatId)).filter((message) => message.role === "assistant").at(-1)!;
    await storage.insertMessage({
      id: "m-cut",
      chatId,
      parentId: lastAnswer.id,
      role: "user",
      parts: [{ type: "text", text: "Оборвалось" }],
      formatVersion: lastAnswer.formatVersion,
      status: "complete",
      modelId: null,
      providerId: null,
      usage: null,
      reasoningDurationsMs: {},
      error: null,
      voiceCut: null,
      createdAt: new Date(Date.parse(lastAnswer.createdAt) + 1000).toISOString(),
    });
    const retried = await call("POST", `/${chatId}/retry`, {});
    expect(retried.status).toBe(200);
    await retried.text();
    expect(await used()).toBe(2);
  });

  it("повтор той же отправки (вопрос записан, ответ не начался) места не берёт", async () => {
    const { send, newChat, used, storage } = setup({ windows: [day(3)] });
    const chatId = await newChat();
    await storage.insertMessage({
      id: "m-cut",
      chatId,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Привет" }],
      formatVersion: 1,
      status: "complete",
      modelId: null,
      providerId: null,
      usage: null,
      reasoningDurationsMs: {},
      error: null,
      voiceCut: null,
      createdAt: new Date().toISOString(),
    });
    expect((await send(chatId, "m-cut")).status).toBe(200);
    expect(await used()).toBe(0);
  });

  it("сообщения кончились — переделка всё равно идёт: она не сообщение", async () => {
    const { send, newChat, call, storage } = setup({ windows: [day(1)] });
    const chatId = await newChat();
    await send(chatId, "m1");
    expect((await send(chatId, "m2")).status).toBe(429);
    const answer = (await storage.listMessages(chatId)).find((message) => message.role === "assistant")!;
    const regenerated = await call("POST", `/${chatId}/regenerate`, { messageId: answer.id });
    expect(regenerated.status).toBe(200);
    await regenerated.text();
  });

  it("служебные сообщения не считаются", async () => {
    const { send, newChat, service, used } = setup({ windows: [day(1)] });
    const chatId = await newChat();
    const delivered = await service.deliverNotices({
      ownerId: "anna",
      chatId,
      notices: [{ kind: "task_done", taskId: "t1", title: "Отчёт", result: "готово" }],
      wakeAgent: false,
      deliveryKey: "k1",
    });
    expect(delivered).toMatchObject({ status: "delivered" });
    expect(await used()).toBe(0);
    expect((await send(chatId, "m1")).status).toBe(200);
  });

  it("импорт переписки, приветствие нового чата и чата объекта места не берут", async () => {
    const { send, service, used } = setup({ windows: [day(1)] });
    await service.importChat({
      ownerId: "anna",
      chat: { title: "Старый разговор" },
      messages: [
        { id: "old-1", role: "user", createdAt: "2026-10-07T10:00:00.000Z", parts: [{ type: "text", text: "Привет" }] },
        { role: "assistant", createdAt: "2026-10-07T10:01:00.000Z", parts: [{ type: "text", text: "Здравствуйте" }] },
        { id: "old-2", role: "user", createdAt: "2026-10-07T10:02:00.000Z", parts: [{ type: "text", text: "Ещё" }] },
      ],
    });
    const greeted = await service.createChat("anna", { greeting: { text: "Здравствуйте! Чем помочь?" } });
    await service.openSubjectChat({ ownerId: "anna", key: "lesson:1", greeting: { text: "Это урок 1." } });
    expect(await used()).toBe(0);
    expect((await send(greeted.id, "m1")).status).toBe(200);
    expect(await used()).toBe(1);
  });

  it("удаление чата счёт не сбрасывает", async () => {
    const { send, newChat, call, used } = setup({ windows: [day(2)] });
    const first = await newChat();
    await send(first, "m1");
    await send(first, "m2");
    expect((await call("DELETE", `/${first}`)).status).toBeLessThan(300);
    expect(await used()).toBe(2);
    const second = await newChat();
    expect((await send(second, "m3")).status).toBe(429);
  });

  it("сообщение не записалось (повтор id) — место возвращается", async () => {
    const { send, newChat, used } = setup({ windows: [day(5)] });
    const chatId = await newChat();
    await send(chatId, "m1");
    await send(chatId, "m2");
    // m1 уже есть, но не последнее: запись упадёт, 409.
    expect((await send(chatId, "m1")).status).toBe(409);
    expect(await used()).toBe(2);
  });

  it("SQLite: два сообщения разом на последнее место — проходит одно", async () => {
    const storage = createSqliteChatStorage({ filePath: join(mkdtempSync(join(tmpdir(), "message-limit-")), "chat.db") });
    openStorages.push(storage);
    const { send, newChat, used } = setup({ windows: [day(2)], storage });
    const first = await newChat();
    const second = await newChat();
    const third = await newChat();
    await send(first, "m1");
    const results = await Promise.all([send(second, "m2"), send(third, "m3")]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 429]);
    expect(await used()).toBe(2);
  });

  it("человек без лимита (exemptUsers) пишет сколько угодно; статус без окон", async () => {
    const storage = createInMemoryChatStorage();
    const catalog = cheapCatalog();
    const limits = createSpendingLimits({ storage, catalog, windows: [day(1)], exemptUsers: ({ userId }) => userId === "staff", logError: vi.fn() });
    const { handler } = createChatServer({
      basePath: "/api/chat",
      storage,
      resolveUser: async () => ({ id: "staff" }),
      defaultChoice: { modelId: "cheap-model", providerId: "mock" },
      catalog,
      agent: { instructions: "Ты помощник." },
      compaction: false,
      env: { MOCK_API_KEY: "не-настоящий-ключ" },
      limits,
      logError: vi.fn(),
    });
    const post = (path: string, body?: unknown) =>
      handler.fetch(new Request(`http://test.local/api/chat${path}`, { method: "POST", ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }));
    const chatId = ((await (await post("")).json()) as { id: string }).id;
    for (const id of ["m1", "m2", "m3"]) {
      const response = await post(`/${chatId}/messages`, { message: { id, role: "user", parts: [{ type: "text", text: "Привет" }] } });
      expect(response.status).toBe(200);
      await response.text();
    }
  });
});
