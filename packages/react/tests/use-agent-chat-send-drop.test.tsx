// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { messageText } from "../src/chat-types";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";

afterEach(cleanup);

/*
 * Обрыв отправки: шлюз ответил 502 (приложение за ним перезапускается) или связь порвалась. Сервер сообщения не получил:
 * оно остаётся в ленте, «Повторить» отправляет его с тем же id. Подписка на события чата включена, как у настоящего
 * сервера: открываясь после сбоя, она перечитывает историю, и сообщения в ней нет.
 */

const TEXT = "Длинное описание идеи, которое жалко набирать заново";
const GATEWAY_PAGE = "<html><body>502 Bad Gateway</body></html>";
const answer = (id = "a1", text = "Ответ"): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status: "complete" },
});

type Server = ReturnType<typeof fakeChatServer>;
type Chat = ReturnType<typeof renderChatHook>;

/** Новый чат на сервере с подпиской; вкладка загрузила историю и открыла подписку. `gateway` — что стоит между ними. */
async function openChat(gateway?: (server: Server) => typeof fetch) {
  const server = fakeChatServer({ resumable: true });
  server.state.watch = true;
  const chat = renderChatHook(server, gateway ? { fetch: gateway(server) } : {});
  await waitFor(() => expect(server.watches).toHaveLength(1));
  return { server, chat };
}

const breakSending = {
  "шлюз ответил 502": (server: Server) => {
    server.state.refuse.messages = { status: 502, kind: "", html: GATEWAY_PAGE };
  },
  "связь порвалась": (server: Server) => {
    server.state.drop.add("messages");
  },
};

function repairSending(server: Server) {
  delete server.state.refuse.messages;
  server.state.drop.delete("messages");
}

function send(chat: Chat, text = TEXT) {
  act(() => chat.result.current.setValue(text));
  act(() => {
    chat.result.current.submit();
  });
}

/** Сообщение, каким его видит сервер после того, как получил. */
function sentMessage(server: Server, index = 0): HistoryMessage {
  const { message } = server.requestsTo("messages")[index]!.body as { message: HistoryMessage };
  return { id: message.id, role: "user", parts: message.parts };
}

const sentIds = (server: Server) => server.requestsTo("messages").map((request) => (request.body as { message: { id: string } }).message.id);
const userTexts = (chat: Chat) => chat.result.current.messages.filter((message) => message.role === "user").map((message) => messageText(message));
const feedIds = (chat: Chat) => chat.result.current.messages.map((message) => message.id);

/** Отправка сорвалась, а подписка после сбоя открылась заново и перечитала историю сервера. */
async function failedAndRefreshed(server: Server, chat: Chat) {
  await waitFor(() => expect(chat.result.current.sendFailed).toBe(true));
  await waitFor(() => expect(server.watches.length).toBeGreaterThanOrEqual(2));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("useAgentChat: обрыв отправки", () => {
  for (const [failure, breakIt] of Object.entries(breakSending)) {
    it(`${failure}: сообщение остаётся в ленте, «Повторить» шлёт его с тем же id, в ленте и на сервере оно одно`, async () => {
      const { server, chat } = await openChat();
      breakIt(server);
      send(chat);
      await failedAndRefreshed(server, chat);
      expect(userTexts(chat)).toEqual([TEXT]);
      expect(chat.result.current.busy).toBe(false);

      repairSending(server);
      act(() => chat.result.current.retry());
      await waitFor(() => expect(server.streams).toHaveLength(1));
      const ids = sentIds(server);
      expect(ids).toHaveLength(2);
      expect(ids[1]).toBe(ids[0]);
      expect(chat.result.current.sendFailed).toBe(false);

      // Сервер записал сообщение и ответ; подписка после хода перечитывает историю — дублей нет.
      server.state.history = [sentMessage(server, 1), answer()];
      const watchesBefore = server.watches.length;
      server.streams[0]!.answer("Ответ", "a1");
      await waitFor(() => expect(chat.result.current.busy).toBe(false));
      await waitFor(() => expect(server.watches.length).toBeGreaterThan(watchesBefore));
      await waitFor(() => expect(feedIds(chat)).toEqual([ids[0], "a1"]));
      expect(userTexts(chat)).toEqual([TEXT]);
    });
  }

  it("сервер принял сообщение, а ответ не дошёл (502 от шлюза): вкладка подключается к ходу, повтора нет, сообщение одно", async () => {
    // Шлюз отдал 502, хотя приложение за ним уже записало сообщение и ведёт ход.
    const acceptedBehindGateway = (server: Server) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await server.fetch(input, init);
        if (!String(input).endsWith("/messages") || init?.method !== "POST") return response;
        server.state.history = [sentMessage(server)];
        server.state.running = true;
        return new Response(GATEWAY_PAGE, { status: 502, headers: { "content-type": "text/html" } });
      }) as typeof fetch;
    const { server, chat } = await openChat(acceptedBehindGateway);
    send(chat);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    server.state.running = false;
    server.state.history = [sentMessage(server), answer()];
    server.resumed[0]!.answer("Ответ", "a1");
    await waitFor(() => expect(chat.result.current.busy).toBe(false));
    expect(chat.result.current.sendFailed).toBe(false);
    expect(sentIds(server)).toHaveLength(1);
    await waitFor(() => expect(feedIds(chat)).toEqual([sentIds(server)[0], "a1"]));
  });

  it("сервер успел записать сообщение позже, чем вкладка проверила историю: повтор получает 409, в ленте одно сообщение и ответ", async () => {
    const { server, chat } = await openChat();
    breakSending["шлюз ответил 502"](server);
    send(chat);
    await failedAndRefreshed(server, chat);

    // Сообщение всё-таки дошло и ответ готов; повтор того же id сервер отклоняет без второго ответа.
    server.state.history = [sentMessage(server), answer()];
    server.state.refuse.messages = { status: 409, kind: "invalid" };
    act(() => chat.result.current.retry());
    await waitFor(() => expect(feedIds(chat)).toEqual([sentIds(server)[0], "a1"]));
    expect(sentIds(server)).toEqual([sentIds(server)[0], sentIds(server)[0]]);
    expect(chat.result.current.sendFailed).toBe(false);
    expect(userTexts(chat)).toEqual([TEXT]);
  });

  it("вместо «Повторить» человек пишет новое: не дошедшее сообщение не всплывает потом в конце ленты", async () => {
    const { server, chat } = await openChat();
    breakSending["связь порвалась"](server);
    send(chat);
    await failedAndRefreshed(server, chat);

    repairSending(server);
    send(chat, "Другой вопрос");
    await waitFor(() => expect(server.streams).toHaveLength(1));
    server.state.history = [sentMessage(server, 1), answer()];
    const watchesBefore = server.watches.length;
    server.streams[0]!.answer("Ответ", "a1");
    await waitFor(() => expect(chat.result.current.busy).toBe(false));
    await waitFor(() => expect(server.watches.length).toBeGreaterThan(watchesBefore));
    await waitFor(() => expect(feedIds(chat)).toEqual([sentIds(server)[1], "a1"]));
  });
});
