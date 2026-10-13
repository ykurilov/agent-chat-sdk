// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";

afterEach(cleanup);

const question = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string, status = "complete"): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status },
});
const ids = (result: { current: { messages: Array<{ id: string }> } }) => result.current.messages.map((message) => message.id);

/** Чат с двумя ответами на один вопрос: на экране второй, первый — сосед. */
function chatWithTwoAnswers() {
  const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a2", "Второй")] });
  server.state.forks = [{ messageId: "a2", siblingIds: ["a1", "a2"] }];
  server.state.branchTo = {
    a1: {
      messages: [question("u1", "Привет"), answer("a1", "Первый")],
      forks: [{ messageId: "a1", siblingIds: ["a1", "a2"] }],
    },
  };
  return server;
}

describe("useAgentChat: ветки", () => {
  it("развилки берутся из истории", async () => {
    const { result } = renderChatHook(chatWithTwoAnswers());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.forks).toEqual([{ messageId: "a2", siblingIds: ["a1", "a2"] }]);
  });

  it("у сервера без веток развилок нет", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет")] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.forks).toEqual([]);
  });

  it("selectBranch шлёт POST /branch и показывает историю новой ветки вместе с развилками", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(() => result.current.selectBranch("a1"));
    expect(server.requestsTo("branch")[0]?.body).toEqual({ messageId: "a1" });
    expect(ids(result)).toEqual(["u1", "a1"]);
    expect(result.current.forks).toEqual([{ messageId: "a1", siblingIds: ["a1", "a2"] }]);
  });

  it("selectBranch не идёт к серверу, пока идёт ответ", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Ещё"));
    act(() => result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await act(() => result.current.selectBranch("a1"));
    expect(server.requestsTo("branch")).toHaveLength(0);
    server.streams[0]!.end();
  });

  it("regenerate шлёт POST /regenerate с id ответа; новый ответ заменяет прежний, развилки обновляются после конца", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canRegenerate).toBe(true);

    act(() => result.current.regenerate());
    await waitFor(() => expect(server.regenerations).toHaveLength(1));
    expect(server.requestsTo("regenerate")[0]?.body).toEqual({ messageId: "a2", timeZone: expect.any(String) });
    expect(server.requestsTo("retry")).toHaveLength(0);
    expect(ids(result)).toEqual(["u1"]);

    server.state.forks = [{ messageId: "a3", siblingIds: ["a1", "a2", "a3"] }];
    server.regenerations[0]!.answer("Третий", "a3");
    await waitFor(() => expect(ids(result)).toEqual(["u1", "a3"]));
    await waitFor(() => expect(result.current.forks).toEqual([{ messageId: "a3", siblingIds: ["a1", "a2", "a3"] }]));
    expect(server.requestsTo("branches")).toHaveLength(1);
  });

  it("переделка не дошла до сервера: прежний ответ возвращается на место", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server, { liveness: { reconnectDelaysMs: [0], requestTimeoutMs: 200 } });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    server.state.down = true;
    act(() => result.current.regenerate());
    await waitFor(() => expect(result.current.connection).toBe("offline"));
    expect(ids(result)).toEqual(["u1", "a2"]);
  });

  it("canRegenerate: нет у ответа с ошибкой (там «повторить»), нет во время ответа, нет без ответа", async () => {
    const failed = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "", "error")] });
    const failedChat = renderChatHook(failed);
    await waitFor(() => expect(failedChat.result.current.loaded).toBe(true));
    expect(failedChat.result.current.canRetry).toBe(true);
    expect(failedChat.result.current.canRegenerate).toBe(false);

    const unanswered = fakeChatServer({ history: [question("u1", "Привет")] });
    const unansweredChat = renderChatHook(unanswered);
    await waitFor(() => expect(unansweredChat.result.current.loaded).toBe(true));
    expect(unansweredChat.result.current.canRegenerate).toBe(false);

    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Ещё"));
    act(() => result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(result.current.canRegenerate).toBe(false);
    expect(result.current.canEdit).toBe(false);
    server.streams[0]!.end();
  });

  it("edit убирает правимое сообщение и всё после него, шлёт POST /edit с новым id и текстом; развилки обновляются после конца", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canEdit).toBe(true);

    act(() => void result.current.edit("u1", "Здравствуйте"));
    await waitFor(() => expect(server.edits).toHaveLength(1));
    const body = server.requestsTo("edit")[0]?.body as { editedMessageId: string; message: { id: string; role: string; parts: unknown[] } };
    expect(body.editedMessageId).toBe("u1");
    expect(body.message).toEqual({ id: expect.any(String), role: "user", parts: [{ type: "text", text: "Здравствуйте" }] });
    expect(body.message.id).not.toBe("u1");
    expect(server.requestsTo("messages")).toHaveLength(0);
    expect(result.current.messages.map((message) => message.role)).toEqual(["user"]);

    server.state.forks = [{ messageId: body.message.id, siblingIds: ["u1", body.message.id] }];
    server.edits[0]!.answer("Здравствуйте!", "a3");
    await waitFor(() => expect(ids(result)).toEqual([body.message.id, "a3"]));
    await waitFor(() => expect(result.current.forks).toEqual([{ messageId: body.message.id, siblingIds: ["u1", body.message.id] }]));
  });

  it("правка сообщения с файлами: файлы уходят вместе с новым текстом; только файлы — правка с пустым текстом допустима", async () => {
    const photo = { type: "file", url: "attachment:f1", mediaType: "image/png", filename: "кот.png" };
    const server = fakeChatServer({
      history: [{ id: "u1", role: "user", parts: [photo, { type: "text", text: "Смотри" }] }, answer("a1", "Вижу")],
    });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => void result.current.edit("u1", "Смотри внимательнее"));
    await waitFor(() => expect(server.edits).toHaveLength(1));
    const body = server.requestsTo("edit")[0]?.body as { message: { parts: unknown[] } };
    expect(body.message.parts).toEqual([photo, { type: "text", text: "Смотри внимательнее" }]);
    server.edits[0]!.answer("Вижу лучше", "a2");
    await waitFor(() => expect(result.current.busy).toBe(false));

    const second = server.requestsTo("edit").length;
    act(() => void result.current.edit(result.current.messages[0]!.id, "   "));
    await waitFor(() => expect(server.requestsTo("edit")).toHaveLength(second + 1));
    expect((server.requestsTo("edit").at(-1)?.body as { message: { parts: unknown[] } }).message.parts).toEqual([photo]);
  });

  it("правка без файлов с пустым текстом не уходит на сервер", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => void result.current.edit("u1", "   "));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("edit")).toHaveLength(0);
  });

  it("правка, что не дошла до сервера, повторяется через /edit с тем же сообщением, а не через /messages", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server, { liveness: { reconnectDelaysMs: [0], requestTimeoutMs: 200 } });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    server.state.fail.add("edit");
    act(() => void result.current.edit("u1", "Здравствуйте"));
    await waitFor(() => expect(result.current.sendFailed).toBe(true));

    server.state.fail.delete("edit");
    act(() => result.current.retry());
    await waitFor(() => expect(server.edits).toHaveLength(1));
    const [first, second] = server.requestsTo("edit");
    expect(second?.body).toEqual(first?.body);
    expect(server.requestsTo("messages")).toHaveLength(0);
    server.edits[0]!.end();
  });

  it("правка во время ответа на сервере (409): сообщения возвращаются, edit отвечает отказом «busy», повторной отправки нет", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server, { liveness: { reconnectDelaysMs: [0], requestTimeoutMs: 200 } });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const before = ids(result);
    server.state.refuse.edit = { status: 409, kind: "busy" };

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.edit("u1", "Здравствуйте");
    });
    expect(outcome).toEqual({ status: "refused", reason: "busy" });
    expect(ids(result)).toEqual(before);
    expect(result.current.sendFailed).toBe(false);
    expect(result.current.connection).toBe("online");
    expect(server.requestsTo("edit")).toHaveLength(1);
    expect(result.current.canEdit).toBe(true);
  });

  it("сервер отклонил правку как неверную (400) или сообщения нет (404): тоже отказ с причиной, лента прежняя", async () => {
    for (const [status, kind, reason] of [[400, "invalid", "invalid"], [404, "not_found", "not_found"]] as const) {
      const server = chatWithTwoAnswers();
      const { result, unmount } = renderChatHook(server, { liveness: { reconnectDelaysMs: [0], requestTimeoutMs: 200 } });
      await waitFor(() => expect(result.current.loaded).toBe(true));
      server.state.refuse.edit = { status, kind };
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.edit("u1", "Текст");
      });
      expect(outcome).toEqual({ status: "refused", reason });
      expect(ids(result)).toEqual(["u1", "a2"]);
      unmount();
    }
  });

  it("429 на правку из-за лимита сообщений: в отказе unit messages", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server, { spendingLimits: true, liveness: { reconnectDelaysMs: [0], requestTimeoutMs: 200 } });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    server.state.refuseSpending = { scope: "user", period: "day", resetsAt: "2026-10-08T00:00:00.000Z", reason: "limit", windowId: "day", unit: "messages" };

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.edit("u1", "Здравствуйте");
    });
    expect(outcome).toEqual({ status: "refused", reason: "spending_limit", unit: "messages" });
  });

  it("429 на правку (лимит исчерпан): edit отвечает отказом «spending_limit», лента прежняя, состояние — «исчерпан»", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server, { spendingLimits: true, liveness: { reconnectDelaysMs: [0], requestTimeoutMs: 200 } });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const before = ids(result);
    server.state.refuseSpending = { scope: "user", period: "month", resetsAt: "2026-11-01T00:00:00.000Z" };

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.edit("u1", "Здравствуйте");
    });
    expect(outcome).toEqual({ status: "refused", reason: "spending_limit" });
    expect(ids(result)).toEqual(before);
    expect(result.current.value).toBe("");
    expect(result.current.sendFailed).toBe(false);
    await waitFor(() => expect(result.current.spending?.state).toBe("exhausted"));
  });

  it("правка принята: edit отвечает «started» сразу, не дожидаясь конца ответа", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.edit("u1", "Здравствуйте");
    });
    expect(outcome).toEqual({ status: "started" });
    expect(result.current.busy).toBe(true);
    server.edits[0]!.end();
  });

  it("правка, что не стартовала (нет связи, идёт ответ, пустой текст): «not_started» с причиной, запроса нет", async () => {
    const server = chatWithTwoAnswers();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.edit("u1", "   ");
    });
    expect(outcome).toEqual({ status: "not_started", reason: "empty" });

    act(() => result.current.setValue("Ещё"));
    act(() => result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await act(async () => {
      outcome = await result.current.edit("u1", "Текст");
    });
    expect(outcome).toEqual({ status: "not_started", reason: "busy" });
    expect(server.requestsTo("edit")).toHaveLength(0);
    server.streams[0]!.end();
  });
});

describe("«Переделать» у ответа без сообщения человека", () => {
  const notice: HistoryMessage = {
    id: "n1",
    role: "user",
    parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "conversation_started", title: "Поздоровайся" }] } }],
  };

  it("приветствие текстом: canRegenerate выключен", async () => {
    const { result } = renderChatHook(fakeChatServer({ history: [answer("g1", "Здравствуйте!")] }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canRegenerate).toBe(false);
  });

  it("приветствие по указанию (перед ним только служебное сообщение): canRegenerate выключен", async () => {
    const { result } = renderChatHook(fakeChatServer({ history: [notice, answer("g1", "Добрый день!")] }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canRegenerate).toBe(false);
  });

  it("ответ после вопроса человека — можно, даже если перед ответом было приветствие", async () => {
    const { result } = renderChatHook(fakeChatServer({ history: [answer("g1", "Здравствуйте!"), question("u1", "Привет"), answer("a1", "Ответ")] }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canRegenerate).toBe(true);
  });
});
