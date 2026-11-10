// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";

const nativeAny = AbortSignal.any;
afterEach(() => {
  cleanup();
  AbortSignal.any = nativeAny;
});

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answer: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуй", state: "done" }], metadata: { status: "complete" } };

describe("useAgentChat в браузере без AbortSignal.any (Safari до 17.4)", () => {
  it("грузит историю, открывает подписку и отвечает на вопрос", async () => {
    // @ts-expect-error — старый браузер
    delete AbortSignal.any;
    const server = fakeChatServer({ history: [question, answer], resumable: true });
    server.state.watch = true;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1"]));
    expect(result.current.connection).toBe("online");
    await waitFor(() => expect(server.watches).toHaveLength(1));
    act(() => result.current.setValue("Ещё вопрос"));
    act(() => result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    // Сервер сохранил ход: перечитанная после ответа история его содержит.
    const sent = (server.requestsTo("messages")[0]!.body as { message: HistoryMessage }).message;
    server.state.history = [question, answer, sent, { id: "a2", role: "assistant", parts: [{ type: "text", text: "Ответ", state: "done" }], metadata: { status: "complete" } }];
    server.streams[0]!.answer("Ответ", "a2");
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.messages.at(-1)?.id).toBe("a2");
  });
});
