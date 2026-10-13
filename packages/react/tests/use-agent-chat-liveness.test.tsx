// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messageText } from "../src/chat-types";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HEARTBEAT_MS = 10_000;
const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Расскажи подробно" }] };

type Server = ReturnType<typeof fakeChatServer>;
type Chat = ReturnType<typeof renderChatHook>;

/** Даёт отработать промисам и, если нужно, подвигает часы. */
async function settle(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const lastMessage = (chat: Chat) => chat.result.current.messages.at(-1);
const lastText = (chat: Chat) => messageText(lastMessage(chat)!);
const answers = (chat: Chat) => chat.result.current.messages.filter((message) => message.role === "assistant");

/** Открывает чат, отправляет вопрос и присылает начало ответа. */
async function startAnswer(server: Server, chat: Chat) {
  await settle();
  act(() => chat.result.current.setValue("Расскажи подробно"));
  act(() => chat.result.current.submit());
  await settle();
  expect(server.streams).toHaveLength(1);
  const stream = server.streams[0]!;
  stream.push({ type: "start", messageId: "a1" });
  stream.push({ type: "text-start", id: "t" });
  stream.push({ type: "text-delta", id: "t", delta: "Часть ответа" });
  await settle();
  expect(lastText(chat)).toBe("Часть ответа");
  return stream;
}

/** Вопрос, каким его видит сервер после того, как получил. */
function askedQuestion(server: Server): HistoryMessage {
  const id = (server.requestsTo("messages")[0]?.body as { message: { id: string } }).message.id;
  return { id, role: "user", parts: [{ type: "text", text: "Расскажи подробно" }] };
}

/** Сервер ведёт ход заново и отдаёт его с начала, как реестр идущих ответов. */
const replayWhole = (server: Server) => server.resumed[0]!.answer("Часть ответа и конец");

describe("useAgentChat: живая связь", () => {
  it("(1) тишина 30 с посреди ответа: переподключение, написанное на месте, потом текст равен серверному без повторов", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    await startAnswer(server, chat);
    // Сервер ведёт ход дальше, но связь вкладки застыла; история пока не отвечает.
    server.state.running = true;
    server.state.history = [askedQuestion(server)];
    server.state.hang.add("history");
    const requestsBefore = server.requestsTo("history").length;

    await settle(29_000);
    expect(chat.result.current.connection).toBe("online");
    expect(server.requestsTo("history")).toHaveLength(requestsBefore);
    await settle(3_000);
    // SC-005: зависание замечено не позже чем через 30 ± 2 с, попытка уже пошла.
    expect(server.requestsTo("history")).toHaveLength(requestsBefore + 1);
    expect(chat.result.current.connection).toBe("reconnecting");
    expect(chat.result.current.busy).toBe(true);
    expect(lastText(chat)).toBe("Часть ответа");
    expect(lastMessage(chat)?.metadata?.status).not.toBe("interrupted");

    server.state.hang.delete("history");
    await settle(15_000);
    expect(server.resumed).toHaveLength(1);
    replayWhole(server);
    await settle();
    expect(chat.result.current.connection).toBe("online");
    expect(answers(chat)).toHaveLength(1);
    expect(lastText(chat)).toBe("Часть ответа и конец");
    expect(lastMessage(chat)?.metadata?.status).toBe("complete");
    expect(chat.result.current.busy).toBe(false);
  });

  it("(2) сетевой обрыв посреди ответа с инструментом в input-streaming: после подключения частей не вдвое больше", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    const stream = await startAnswer(server, chat);
    stream.push({ type: "tool-input-start", toolCallId: "call1", toolName: "lookup" });
    stream.push({ type: "tool-input-delta", toolCallId: "call1", inputTextDelta: '{"q":' });
    await settle();
    server.state.running = true;
    server.state.history = [askedQuestion(server)];
    act(() => stream.break());
    await settle(100);
    expect(server.resumed).toHaveLength(1);

    const resumed = server.resumed[0]!;
    resumed.push({ type: "start", messageId: "a1" });
    resumed.push({ type: "tool-input-start", toolCallId: "call1", toolName: "lookup" });
    resumed.push({ type: "tool-input-available", toolCallId: "call1", toolName: "lookup", input: { q: "x" } });
    resumed.push({ type: "tool-output-available", toolCallId: "call1", output: "готово" });
    resumed.push({ type: "text-start", id: "t" });
    resumed.push({ type: "text-delta", id: "t", delta: "Итог" });
    resumed.finish();
    await settle();

    expect(answers(chat)).toHaveLength(1);
    const parts = answers(chat)[0]!.parts;
    expect(parts.filter((part) => part.type === "tool-lookup")).toHaveLength(1);
    expect(parts.filter((part) => part.type === "text")).toHaveLength(1);
    expect(lastText(chat)).toBe("Итог");
    expect(chat.result.current.connection).toBe("online");
  });

  it("(3) отказ соединений: три попытки, потом offline; последний ответ прерван; retry() перечитывает и подключается", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    const stream = await startAnswer(server, chat);
    server.state.down = true;
    const before = server.requests.length;
    act(() => stream.break());
    await settle(100);
    expect(chat.result.current.connection).toBe("reconnecting");
    expect(chat.result.current.busy).toBe(true);

    // Паузы 0, 2000 и 5000 мс отсчитываются от обрыва: попытки в 0, 2000 и 7000 мс.
    await settle(1_800);
    expect(server.requests.length - before).toBe(1);
    await settle(200);
    expect(server.requests.length - before).toBe(2);
    await settle(4_800);
    expect(chat.result.current.connection).toBe("reconnecting");
    await settle(300);
    expect(server.requests.length - before).toBe(3);
    expect(chat.result.current.connection).toBe("offline");
    expect(chat.result.current.busy).toBe(false);
    expect(chat.result.current.canRetry).toBe(false);
    expect(lastMessage(chat)?.metadata?.status).toBe("interrupted");
    expect(lastText(chat)).toBe("Часть ответа");

    server.state.down = false;
    server.state.running = true;
    server.state.history = [askedQuestion(server)];
    act(() => chat.result.current.retry());
    await settle(100);
    expect(server.resumed).toHaveLength(1);
    replayWhole(server);
    await settle();
    expect(chat.result.current.connection).toBe("online");
    expect(lastText(chat)).toBe("Часть ответа и конец");
    expect(answers(chat)).toHaveLength(1);
  });

  it("«Нет связи с сервером»: подписка на события чата, открывшись снова, к ходу сама не подключается — это делает «Повторить»", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    server.state.watch = true;
    const chat = renderChatHook(server);
    const stream = await startAnswer(server, chat);
    server.state.down = true;
    act(() => stream.break());
    await settle(8_000);
    expect(chat.result.current.connection).toBe("offline");

    // Сервер снова на связи и ведёт ход: подписка открывается, но плашка и «Повторить» остаются на месте.
    server.state.down = false;
    server.state.running = true;
    server.state.history = [askedQuestion(server)];
    const watchesBefore = server.watches.length;
    await settle(10_000);
    expect(server.watches.length).toBeGreaterThan(watchesBefore);
    expect(server.resumed).toHaveLength(0);
    expect(chat.result.current.connection).toBe("offline");
    expect(lastMessage(chat)?.metadata?.status).toBe("interrupted");

    act(() => chat.result.current.retry());
    await settle(100);
    expect(server.resumed).toHaveLength(1);
  });

  it("(4) ход закончился, пока связи не было: после возвращения ответ показан готовым, без подключения", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    const stream = await startAnswer(server, chat);
    server.state.down = true;
    act(() => stream.break());
    await settle(8_000);
    expect(chat.result.current.connection).toBe("offline");

    server.state.down = false;
    server.state.running = false;
    server.state.history = [
      askedQuestion(server),
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Готовый ответ", state: "done" }],
        metadata: { status: "complete" },
      },
    ];
    act(() => chat.result.current.retry());
    await settle(100);
    expect(server.requestsTo("stream").length).toBe(0);
    expect(lastText(chat)).toBe("Готовый ответ");
    expect(lastMessage(chat)?.metadata?.status).toBe("complete");
    expect(chat.result.current.connection).toBe("online");
    expect(chat.result.current.busy).toBe(false);
  });

  describe("(5) в offline вкладка сама пробует снова", () => {
    async function goOffline() {
      const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
      const chat = renderChatHook(server);
      const stream = await startAnswer(server, chat);
      server.state.down = true;
      act(() => stream.break());
      await settle(8_000);
      expect(chat.result.current.connection).toBe("offline");
      server.state.down = false;
      server.state.running = true;
      server.state.history = [askedQuestion(server)];
      return { server, chat };
    }

    it.each([
      ["событие online", () => window.dispatchEvent(new Event("online"))],
      ["вкладка снова видна", () => document.dispatchEvent(new Event("visibilitychange"))],
    ])("%s запускает новую серию без нажатия", async (_, wake) => {
      const { server, chat } = await goOffline();
      act(() => {
        wake();
      });
      await settle(100);
      expect(server.resumed).toHaveLength(1);
      expect(chat.result.current.connection).toBe("online");
    });
  });

  it("(6) «стоп» во время попыток: серия отменена, ушёл POST stop, ответ остановлен", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    await startAnswer(server, chat);
    server.state.running = true;
    server.state.history = [askedQuestion(server)];
    server.state.hang.add("history");
    await settle(32_000);
    expect(chat.result.current.connection).toBe("reconnecting");
    const historyBefore = server.requestsTo("history").length;

    await act(async () => {
      const stopping = chat.result.current.stop();
      await vi.advanceTimersByTimeAsync(50);
      await stopping;
    });
    expect(server.requestsTo("stop")).toHaveLength(1);
    expect(chat.result.current.connection).toBe("online");
    expect(chat.result.current.busy).toBe(false);
    expect(lastMessage(chat)?.metadata?.status).toBe("stopped");
    expect(lastText(chat)).toBe("Часть ответа");

    await settle(60_000);
    expect(server.requestsTo("history")).toHaveLength(historyBefore);
    expect(chat.result.current.connection).toBe("online");
  });

  it("смена chatId во время серии: старая серия отменена, связь online, к старому чату запросов больше нет", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    const stream = await startAnswer(server, chat);
    server.state.down = true;
    act(() => stream.break());
    await settle(100);
    expect(chat.result.current.connection).toBe("reconnecting");

    server.state.down = false;
    const before = server.requests.length;
    chat.rerender({ chatId: "c2" });
    expect(chat.result.current.connection).toBe("online");
    expect(chat.result.current.busy).toBe(false);
    await settle(20_000);
    expect(server.requests.slice(before).filter((request) => request.url.includes("/c1"))).toEqual([]);
    expect(chat.result.current.connection).toBe("online");
    expect(chat.result.current.loaded).toBe(true);
  });

  it("тихая первая попытка после отказа сервера (5xx): пока она идёт, отправить нельзя", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    await settle();
    server.state.fail.add("messages");
    server.state.hang.add("history");
    act(() => chat.result.current.setValue("Первый вопрос"));
    act(() => chat.result.current.submit());
    await settle(50);
    expect(server.requestsTo("messages")).toHaveLength(1);
    // Связь есть (сервер ответил), но попытка идёт: лента ещё вернётся к истории сервера.
    expect(chat.result.current.connection).toBe("online");
    expect(chat.result.current.busy).toBe(true);

    act(() => chat.result.current.setValue("Второй вопрос"));
    expect(chat.result.current.canSubmit).toBe(false);
    act(() => chat.result.current.submit());
    await settle(50);
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("двойной «стоп»: один POST /stop", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    await startAnswer(server, chat);
    await act(async () => {
      const first = chat.result.current.stop();
      const second = chat.result.current.stop();
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all([first, second]);
    });
    expect(server.requestsTo("stop")).toHaveLength(1);
    expect(lastMessage(chat)?.metadata?.status).toBe("stopped");
  });

  describe("(7) история при открытии", () => {
    it("зависла — offline через 10 с, а не loadFailed", async () => {
      const server = fakeChatServer({ history: [question] });
      server.state.hang.add("history");
      const chat = renderChatHook(server);
      await settle(9_900);
      expect(chat.result.current.connection).toBe("online");
      await settle(200);
      expect(chat.result.current.connection).toBe("offline");
      expect(chat.result.current.loaded).toBe(false);
      expect(chat.result.current.loadFailed).toBe(false);
    });

    it("сервер не отвечает по сети — offline, «повторить» загружает чат", async () => {
      const server = fakeChatServer({ history: [question] });
      server.state.down = true;
      const chat = renderChatHook(server);
      await settle(50);
      expect(chat.result.current.connection).toBe("offline");
      expect(chat.result.current.loadFailed).toBe(false);

      server.state.down = false;
      act(() => chat.result.current.retry());
      await settle(50);
      expect(chat.result.current.loaded).toBe(true);
      expect(chat.result.current.connection).toBe("online");
      expect(chat.result.current.messages).toHaveLength(1);
    });

    it("сервер ответил 5xx — как в 001: loadFailed, связь online", async () => {
      const server = fakeChatServer({ history: [question] });
      server.state.fail.add("history");
      const chat = renderChatHook(server);
      await settle(50);
      expect(chat.result.current.loadFailed).toBe(true);
      expect(chat.result.current.connection).toBe("online");
    });
  });

  it("(8) «стоп» зависает — через 10 с ответ во вкладке «Остановлено»", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    await startAnswer(server, chat);
    server.state.hang.add("stop");
    let stopped = false;
    act(() => {
      void chat.result.current.stop().then(() => {
        stopped = true;
      });
    });
    await settle(9_900);
    expect(stopped).toBe(false);
    await settle(200);
    expect(stopped).toBe(true);
    expect(lastMessage(chat)?.metadata?.status).toBe("stopped");
    expect(lastText(chat)).toBe("Часть ответа");
    expect(chat.result.current.busy).toBe(false);
  });

  describe("(9) отправка и повтор без ответа сервера", () => {
    it("сообщение не дошло (по истории его нет) — сообщение об ошибке, retry() шлёт его заново с тем же id", async () => {
      const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
      const chat = renderChatHook(server);
      await settle();
      server.state.hang.add("messages");
      act(() => chat.result.current.setValue("Расскажи подробно"));
      act(() => chat.result.current.submit());
      await settle(9_900);
      expect(server.requestsTo("messages")).toHaveLength(1);
      expect(chat.result.current.sendFailed).toBe(false);
      await settle(500);
      expect(chat.result.current.sendFailed).toBe(true);
      expect(chat.result.current.connection).toBe("online");
      expect(chat.result.current.busy).toBe(false);

      server.state.hang.delete("messages");
      act(() => chat.result.current.retry());
      await settle(50);
      expect(server.requestsTo("messages")).toHaveLength(2);
      const ids = server.requestsTo("messages").map((request) => (request.body as { message: { id: string } }).message.id);
      expect(ids[1]).toBe(ids[0]);
      expect(chat.result.current.sendFailed).toBe(false);
    });

    it("сообщение дошло (по истории оно есть) — вкладка подключается к идущему ответу", async () => {
      const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
      const chat = renderChatHook(server);
      await settle();
      server.state.hang.add("messages");
      act(() => chat.result.current.setValue("Расскажи подробно"));
      act(() => chat.result.current.submit());
      await settle(50);
      server.state.running = true;
      server.state.history = [askedQuestion(server)];
      await settle(10_500);
      expect(server.resumed).toHaveLength(1);
      expect(chat.result.current.sendFailed).toBe(false);
      replayWhole(server);
      await settle();
      expect(lastText(chat)).toBe("Часть ответа и конец");
      expect(chat.result.current.connection).toBe("online");
      expect(chat.result.current.messages.filter((message) => message.role === "user")).toHaveLength(1);
    });

    it("POST retry без ответа 10 с — по истории: прежний ответ на месте, связь есть", async () => {
      const server = fakeChatServer({
        heartbeatMs: HEARTBEAT_MS,
        history: [question, { id: "a0", role: "assistant", parts: [], metadata: { status: "error", error: { kind: "other" } } }],
      });
      const chat = renderChatHook(server);
      await settle();
      server.state.hang.add("retry");
      act(() => chat.result.current.retry());
      await settle(9_900);
      expect(server.requestsTo("retry")).toHaveLength(1);
      await settle(500);
      expect(chat.result.current.connection).toBe("online");
      expect(chat.result.current.busy).toBe(false);
      expect(lastMessage(chat)?.id).toBe("a0");
      expect(lastMessage(chat)?.metadata?.status).toBe("error");
    });
  });

  it("(9a) связь замолчала до первого куска (был только пинг) — переподключение так же, как посреди ответа", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    await settle();
    act(() => chat.result.current.setValue("Расскажи подробно"));
    act(() => chat.result.current.submit());
    await settle();
    expect(server.streams).toHaveLength(1);
    server.state.running = true;
    server.state.history = [askedQuestion(server)];
    const requestsBefore = server.requestsTo("history").length;

    await settle(29_000);
    expect(server.requestsTo("history")).toHaveLength(requestsBefore);
    await settle(3_000);
    expect(server.requestsTo("history")).toHaveLength(requestsBefore + 1);
    expect(server.resumed).toHaveLength(1);
    replayWhole(server);
    await settle();
    expect(lastText(chat)).toBe("Часть ответа и конец");
    expect(chat.result.current.connection).toBe("online");
  });

  it("(10) пинги 70 с посреди ответа без кусков: ни одного запроса к …/stream", async () => {
    const server = fakeChatServer({ heartbeatMs: HEARTBEAT_MS, resumable: true });
    const chat = renderChatHook(server);
    const stream = await startAnswer(server, chat);
    for (let i = 0; i < 7; i++) {
      await settle(HEARTBEAT_MS);
      act(() => stream.ping());
    }
    await settle(50);
    expect(server.requestsTo("stream").length).toBe(0);
    expect(chat.result.current.connection).toBe("online");
    expect(chat.result.current.busy).toBe(true);

    stream.push({ type: "text-delta", id: "t", delta: " и конец" });
    stream.finish();
    await settle();
    expect(lastText(chat)).toBe("Часть ответа и конец");
    expect(lastMessage(chat)?.metadata?.status).toBe("complete");
    expect(server.requestsTo("stream").length).toBe(0);
  });

  it("срок тишины не меньше трёх пингов сервера: при пинге раз в 20 с 30 с тишины ещё терпим", async () => {
    const server = fakeChatServer({ heartbeatMs: 20_000, resumable: true });
    const chat = renderChatHook(server);
    await startAnswer(server, chat);
    await settle(45_000);
    expect(chat.result.current.connection).toBe("online");
    expect(server.requestsTo("history")).toHaveLength(1);
    server.state.hang.add("history");
    await settle(20_000);
    expect(chat.result.current.connection).toBe("reconnecting");
  });

  it("настройки liveness: свои паузы попыток и срок тишины", async () => {
    const server = fakeChatServer({ heartbeatMs: 1_000, resumable: true });
    const chat = renderChatHook(server, {
      liveness: { silenceTimeoutMs: 5_000, reconnectDelaysMs: [0, 100], requestTimeoutMs: 2_000 },
    });
    const stream = await startAnswer(server, chat);
    server.state.down = true;
    act(() => stream.break());
    await settle(500);
    expect(chat.result.current.connection).toBe("offline");
  });
});
