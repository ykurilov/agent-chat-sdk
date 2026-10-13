import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { createTestChat, message } from "./support/test-chat";

type SubjectChats = NonNullable<ChatHandlerOptions["subjectChats"]>;

const lesson: SubjectChats = async ({ key }) =>
  key === "lesson:closed" ? { code: "lesson_closed", message: "Урок ещё закрыт." } : { data: { secret: "ответ-42" }, title: "Урок", greeting: { text: "Здравствуйте! Начнём урок." } };

describe("обработчик чата: чат объекта", () => {
  it("POST {base}/subject создаёт чат с приветствием, повтор — тот же чат; данные объекта в браузер не уходят", async () => {
    const subjectChats = vi.fn(lesson);
    const { call, history } = createTestChat({ subjectChats });
    const first = await call("POST", "/subject", { body: { key: "lesson:1" } });
    expect(first.status).toBe(200);
    const opened = (await first.json()) as { id: string; created: boolean };
    expect(opened).toEqual({ id: expect.any(String), created: true });
    expect(subjectChats).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "anna" }, key: "lesson:1", request: expect.any(Request) }));

    const again = (await (await call("POST", "/subject", { body: { key: "lesson:1" } })).json()) as { id: string; created: boolean };
    expect(again).toEqual({ id: opened.id, created: false });

    const loaded = await history(opened.id);
    expect(loaded.messages.map((item) => item.role)).toEqual(["assistant"]);
    const raw = await (await call("GET", `/${opened.id}`)).text();
    expect(raw).not.toContain("ответ-42");

    const answer = await call("POST", `/${opened.id}/messages`, { body: message("u1", "Начнём") });
    expect(answer.status).toBe(200);
    await answer.text();
    expect((await history(opened.id)).messages.map((item) => item.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("приветствие-указание: новый чат сразу отвечает агент, повтор — без нового хода", async () => {
    const { call, history } = createTestChat({ subjectChats: async () => ({ greeting: { instruction: "Поздоровайся и предложи начать урок." } }) });
    const opened = (await (await call("POST", "/subject", { body: { key: "lesson:1" } })).json()) as { id: string; created: boolean };
    expect(opened.created).toBe(true);
    await vi.waitFor(async () => expect((await history(opened.id)).messages.map((item) => item.role)).toEqual(["user", "assistant"]));
    expect((await (await call("POST", "/subject", { body: { key: "lesson:1" } })).json()).created).toBe(false);
    expect((await history(opened.id)).messages).toHaveLength(2);
  });

  it("отказ приложения — 403 turn_refused с кодом и текстом, чат не создан", async () => {
    const { call, storage } = createTestChat({ subjectChats: lesson });
    const response = await call("POST", "/subject", { body: { key: "lesson:closed" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "turn_refused", code: "lesson_closed", message: "Урок ещё закрыт." } });
    expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
  });

  it("неверный ключ — 400 invalid; без входа — 401", async () => {
    const { call } = createTestChat({ subjectChats: lesson });
    for (const body of [{}, { key: "" }, { key: 7 }, { key: "x".repeat(201) }, undefined]) {
      const response = await call("POST", "/subject", { body });
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
    }
    expect((await call("POST", "/subject", { body: { key: "lesson:1" }, user: null })).status).toBe(401);
  });

  it("subjectChats вернул не объект — 500 и понятная запись в журнале, чат не создан", async () => {
    for (const answer of [null, undefined, "урок", 7]) {
      const logError = vi.fn();
      const { call, storage } = createTestChat({ subjectChats: async () => answer as never, logError });
      const response = await call("POST", "/subject", { body: { key: "lesson:1" } });
      expect(response.status).toBe(500);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("subjectChats должен вернуть объект"));
      expect(await storage.listChats("anna", { subjects: "include" })).toEqual([]);
    }
  });

  it("без subjectChats адреса нет — 404", async () => {
    const { call } = createTestChat();
    expect((await call("POST", "/subject", { body: { key: "lesson:1" } })).status).toBe(404);
  });

  it("хранилище без поиска по ключу — ошибка при создании обработчика", () => {
    const { findChatBySubject: _find, ...storage } = createInMemoryChatStorage();
    expect(() => createTestChat({ subjectChats: lesson, storage })).toThrow(/findChatBySubject/);
  });

  it("список: чаты объектов не видны; chatList: { subjectChats: true } — видны с ключом", async () => {
    const plain = createTestChat({ subjectChats: lesson, chatList: true });
    await plain.call("POST", "/subject", { body: { key: "lesson:1" } });
    expect(((await (await plain.call("GET", "")).json()) as { chats: unknown[] }).chats).toEqual([]);

    const withSubjects = createTestChat({ subjectChats: lesson, chatList: { subjectChats: true } });
    const { id } = (await (await withSubjects.call("POST", "/subject", { body: { key: "lesson:1" } })).json()) as { id: string };
    const listed = ((await (await withSubjects.call("GET", "")).json()) as { chats: Array<Record<string, unknown>> }).chats;
    expect(listed).toEqual([expect.objectContaining({ id, subjectKey: "lesson:1", title: "Урок" })]);
    expect(JSON.stringify(listed)).not.toContain("ответ-42");
    // Объект chatList включает и переименование.
    expect((await withSubjects.call("PATCH", `/${id}`, { body: { title: "Новое" } })).status).toBe(200);
  });
});
