import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { SpendingLimits } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createTestChat, message } from "./support/test-chat";

const resetsAt = "2099-02-01T00:00:00.000Z";

/** Лимиты, которыми управляет тест. */
function fakeLimits(initial: "ok" | "warning" | "exhausted" = "ok") {
  const control = { state: initial, fail: false };
  const limits: SpendingLimits = {
    assertWithinLimit: vi.fn(async () => {
      if (control.fail) throw new Error("база недоступна");
      if (control.state === "exhausted") throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt });
    }),
    status: vi.fn(async () =>
      control.state === "ok"
        ? { state: "ok" as const }
        : { state: control.state, scope: "user" as const, period: "month" as const, share: control.state === "warning" ? 0.85 : 1, resetsAt },
    ),
  };
  return { control, limits };
}

describe("обработчик чата: лимит расходов", () => {
  it("исчерпан — 429 с видом, областью, периодом и временем обновления; сообщение не сохранено", async () => {
    const { limits } = fakeLimits("exhausted");
    const { call, createChat, history, storage } = createTestChat({ limits });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { kind: "spending_limit_reached", scope: "user", period: "month", resetsAt } });
    expect(await storage.listMessages(chatId)).toEqual([]);
    expect((await history(chatId)).running).toBe(false);
  });

  it("повтор, переделка и правка отвечают так же", async () => {
    const { limits, control } = fakeLimits();
    const { call, createChat } = createTestChat({ limits });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    control.state = "exhausted";
    const retry = await call("POST", `/${chatId}/retry`);
    const regenerate = await call("POST", `/${chatId}/regenerate`, { body: { messageId: "x" } });
    const edit = await call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u2", "Правка") } });
    for (const response of [retry, regenerate, edit]) {
      expect(response.status).toBe(429);
      expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("spending_limit_reached");
    }
  });

  it("лимит без периода отдаёт resetsAt null", async () => {
    const limits: SpendingLimits = {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "chat", period: "none", resetsAt: null });
      },
      status: async () => ({ state: "exhausted", scope: "chat", period: "none", share: 1, resetsAt: null }),
    };
    const { call, createChat } = createTestChat({ limits });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(await response.json()).toEqual({ error: { kind: "spending_limit_reached", scope: "chat", period: "none", resetsAt: null } });
  });

  it("лимиты с окнами: в 429 причина, имя окна и его часы", async () => {
    const limits: SpendingLimits = {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "rolling", resetsAt, reason: "reserve", windowId: "5h", hours: 5 });
      },
      status: async () => ({ state: "warning", scope: "user", period: "rolling", share: 0.95, resetsAt }),
    };
    const { call, createChat } = createTestChat({ limits });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(await response.json()).toEqual({
      error: { kind: "spending_limit_reached", scope: "user", period: "rolling", resetsAt, reason: "reserve", windowId: "5h", hours: 5 },
    });
  });

  it("лимит сообщений: в 429 unit messages, сообщение не записано; правка тоже берёт место, переделка — нет", async () => {
    const takeMessage = vi.fn(async () => {
      throw new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt, reason: "limit", windowId: "day", unit: "messages" });
    });
    const limits: SpendingLimits = { assertWithinLimit: async () => {}, status: async () => ({ state: "ok" }), takeMessage };
    const { call, createChat, storage } = createTestChat({ limits });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { kind: "spending_limit_reached", scope: "user", period: "day", resetsAt, reason: "limit", windowId: "day", unit: "messages" },
    });
    expect(await storage.listMessages(chatId)).toEqual([]);
    expect(takeMessage).toHaveBeenCalledWith({ userId: expect.any(String), chatId });
  });

  it("не исчерпан — ход идёт как обычно", async () => {
    const { limits } = fakeLimits("warning");
    const { call, createChat, history } = createTestChat({ limits });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(200);
    await response.text();
    expect((await history(chatId)).messages.at(-1)?.role).toBe("assistant");
  });

  it("сбой проверки — 500 «other», сбой в журнале сервера, модель не вызвана", async () => {
    const { limits, control } = fakeLimits();
    control.fail = true;
    const logError = vi.fn();
    const { call, createChat, storage } = createTestChat({ limits, logError });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(500);
    expect(await storage.listMessages(chatId)).toEqual([]);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });
});

describe("GET /:chatId/spending", () => {
  it("отдаёт состояние без денег", async () => {
    const { limits } = fakeLimits("warning");
    const { call, createChat } = createTestChat({ limits });
    const chatId = await createChat();
    const response = await call("GET", `/${chatId}/spending`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "warning", scope: "user", period: "month", share: 0.85, resetsAt });
  });

  it("лимитов нет у человека — только состояние ok", async () => {
    const { limits } = fakeLimits("ok");
    const { call, createChat } = createTestChat({ limits });
    const chatId = await createChat();
    expect(await (await call("GET", `/${chatId}/spending`)).json()).toEqual({ state: "ok" });
  });

  it("чужой чат — 404, лимиты не спрашиваются", async () => {
    const { limits } = fakeLimits("warning");
    const { call, createChat } = createTestChat({ limits });
    const chatId = await createChat("anna");
    const response = await call("GET", `/${chatId}/spending`, { user: "boris" });
    expect(response.status).toBe(404);
    expect(limits.status).not.toHaveBeenCalled();
  });

  it("без входа — 401", async () => {
    const { limits } = fakeLimits();
    const { call, createChat } = createTestChat({ limits });
    const chatId = await createChat();
    expect((await call("GET", `/${chatId}/spending`, { user: null })).status).toBe(401);
  });

  it("без limits адреса нет", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    expect((await call("GET", `/${chatId}/spending`)).status).toBe(404);
  });
});
