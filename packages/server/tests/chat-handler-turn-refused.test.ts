import { describe, expect, it, vi } from "vitest";
import { createTestChat, message } from "./support/test-chat";

const closed = { code: "lesson_closed", message: "Урок закрыт" };

/** Проверка перед ходом, которой управляет тест. */
function gate() {
  const state = { closed: false };
  const beforeTurn = vi.fn(async () => (state.closed ? closed : undefined));
  return { state, beforeTurn };
}

describe("обработчик чата: отказ приложения в ходе (beforeTurn)", () => {
  it("отправка: 403 turn_refused с кодом и текстом; сообщение не записано, модель не вызвана", async () => {
    const { state, beforeTurn } = gate();
    const { call, createChat, storage, history } = createTestChat({ beforeTurn });
    const chatId = await createChat();
    state.closed = true;
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" } });
    expect(await storage.listMessages(chatId)).toEqual([]);
    expect((await history(chatId)).running).toBe(false);
  });

  it("проверка получает человека, чат и текст", async () => {
    const { beforeTurn } = gate();
    const { call, createChat } = createTestChat({ beforeTurn });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    expect(beforeTurn).toHaveBeenCalledWith(expect.objectContaining({ userId: "anna", action: "send", text: "Привет", chat: expect.objectContaining({ id: chatId }) }));
  });

  it("повтор, переделка и правка отвечают так же", async () => {
    const { state, beforeTurn } = gate();
    const { call, createChat } = createTestChat({ beforeTurn });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    state.closed = true;
    const retry = await call("POST", `/${chatId}/retry`);
    const regenerate = await call("POST", `/${chatId}/regenerate`, { body: { messageId: "x" } });
    const edit = await call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u2", "Правка") } });
    for (const response of [retry, regenerate, edit]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" } });
    }
  });

  it("исключение из проверки — 500 other и строка в журнале; ничего не записано", async () => {
    const logError = vi.fn();
    const { call, createChat, storage } = createTestChat({
      beforeTurn: () => {
        throw new Error("база урока недоступна");
      },
      logError,
    });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { kind: "other" } });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база урока недоступна"));
    expect(await storage.listMessages(chatId)).toEqual([]);
  });

  it("неверный код отказа — ошибка приложения: 500 other и строка в журнале", async () => {
    const logError = vi.fn();
    const { call, createChat, storage } = createTestChat({ beforeTurn: () => ({ code: "Урок закрыт", message: "x" }), logError });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { kind: "other" } });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("beforeTurn"));
    expect(await storage.listMessages(chatId)).toEqual([]);
  });

  it("без beforeTurn ход идёт как прежде", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"finish"');
  });
});

describe("обработчик чата: отказ приложения в доступе (resolveUser)", () => {
  const refusingUser = (refused: { code: string; message: string; status?: 401 | 403 }) => async () => ({ refused });

  it("по умолчанию 403 access_refused с кодом и текстом — на любом адресе, до разбора пути", async () => {
    const { call } = createTestChat({ resolveUser: refusingUser({ code: "no_course", message: "Нужен доступ к курсу" }) });
    for (const [method, path] of [["POST", ""], ["GET", ""], ["GET", "/abc"], ["POST", "/abc/messages"], ["GET", "/abc/stream"], ["GET", "/memory"]] as const) {
      const response = await call(method, path, method === "POST" ? { body: message("u1", "Привет") } : {});
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
      expect(await response.json()).toEqual({ error: { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" } });
    }
  });

  it("status 401 — ответ 401 с тем же телом", async () => {
    const { call } = createTestChat({ resolveUser: refusingUser({ code: "session_expired", message: "Войдите заново", status: 401 }) });
    const response = await call("GET", "");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { kind: "access_refused", code: "session_expired", message: "Войдите заново" } });
  });

  it("длинный текст обрезается до 300 знаков", async () => {
    const { call } = createTestChat({ resolveUser: refusingUser({ code: "no_course", message: "я".repeat(400) }) });
    const body = (await (await call("GET", "")).json()) as { error: { message: string } };
    expect(body.error.message).toHaveLength(300);
  });

  it("неверный код — ошибка приложения: 500 other и строка в журнале", async () => {
    const logError = vi.fn();
    const { call } = createTestChat({ resolveUser: refusingUser({ code: "Нет Доступа", message: "x" }), logError });
    const response = await call("GET", "");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { kind: "other" } });
    expect(logError).toHaveBeenCalled();
  });

  it("null остаётся 401 invalid; обычный человек — как прежде", async () => {
    const { call } = createTestChat();
    const anonymous = await call("POST", "", { user: null });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: { kind: "invalid" } });
    expect((await call("POST", "")).status).toBeLessThan(300);
  });

  it("запрос с чужой страницы по-прежнему 403 forbidden_origin, а не отказ приложения", async () => {
    const { handler } = createTestChat({ resolveUser: refusingUser({ code: "no_course", message: "Нет" }), allowedOrigins: [] });
    const response = await handler.fetch(
      new Request("http://test.local/api/chat", { method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "forbidden_origin" } });
  });
});
