// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentAppBridge, ScreenPlace } from "../../src/app-bridge/app-bridge";
import { renderChatHook } from "../support/chat-dom";
import { fakeChatServer } from "../support/fake-chat-server";
import type { HistoryMessage } from "../support/fake-chat-server";

afterEach(cleanup);

const question = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string, status = "complete"): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status },
});
const waitingForApproval: HistoryMessage[] = [
  question("u1", "Удали заметки"),
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "tool-delete_notes", toolCallId: "call-1", state: "approval-requested", input: {}, approval: { id: "ap1", requestReason: "always-offered" } },
    ],
    metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
  },
];

const cardOne: ScreenPlace = { description: "Карточка клиента «ООО Ромашка», id 42", data: { customerId: 42 } };
const cardTwo: ScreenPlace = { description: "Карточка клиента «ИП Лютик», id 43" };
/** Часовой пояс браузера: уходит с каждым запросом хода, по нему дата в запросе к модели. */
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Мост с местом, которое тест меняет по ходу. */
function bridgeWith(initial: ScreenPlace | null) {
  const current = { place: initial };
  const bridge: AgentAppBridge = {
    tabId: "tab-1",
    currentPlace: () => current.place,
    dataChanged: () => {},
    browserCall: async () => ({ error: "нет" }),
  };
  return { bridge, current };
}

async function loadedChat(server: ReturnType<typeof fakeChatServer>, bridge?: AgentAppBridge) {
  const hook = renderChatHook(server, bridge ? { appBridge: bridge } : {});
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

describe("useAgentChat с мостом: место и вкладка в телах запросов", () => {
  it("отправка: tabId и place; место берётся на момент запроса, а не при создании хука", async () => {
    const server = fakeChatServer();
    const { bridge, current } = bridgeWith(cardOne);
    const { result } = await loadedChat(server, bridge);

    act(() => result.current.setValue("добавь ему заметку"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(server.requestsTo("messages")[0]!.body).toMatchObject({ tabId: "tab-1", place: cardOne, timeZone });
    act(() => server.streams[0]!.answer("Готово"));
    await waitFor(() => expect(result.current.busy).toBe(false));

    current.place = cardTwo;
    act(() => result.current.setValue("а теперь тут"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(2));
    expect(server.requestsTo("messages")[1]!.body).toMatchObject({ tabId: "tab-1", place: cardTwo });
    act(() => server.streams[1]!.answer("Ок", "a2"));
  });

  it("места нет: уходит только tabId", async () => {
    const server = fakeChatServer();
    const { bridge } = bridgeWith(null);
    const { result } = await loadedChat(server, bridge);
    act(() => result.current.setValue("привет"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const body = server.requestsTo("messages")[0]!.body as Record<string, unknown>;
    expect(body.tabId).toBe("tab-1");
    expect(body).not.toHaveProperty("place");
    act(() => server.streams[0]!.answer("Ок"));
  });

  it("данные места не сериализуются (цикл): сообщение уходит, место — без data", async () => {
    const server = fakeChatServer();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const { bridge } = bridgeWith({ description: "Карточка с циклом", data: cyclic });
    const { result } = await loadedChat(server, bridge);
    act(() => result.current.setValue("привет"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const body = server.requestsTo("messages")[0]!.body as Record<string, unknown>;
    expect(body.place).toEqual({ description: "Карточка с циклом" });
    act(() => server.streams[0]!.answer("Ок"));
  });

  it("данные места с BigInt: сообщение уходит, место — без data", async () => {
    const server = fakeChatServer();
    const { bridge } = bridgeWith({ description: "Карточка с BigInt", data: { id: 1n } });
    const { result } = await loadedChat(server, bridge);
    act(() => result.current.setValue("привет"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const body = server.requestsTo("messages")[0]!.body as Record<string, unknown>;
    expect(body.place).toEqual({ description: "Карточка с BigInt" });
    act(() => server.streams[0]!.answer("Ок"));
  });

  it("без моста: ни tabId, ни place — только часовой пояс", async () => {
    const server = fakeChatServer();
    const { result } = await loadedChat(server);
    act(() => result.current.setValue("привет"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const body = server.requestsTo("messages")[0]!.body as Record<string, unknown>;
    expect(body).toEqual({ message: expect.anything(), timeZone });
    act(() => server.streams[0]!.answer("Ок"));
  });

  it("повтор после ошибки: tabId и place в теле /retry", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "", "error")] });
    const { bridge } = bridgeWith(cardOne);
    const { result } = await loadedChat(server, bridge);
    act(() => result.current.retry());
    await waitFor(() => expect(server.retries).toHaveLength(1));
    expect(server.requestsTo("retry")[0]!.body).toEqual({ tabId: "tab-1", place: cardOne, timeZone });
    act(() => server.retries[0]!.answer("Теперь ок", "a2"));
  });

  it("повтор без моста: в теле только часовой пояс", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "", "error")] });
    const { result } = await loadedChat(server);
    act(() => result.current.retry());
    await waitFor(() => expect(server.retries).toHaveLength(1));
    expect(server.requestsTo("retry")[0]!.body).toEqual({ timeZone });
    act(() => server.retries[0]!.answer("Теперь ок", "a2"));
  });

  it("переделка ответа: tabId и place в теле /regenerate", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Здравствуйте")] });
    const { bridge } = bridgeWith(cardTwo);
    const { result } = await loadedChat(server, bridge);
    act(() => result.current.regenerate());
    await waitFor(() => expect(server.regenerations).toHaveLength(1));
    expect(server.requestsTo("regenerate")[0]!.body).toEqual({ messageId: "a1", tabId: "tab-1", place: cardTwo, timeZone });
    act(() => server.regenerations[0]!.answer("Иначе", "a2"));
  });

  it("правка: tabId и place в теле /edit", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Здравствуйте")] });
    const { bridge } = bridgeWith(cardOne);
    const { result } = await loadedChat(server, bridge);
    let outcome: Promise<unknown> | undefined;
    act(() => {
      outcome = result.current.edit("u1", "Добрый день");
    });
    await waitFor(() => expect(server.edits).toHaveLength(1));
    expect(server.requestsTo("edit")[0]!.body).toMatchObject({ editedMessageId: "u1", tabId: "tab-1", place: cardOne, timeZone });
    act(() => server.edits[0]!.answer("Здравствуйте снова", "a2"));
    await outcome;
  });

  it("ответ на подтверждение: tabId и place в теле /approvals (продолжение берёт место оттуда)", async () => {
    const server = fakeChatServer({ history: waitingForApproval });
    const { bridge } = bridgeWith(cardTwo);
    const { result } = await loadedChat(server, bridge);
    await act(() => result.current.respondToApproval("ap1", "allow"));
    expect(server.requestsTo("approval")[0]!.body).toEqual({ decision: "allow", tabId: "tab-1", place: cardTwo, timeZone });
  });

  it("ответ на подтверждение без моста: решение и часовой пояс", async () => {
    const server = fakeChatServer({ history: waitingForApproval });
    const { result } = await loadedChat(server);
    await act(() => result.current.respondToApproval("ap1", "allow"));
    expect(server.requestsTo("approval")[0]!.body).toEqual({ decision: "allow", timeZone });
  });
});
