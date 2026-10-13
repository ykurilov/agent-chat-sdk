// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Расскажи подробно" }] };

describe("useAgentChat: подключение к идущему ответу", () => {
  it("история с running: true — хук подключается через GET {api}/{chatId}/stream и показывает ответ с начала", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const { result } = renderChatHook(server);

    await waitFor(() => expect(server.resumed).toHaveLength(1));
    expect(server.requestsTo("stream")).toHaveLength(1);
    const stream = server.resumed[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t0" });
    stream.push({ type: "text-delta", id: "t0", delta: "Начало, " });
    stream.push({ type: "text-delta", id: "t0", delta: "продолжение" });
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1"]));
    expect(result.current.busy).toBe(true);

    stream.finish("t0");
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "Начало, продолжение", state: "done" }]);
    expect(result.current.messages.at(-1)?.metadata?.status).toBe("complete");
  });

  it("история с running: false — к потоку не подключается", async () => {
    const server = fakeChatServer({ history: [question], running: false, resumable: true });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("stream")).toHaveLength(0);
  });

  it("на 204 ничего не показывает и не зависает в «идёт ответ»", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: false });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.requestsTo("stream")).toHaveLength(1));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it("ход закончился между загрузкой истории и подключением (204) — готовый ответ берётся из истории", async () => {
    const answer = {
      id: "a1",
      role: "assistant" as const,
      parts: [{ type: "text", text: "Готовый ответ", state: "done" }],
      metadata: { status: "complete" },
    };
    const server = fakeChatServer({ history: [question], running: true, resumable: false });
    let historyLoads = 0;
    const finishedMeanwhile: typeof globalThis.fetch = async (input, init) => {
      const response = await server.fetch(input, init);
      const isHistory = (init?.method ?? "GET") === "GET" && String(input) === "/api/chat/c1";
      if (isHistory && ++historyLoads > 1) {
        return Response.json({ chat: { id: "c1" }, messages: [question, answer], running: false });
      }
      return response;
    };
    const { result } = renderChatHook(server, { fetch: finishedMeanwhile });

    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1"]));
    expect(result.current.busy).toBe(false);
    expect(server.requestsTo("stream")).toHaveLength(1);
  });

  it("размонтирование посреди идущего ответа не шлёт stop на сервер", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const { result, unmount } = renderChatHook(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    server.resumed[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(result.current.busy).toBe(true));

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("stop")).toHaveLength(0);
  });

  it("stop() после подключения шлёт POST {api}/{chatId}/stop и помечает ответ остановленным", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    const stream = server.resumed[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t0" });
    stream.push({ type: "text-delta", id: "t0", delta: "Начало" });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    await act(async () => {
      await result.current.stop();
    });
    expect(server.requestsTo("stop")).toHaveLength(1);
    expect(result.current.busy).toBe(false);
    expect(result.current.messages.at(-1)?.metadata?.status).toBe("stopped");
  });
});
