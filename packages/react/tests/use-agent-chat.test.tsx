// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

describe("useAgentChat", () => {
  it("грузит начальную историю через GET {api}/{chatId}", async () => {
    const server = fakeChatServer({
      history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }],
    });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(server.requests[0]).toMatchObject({ method: "GET", url: "/api/chat/c1" });
    expect(result.current.messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it("отправка шлёт POST {api}/{chatId}/messages только с новым сообщением", async () => {
    const server = fakeChatServer({
      history: [{ id: "u0", role: "user", parts: [{ type: "text", text: "Было" }] }],
    });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Новый вопрос"));
    act(() => result.current.submit());

    await waitFor(() => expect(server.requests.some((request) => request.method === "POST")).toBe(true));
    const post = server.requests.find((request) => request.method === "POST");
    expect(post?.url).toBe("/api/chat/c1/messages");
    expect(post?.body).toEqual({
      message: { id: expect.any(String), role: "user", parts: [{ type: "text", text: "Новый вопрос" }] },
      timeZone: expect.any(String),
    });
    expect(result.current.value).toBe("");
    server.streams[0]?.end();
  });

  it("отправка, нажатая до загрузки, не уходит в другой чат после перехода", async () => {
    const server = fakeChatServer();
    const holdFirstChat: typeof globalThis.fetch = (input, init) => {
      if (String(input) === "/api/chat/c1") return new Promise<Response>(() => undefined);
      return server.fetch(input, init);
    };
    const { result, rerender } = renderChatHook(server, { fetch: holdFirstChat });
    act(() => result.current.setValue("Вопрос для первого чата"));
    act(() => result.current.submit());

    rerender({ chatId: "c2" });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(server.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("отправка до загрузки истории не теряется: уходит, как только история пришла", async () => {
    const server = fakeChatServer({
      history: [{ id: "u0", role: "user", parts: [{ type: "text", text: "Было" }] }],
    });
    let releaseHistory!: () => void;
    const historyHeld = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    const slowHistory: typeof globalThis.fetch = async (input, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "GET") await historyHeld;
      return server.fetch(input, init);
    };
    const { result } = renderChatHook(server, { fetch: slowHistory });

    act(() => result.current.setValue("Вопрос сразу"));
    act(() => result.current.submit());
    expect(server.requests.some((request) => request.method === "POST")).toBe(false);

    releaseHistory();
    await waitFor(() => expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(1));
    expect(server.requests.find((request) => request.method === "POST")?.body).toMatchObject({
      message: { role: "user", parts: [{ type: "text", text: "Вопрос сразу" }] },
    });
    // История не затёрла отправленное сообщение.
    await waitFor(() =>
      expect(result.current.messages.map((message) => message.parts[0])).toEqual([
        { type: "text", text: "Было" },
        { type: "text", text: "Вопрос сразу" },
      ]),
    );
    expect(result.current.value).toBe("");
    server.streams[0]?.end();
  });

  it("canSubmit — false при пустом тексте, одних пробелах и во время ответа", async () => {
    const server = fakeChatServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setValue("   \n "));
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setValue("Вопрос"));
    expect(result.current.canSubmit).toBe(true);

    act(() => result.current.submit());
    act(() => result.current.setValue("Следующий"));
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.canSubmit).toBe(false);

    server.streams[0]?.push({ type: "start", messageId: "a1" });
    server.streams[0]?.push({ type: "finish" });
    server.streams[0]?.end();
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.canSubmit).toBe(true);
  });

  it("двойной вызов submit подряд даёт один запрос", async () => {
    const server = fakeChatServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Вопрос"));
    act(() => {
      result.current.submit();
      result.current.submit();
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("messages")).toHaveLength(1);
    server.streams[0]?.end();
  });
});
