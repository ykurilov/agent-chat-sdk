// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Расскажи" }] };
const answer = (status: string) => ({
  id: "a1",
  role: "assistant" as const,
  parts: [{ type: "text", text: "Начало", state: status === "streaming" ? "streaming" : "done" }],
  metadata: { status },
});

/** Сервер упал и поднялся: ответ в истории ещё идёт, а живого потока у сервера нет. */
function serverAfterCrash() {
  const server = fakeChatServer({ history: [question, answer("streaming")] });
  server.state.detachedAnswer = true;
  return server;
}

afterEach(cleanup);

describe("useAgentChat: ответ идёт в истории, а потока у сервера нет (FR-060)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function until(condition: () => boolean) {
    for (let step = 0; step < 100 && !condition(); step++) await act(() => vi.advanceTimersByTimeAsync(20));
    expect(condition()).toBe(true);
  }

  const lastStatus = (result: { current: { messages: Array<{ metadata?: unknown }> } }) =>
    (result.current.messages.at(-1)?.metadata as { status?: string } | undefined)?.status;

  it("перечитывает историю раз в 3 с и показывает «прерван» с «Повторить», как только сервер прервал ответ; дальше не спрашивает", async () => {
    const server = serverAfterCrash();
    const { result } = renderChatHook(server);
    await until(() => result.current.loaded);
    expect(lastStatus(result)).toBe("streaming");
    expect(result.current.canRetry).toBe(false);
    const first = server.requestsTo("history").length;

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(server.requestsTo("history")).toHaveLength(first + 1);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(server.requestsTo("history")).toHaveLength(first + 2);

    server.state.history = [question, answer("interrupted")];
    server.state.detachedAnswer = false;
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(lastStatus(result)).toBe("interrupted");
    expect(result.current.canRetry).toBe(true);

    const asked = server.requestsTo("history").length;
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(server.requestsTo("history")).toHaveLength(asked);
  });

  it("сервер так и не прервал ответ — через 30 с ответ прерван на экране, «Повторить» доступно, опрос остановлен", async () => {
    const server = serverAfterCrash();
    const { result } = renderChatHook(server);
    await until(() => result.current.loaded);

    await act(() => vi.advanceTimersByTimeAsync(27_000));
    expect(lastStatus(result)).toBe("streaming");
    await act(() => vi.advanceTimersByTimeAsync(3_500));
    expect(lastStatus(result)).toBe("interrupted");
    expect(result.current.canRetry).toBe(true);

    const asked = server.requestsTo("history").length;
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(server.requestsTo("history")).toHaveLength(asked);
  });

  it("связь пропала во время ожидания — опрос не останавливается и подхватывает итог, когда сервер снова отвечает", async () => {
    const server = serverAfterCrash();
    const { result } = renderChatHook(server);
    await until(() => result.current.loaded);

    server.state.fail.add("history");
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    server.state.fail.delete("history");
    server.state.history = [question, answer("interrupted")];
    server.state.detachedAnswer = false;
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(lastStatus(result)).toBe("interrupted");
  });

  it("опрос не трогает набранный, но не отправленный текст", async () => {
    const server = serverAfterCrash();
    const { result } = renderChatHook(server);
    await until(() => result.current.loaded);
    act(() => result.current.setValue("Пока не отправил"));
    const first = server.requestsTo("history").length;

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await act(() => vi.advanceTimersByTimeAsync(3_000));

    expect(server.requestsTo("history").length).toBeGreaterThan(first);
    expect(result.current.value).toBe("Пока не отправил");
  });

  it("ответ опроса пришёл после отправки нового вопроса — старая история не стирает только что отправленное", async () => {
    const server = serverAfterCrash();
    let holdHistory = false;
    let releaseHistory = () => {};
    const fetch: typeof server.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const isHistory = (init?.method ?? "GET") === "GET" && !/\/(stream|compactions|branches|spending|models)$/.test(url);
      if (holdHistory && isHistory) {
        holdHistory = false;
        const response = server.fetch(input, init);
        await new Promise<void>((resolve) => (releaseHistory = resolve));
        return response;
      }
      return server.fetch(input, init);
    });
    const { result } = renderChatHook(server, { fetch });
    await until(() => result.current.loaded);

    // Опрос спросил историю, а ответ сервера задержался.
    holdHistory = true;
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    act(() => result.current.setValue("Новый вопрос"));
    act(() => void result.current.submit());
    await until(() => server.streams.length === 1);
    releaseHistory();
    await act(() => vi.advanceTimersByTimeAsync(100));

    const texts = result.current.messages.flatMap((message) => message.parts.map((part) => ("text" in part ? part.text : "")));
    expect(texts).toContain("Новый вопрос");
  });

  it("обычная история без признака — опроса нет", async () => {
    const server = fakeChatServer({ history: [question, answer("complete")] });
    const { result } = renderChatHook(server);
    await until(() => result.current.loaded);
    const asked = server.requestsTo("history").length;
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(server.requestsTo("history")).toHaveLength(asked);
  });
});
