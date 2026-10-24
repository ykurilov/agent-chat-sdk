// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { Endpoint, HistoryMessage } from "./support/fake-chat-server";

afterEach(cleanup);

type Server = ReturnType<typeof fakeChatServer>;
type Chat = ReturnType<typeof renderChatHook>;

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Вопрос" }] };

/** Запросы к адресу ждут, пока тест их не отпустит; запрос записан сразу, как пришёл. */
function hold(server: Server, endpoint: Endpoint): () => void {
  let release!: () => void;
  server.state.gate[endpoint] = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    delete server.state.gate[endpoint];
    release();
  };
}

const urlsTo = (server: Server, endpoint: Endpoint) => server.requestsTo(endpoint).map((request) => request.url);

/** Даёт запоздавшим продолжениям прежнего чата время дописать своё. */
async function letLateWorkFinish() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** Чат открыт и свободен: вопрос уходит на сервер именно этого чата. */
async function expectFreeToSend(server: Server, chat: Chat, chatId: string) {
  await waitFor(() => expect(chat.result.current.loaded).toBe(true));
  await waitFor(() => expect(chat.result.current.busy).toBe(false));
  act(() => chat.result.current.setValue("Новый вопрос"));
  expect(chat.result.current.canSubmit).toBe(true);
  act(() => {
    chat.result.current.submit();
  });
  await waitFor(() => expect(urlsTo(server, "messages")).toContain(`/api/chat/${chatId}/messages`));
}

describe("useAgentChat без key: дела прежнего чата не трогают открытый", () => {
  it("«Стоп» прежнего чата ещё идёт — «Стоп» нового уходит своим запросом, а не ждёт чужой", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const chat = renderChatHook(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    hold(server, "stop");
    act(() => {
      void chat.result.current.stop();
    });
    await waitFor(() => expect(urlsTo(server, "stop")).toEqual(["/api/chat/c1/stop"]));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(server.resumed).toHaveLength(2));
    act(() => {
      void chat.result.current.stop();
    });

    await waitFor(() => expect(urlsTo(server, "stop")).toEqual(["/api/chat/c1/stop", "/api/chat/c2/stop"]));
  });

  it("запоздавший «Стоп» прежнего чата не помечает остановленным ответ нового", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const chat = renderChatHook(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    const releaseStop = hold(server, "stop");
    act(() => {
      void chat.result.current.stop();
    });
    await waitFor(() => expect(server.requestsTo("stop")).toHaveLength(1));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(server.resumed).toHaveLength(2));
    const answer = server.resumed[1]!;
    answer.push({ type: "start", messageId: "a2" });
    answer.push({ type: "text-start", id: "t" });
    answer.push({ type: "text-delta", id: "t", delta: "Ответ нового чата" });
    await waitFor(() => expect(chat.result.current.messages.at(-1)?.id).toBe("a2"));
    releaseStop();
    await letLateWorkFinish();

    expect(chat.result.current.messages.at(-1)?.metadata?.status).not.toBe("stopped");
    expect(chat.result.current.busy).toBe(true);
  });

  it("ответ на подтверждение прежнего чата пришёл после перехода — новый чат не застывает «занятым»", async () => {
    const server = fakeChatServer({ history: [question] });
    const chat = renderChatHook(server);
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    const releaseApproval = hold(server, "approval");
    act(() => {
      void chat.result.current.respondToApproval("ap1", "allow");
    });
    await waitFor(() => expect(server.requestsTo("approval")).toHaveLength(1));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    releaseApproval();
    await letLateWorkFinish();

    expect(chat.result.current.busy).toBe(false);
    expect(chat.result.current.approvalPendingId).toBeNull();
    expect(server.resumed).toHaveLength(0);
    await expectFreeToSend(server, chat, "c2");
  });

  it("ответ на виджет прежнего чата пришёл после перехода — новый чат не застывает «занятым»", async () => {
    const server = fakeChatServer({ history: [question] });
    const chat = renderChatHook(server);
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    const releaseWidget = hold(server, "widget");
    act(() => {
      void chat.result.current.answerWidget("w1", { "выбрано": "Море" });
    });
    await waitFor(() => expect(server.requestsTo("widget")).toHaveLength(1));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    releaseWidget();
    await letLateWorkFinish();

    expect(chat.result.current.busy).toBe(false);
    expect(chat.result.current.widgetPendingId).toBeNull();
    expect(server.resumed).toHaveLength(0);
    await expectFreeToSend(server, chat, "c2");
  });

  it("A → B → A: подтверждение, отправленное в первый показ чата, не висит «в пути» во втором", async () => {
    const server = fakeChatServer({ history: [question] });
    const chat = renderChatHook(server);
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    const releaseApproval = hold(server, "approval");
    act(() => {
      void chat.result.current.respondToApproval("ap1", "allow");
    });
    await waitFor(() => expect(chat.result.current.approvalPendingId).toBe("ap1"));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    chat.rerender({ chatId: "c1" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    expect(chat.result.current.approvalPendingId).toBeNull();
    releaseApproval();
    await letLateWorkFinish();

    expect(chat.result.current.approvalPendingId).toBeNull();
    expect(chat.result.current.busy).toBe(false);
    // Тот же запрос в новом показе можно отправить снова: прежний не держит очередь подтверждений.
    act(() => {
      void chat.result.current.respondToApproval("ap1", "allow");
    });
    await waitFor(() => expect(server.requestsTo("approval")).toHaveLength(2));
  });

  it("сорвавшаяся замена голосовой фразы не переносит историю прежнего чата в новый", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    act(() => {
      chat.result.current.sendVoiceMessage("Так.");
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(chat.result.current.messages).toHaveLength(2));
    const releaseStop = hold(server, "stop");
    act(() => {
      void chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать.");
    });
    await waitFor(() => expect(server.requestsTo("stop")).toHaveLength(1));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    const firstChatReads = urlsTo(server, "history").filter((url) => url === "/api/chat/c1").length;
    // Прежний чат на сервере успел обрасти развилкой: в новом её быть не должно.
    server.state.forks = [{ messageId: "u1", siblingIds: ["u1", "u1b"] }];
    releaseStop();
    await letLateWorkFinish();

    expect(urlsTo(server, "history").filter((url) => url === "/api/chat/c1")).toHaveLength(firstChatReads);
    expect(chat.result.current.forks).toEqual([]);
    expect(server.requestsTo("edit")).toHaveLength(0);
  });

  it("A → B → A: замена, ждавшая в очереди первого показа, не останавливает и не правит чат во втором", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    act(() => {
      chat.result.current.sendVoiceMessage("Так.");
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const voiceMessage = chat.result.current.messages[0]!;
    server.streams[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(chat.result.current.messages).toHaveLength(2));
    const releaseStop = hold(server, "stop");
    act(() => {
      void chat.result.current.replaceLastVoiceMessage("Так. Дай-ка");
      void chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать.");
    });
    await waitFor(() => expect(server.requestsTo("stop")).toHaveLength(1));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    // Сервер сохранил голосовую фразу: во втором показе чата она снова последняя и без ответа.
    server.state.history = [voiceMessage as HistoryMessage];
    chat.rerender({ chatId: "c1" });
    await waitFor(() => expect(chat.result.current.messages.map((message) => message.id)).toEqual([voiceMessage.id]));
    releaseStop();
    await letLateWorkFinish();

    expect(server.requestsTo("stop")).toHaveLength(1);
    expect(server.requestsTo("edit")).toHaveLength(0);
    await expectFreeToSend(server, chat, "c1");
  });

  it("замена голосовой фразы в новом чате не ждёт, пока доделается замена прежнего", async () => {
    const server = fakeChatServer({});
    const chat = renderChatHook(server);
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    act(() => {
      chat.result.current.sendVoiceMessage("Так.");
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(chat.result.current.messages).toHaveLength(2));
    hold(server, "stop");
    act(() => {
      void chat.result.current.replaceLastVoiceMessage("Так. Дай-ка подумать.");
    });
    await waitFor(() => expect(urlsTo(server, "stop")).toEqual(["/api/chat/c1/stop"]));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    act(() => {
      chat.result.current.sendVoiceMessage("Ну.");
    });
    await waitFor(() => expect(server.streams).toHaveLength(2));
    server.streams[1]!.push({ type: "start", messageId: "b1" });
    await waitFor(() => expect(chat.result.current.messages).toHaveLength(2));
    act(() => {
      void chat.result.current.replaceLastVoiceMessage("Ну. Слушай.");
    });

    // «Стоп» прежнего чата всё ещё без ответа, а замена нового уже останавливает свой ответ.
    await waitFor(() => expect(urlsTo(server, "stop")).toEqual(["/api/chat/c1/stop", "/api/chat/c2/stop"]));
  });

  it("поправки прежнего чата передавались ходу — новый чат не застывает «занятым»", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const chat = renderChatHook(server, { steering: true });
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    const stream = server.resumed[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Начало" });
    await waitFor(() => expect(chat.result.current.messages).toHaveLength(2));
    const releaseSteer = hold(server, "steer");
    act(() => chat.result.current.setValue("Сделай синей"));
    act(() => {
      chat.result.current.submit();
    });
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    server.state.running = false;
    stream.finish("t");
    await waitFor(() => expect(chat.result.current.busy).toBe(true));

    chat.rerender({ chatId: "c2" });
    await waitFor(() => expect(chat.result.current.loaded).toBe(true));
    releaseSteer();
    await letLateWorkFinish();

    expect(chat.result.current.busy).toBe(false);
    await expectFreeToSend(server, chat, "c2");
  });
});
