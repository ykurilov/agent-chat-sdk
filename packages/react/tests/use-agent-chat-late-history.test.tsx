// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";

afterEach(cleanup);

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answer: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуй", state: "done" }], metadata: { status: "complete" } };
const notice: HistoryMessage = { id: "n1", role: "user", parts: [{ type: "text", text: "Задача готова" }] };
const report: HistoryMessage = { id: "a2", role: "assistant", parts: [{ type: "text", text: "Отчёт", state: "done" }], metadata: { status: "complete" } };

describe("useAgentChat: запоздавшая история не перетирает более новую", () => {
  it("чтение после 204 от /stream пришло позже нового чтения — лента остаётся новой", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    server.state.watch = true;
    // Чтение истории с номером `late` отвечает снимком сервера на момент запроса, но приходит, когда тест отпустит.
    let historyReads = 0, late = -1, release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      const isHistory = (init?.method ?? "GET") === "GET" && /\/api\/chat\/c1(\?|$)/.test(url);
      const response = await server.fetch(input, init);
      if (isHistory && ++historyReads === late) await released;
      return response;
    };
    const { result } = renderChatHook(server, { fetch });
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1"]));
    await waitFor(() => expect(server.watches).toHaveLength(1));

    // Ход другой копии: история говорит «идёт», а поток уже закрыт (204) — вкладка перечитывает готовую историю.
    server.state.history = [question, answer, notice];
    server.state.running = true;
    late = historyReads + 2;
    act(() => server.emit({ type: "turn-started", messageId: "n1", trigger: "notice", channel: "web" }));
    await waitFor(() => expect(historyReads).toBe(late));

    // Пока запоздавшее чтение в пути, ход закончился и новое чтение показало ответ.
    server.state.running = false;
    server.state.history = [question, answer, notice, report];
    await waitFor(() => expect(server.watches.length).toBeGreaterThan(0));
    act(() => server.emit({ type: "message-added", messageId: "a2" }));
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "n1", "a2"]));

    release();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", "n1", "a2"]);
  });
});
