// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";

afterEach(cleanup);

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answer: HistoryMessage = {
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "Здравствуй", state: "done" }],
  metadata: { status: "complete" },
};
const notice: HistoryMessage = {
  id: "n1",
  role: "user",
  parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "task_done", taskId: "t1", title: "Отчёт готов", result: "Три статьи" }] } }],
};

const watchingServer = () => {
  const server = fakeChatServer({ history: [question, answer], resumable: true });
  server.state.watch = true;
  return server;
};

describe("useAgentChat: подписка на события чата", () => {
  it("после загрузки истории открывается GET {chat}/watch; открытие и tasks-changed меняют tasksVersion", async () => {
    const server = watchingServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    expect(server.requestsTo("watch")[0]!.url).toBe("/api/chat/c1/watch");
    await waitFor(() => expect(result.current.tasksVersion).toBe(1));
    act(() => server.emit({ type: "tasks-changed" }));
    await waitFor(() => expect(result.current.tasksVersion).toBe(2));
  });

  it("turn-started: история перечитывается со служебным сообщением, ход подхватывается из /stream в ленту", async () => {
    const server = watchingServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    server.state.history = [question, answer, notice];
    server.state.running = true;
    act(() => server.emit({ type: "turn-started", messageId: "n1", trigger: "notice", channel: "web" }));
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "n1"]));
    expect(server.watches[0]!.signal?.aborted).toBe(true);

    const stream = server.resumed[0]!;
    // Ход закончился и на сервере: открытие подписки после него перечитает уже готовую историю.
    server.state.running = false;
    server.state.history = [question, answer, notice, { id: "a2", role: "assistant", parts: [{ type: "text", text: "Отчёт: три статьи", state: "done" }], metadata: { status: "complete" } }];
    stream.answer("Отчёт: три статьи", "a2");
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "n1", "a2"]);
    // Ход закончился — подписка снова открыта.
    await waitFor(() => expect(server.watches).toHaveLength(2));
  });

  it("свой ход закрывает подписку на время ответа и открывает после", async () => {
    const server = watchingServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    act(() => {
      result.current.setValue("Ещё вопрос");
    });
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(server.watches[0]!.signal?.aborted).toBe(true);
    server.streams[0]!.answer("Ответ", "a2");
    await waitFor(() => expect(result.current.busy).toBe(false));
    await waitFor(() => expect(server.watches).toHaveLength(2));
  });

  it("итог фона пришёл, пока шёл свой ответ: подписка открывается заново, история перечитывается, ход подхватывается", async () => {
    const server = watchingServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    act(() => {
      result.current.setValue("Ещё вопрос");
    });
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    // Пока шёл ответ, фон доставил итог и начал ход: подписка была закрыта, событие до вкладки не дошло.
    const own = server.requestsTo("messages")[0]!.body as { id?: string; message?: { id: string } };
    const ownQuestion: HistoryMessage = { id: own.message?.id ?? own.id ?? "u2", role: "user", parts: [{ type: "text", text: "Ещё вопрос" }] };
    const ownAnswer: HistoryMessage = { id: "a2", role: "assistant", parts: [{ type: "text", text: "Ответ", state: "done" }], metadata: { status: "complete" } };
    server.state.history = [question, answer, ownQuestion, ownAnswer, notice];
    server.state.running = true;
    server.streams[0]!.answer("Ответ", "a2");
    await waitFor(() => expect(server.watches).toHaveLength(2));
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toContain("n1"));
  });

  it("notice-added: тихое служебное сообщение (отмена задачи) появляется без перезагрузки, ход не подхватывается", async () => {
    const server = watchingServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    const historyReads = server.requestsTo("history").length;
    server.state.history = [question, answer, notice];
    act(() => server.emit({ type: "notice-added", messageId: "n1" }));
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "n1"]));
    expect(server.requestsTo("history").length).toBe(historyReads + 1);
    expect(server.resumed).toHaveLength(0);
  });

  it("message-added: сообщение из мессенджера, ждущее тишины (пачка), появляется без перезагрузки", async () => {
    const server = watchingServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    const later: HistoryMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "и ещё" }] };
    server.state.history = [question, answer, later];
    act(() => server.emit({ type: "message-added", messageId: "u2" }));
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "u2"]));
    expect(server.resumed).toHaveLength(0);
  });

  it("ответ на виджет: turn-started своего продолжения не перечитывает историю — виджет остаётся в ответе", async () => {
    const widgetPart = { type: "tool-ask_choice", toolCallId: "w1", state: "input-available", input: { question: "Куда?", options: ["Море", "Горы"] } };
    const waiting: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "step-start" }, widgetPart], metadata: { status: "awaiting_approval" } };
    const server = fakeChatServer({ history: [question, waiting], resumable: true });
    server.state.watch = true;
    // Настоящий сервер начинает продолжение и шлёт turn-started, пока ответ на POST ещё не пришёл.
    const serverFetch = server.fetch;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/widgets/")) {
        server.state.running = true;
        server.state.history = [question];
        server.emit({ type: "turn-started", messageId: "a1", trigger: "human", channel: "web" });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return serverFetch(input, init);
    }) as typeof globalThis.fetch;
    const { result } = renderChatHook({ ...server, fetch });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    const historyReads = server.requestsTo("history").length;
    await act(async () => {
      void result.current.answerWidget("w1", { "выбрано": "Море" });
      await waitFor(() => expect(server.resumed).toHaveLength(1));
    });
    expect(server.requestsTo("history")).toHaveLength(historyReads);
    const stream = server.resumed[0]!;
    server.state.running = false;
    server.state.history = [
      question,
      { ...waiting, parts: [...waiting.parts, { type: "text", text: "Едем на море", state: "done" }], metadata: { status: "complete" } },
    ];
    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "start-step" });
      stream.push({ type: "text-start", id: "t" });
      stream.push({ type: "text-delta", id: "t", delta: "Едем на море" });
      stream.push({ type: "text-end", id: "t" });
      stream.push({ type: "message-metadata", messageMetadata: { status: "complete" } });
      stream.push({ type: "finish" });
      stream.end();
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    const last = result.current.messages.at(-1)!;
    expect(last.id).toBe("a1");
    expect(last.parts.some((part) => part.type === "tool-ask_choice")).toBe(true);
  });

  describe("два перечитывания подряд (открытие подписки, затем ход сервера)", () => {
    const morning: HistoryMessage = { id: "a2", role: "assistant", parts: [{ type: "text", text: "Доброе утро!", state: "done" }], metadata: { status: "complete" } };

    /**
     * Сервер под нагрузкой: каждое перечитывание после загрузки читает историю сразу, а ответ отдаёт, когда тест его
     * отпустит. Открытие подписки прочитало историю до хода сервера; ход по таймеру записал служебное сообщение и
     * «Доброе утро!» и закончился раньше, чем вкладка прочитала историю по `turn-started`.
     */
    async function twoReads() {
      const server = watchingServer();
      const held: Array<() => void> = [];
      let historyReads = 0;
      const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await server.fetch(input, init);
        if ((init?.method ?? "GET") === "GET" && String(input) === "/api/chat/c1" && ++historyReads > 1) {
          await new Promise<void>((release) => held.push(release));
        }
        return response;
      }) as typeof globalThis.fetch;
      const hook = renderChatHook({ ...server, fetch });
      await waitFor(() => expect(held).toHaveLength(1));
      server.state.history = [question, answer, notice, morning];
      act(() => server.emit({ type: "turn-started", messageId: "a2", trigger: "notice", channel: "web" }));
      await waitFor(() => expect(held).toHaveLength(2));
      return { ...hook, server, held };
    }

    it("старое пришло первым: лента показывает его, а следом — новое с утренним ответом", async () => {
      const { result, server, held } = await twoReads();
      const before = result.current.messages;
      act(() => held[0]!());
      await waitFor(() => expect(result.current.messages).not.toBe(before));
      act(() => held[1]!());
      await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "n1", "a2"]));
      expect(server.requestsTo("history")).toHaveLength(3);
    });

    it("новое пришло первым: запоздавшее старое его не стирает", async () => {
      const { result, held } = await twoReads();
      act(() => held[1]!());
      await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "n1", "a2"]));
      const shown = result.current.messages;
      await act(async () => held[0]!());
      expect(result.current.messages).toBe(shown);
    });
  });

  it("сервер без подписки (404): один запрос, больше не спрашивает, даже после хода", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.requestsTo("watch")).toHaveLength(1));
    act(() => {
      result.current.setValue("Ещё вопрос");
    });
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0]!.answer("Ответ", "a2");
    await waitFor(() => expect(result.current.busy).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("watch")).toHaveLength(1);
    expect(result.current.tasksVersion).toBe(0);
  });

  it("доступ к подписке закрыт (401): после своего хода подписка открывается снова", async () => {
    const server = watchingServer();
    server.state.refuse.watch = { status: 401, kind: "unauthorized" };
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.requestsTo("watch")).toHaveLength(1));
    delete server.state.refuse.watch;
    act(() => {
      result.current.setValue("Ещё вопрос");
    });
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0]!.answer("Ответ", "a2");
    await waitFor(() => expect(server.watches).toHaveLength(1));
    await waitFor(() => expect(result.current.tasksVersion).toBe(1));
  });

  it("смена чата закрывает подписку прежнего чата и открывает новую", async () => {
    const server = watchingServer();
    const { rerender } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    rerender({ chatId: "c2" });
    await waitFor(() => expect(server.watches).toHaveLength(2));
    expect(server.watches[0]!.signal?.aborted).toBe(true);
    expect(server.requestsTo("watch")[1]!.url).toBe("/api/chat/c2/watch");
  });

  it("размонтирование закрывает подписку", async () => {
    const server = watchingServer();
    const { unmount } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    unmount();
    expect(server.watches[0]!.signal?.aborted).toBe(true);
  });

  it("чата нет (404 на историю) — подписка не открывается", async () => {
    const server = watchingServer();
    server.state.notFound = true;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.notFound).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("watch")).toHaveLength(0);
  });
});

describe("watch snapshot handshake in the hook", () => {
  function versionedServer(matches: boolean) {
    const server = watchingServer();
    const fetch = server.fetch;
    server.fetch = (async (input, init) => {
      const url = String(input);
      const response = await fetch(url.includes("/watch?") ? url.split("?")[0]! : input, init);
      if (url.includes("/watch")) {
        expect(new URL(url, "https://test.local").searchParams.get("historyVersion")).toBe("a".repeat(64));
        response.headers.set("x-agent-chat-history-match", matches ? "1" : "0");
      } else if (url === "/api/chat/c1") response.headers.set("x-agent-chat-history-version", "a".repeat(64));
      return response;
    }) as typeof fetch;
    return server;
  }

  it("does not load unchanged history again after opening watch, but still applies live messages", async () => {
    const server = versionedServer(true);
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.tasksVersion).toBe(1));
    expect(server.requestsTo("history")).toHaveLength(1);
    server.state.history = [question, answer, notice];
    act(() => server.emit({ type: "message-added", messageId: "n1" }));
    await waitFor(() => expect(result.current.messages.map(message => message.id)).toContain("n1"));
    expect(server.requestsTo("history")).toHaveLength(2);
  });

  it("reloads when the snapshot changed during the gap", async () => {
    const server = versionedServer(false);
    const fetch = server.fetch;
    server.fetch = (async (input, init) => {
      if (String(input).includes("/watch")) server.state.history = [question, answer, notice];
      return fetch(input, init);
    }) as typeof fetch;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.messages.map(message => message.id)).toContain("n1"));
    expect(server.requestsTo("history")).toHaveLength(2);
  });
});
