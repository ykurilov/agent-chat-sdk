// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppBridge } from "../../src/app-bridge/create-app-bridge";
import type { AgentAppBridge, BrowserToolFunction } from "../../src/app-bridge/app-bridge";
import { BROWSER_CALLS_DONE_KEY } from "../../src/app-bridge/browser-calls";
import { fakeChatServer } from "../support/fake-chat-server";
import { renderChatHook, setupChatDom } from "../support/chat-dom";

setupChatDom();
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const unavailable = "Инструмент недоступен на этой странице";
const callPart = (toolCallId: string, toolName: string, input: unknown, tabId = "tab-1") => ({
  type: "data-browser-call",
  id: toolCallId,
  data: { toolCallId, toolName, input, tabId },
  transient: true,
});

/** Мост с настоящим исполнением функций и номером вкладки `tab-1`. */
function bridgeWith(browserTools: Record<string, BrowserToolFunction>): AgentAppBridge {
  const { bridge } = createAppBridge(() => ({ browserTools, toolUnavailableMessage: unavailable }));
  return { ...bridge, tabId: "tab-1" };
}

/** Хук чата `chatId` с мостом, отправленное сообщение и открытый поток ответа. */
async function answering(bridge: AgentAppBridge, server = fakeChatServer(), chatId = "c1") {
  const hook = renderChatHook(server, { appBridge: bridge });
  if (chatId !== "c1") hook.rerender({ chatId });
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setValue("открой задачу 2"));
  act(() => void hook.result.current.submit());
  await waitFor(() => expect(server.streams).toHaveLength(1));
  const stream = server.streams[0]!;
  act(() => stream.push({ type: "start", messageId: "a1" }));
  return { ...hook, server, stream };
}

const answers = (server: ReturnType<typeof fakeChatServer>) => server.requestsTo("browserCall");

describe("useAgentChat: браузерный вызов из потока (FR-020, FR-021)", () => {
  it("свой tabId — функция с входом и сигналом, результат уходит на адрес вызова; в сообщение кусок не попадает", async () => {
    const openTask = vi.fn(async (input: { taskId: number }, _context: { signal: AbortSignal }) => ({ opened: input.taskId }));
    const { server, stream, result } = await answering(bridgeWith({ open_task: openTask }));
    act(() => stream.push(callPart("call-1", "open_task", { taskId: 2 })));
    await waitFor(() => expect(answers(server)).toHaveLength(1));
    expect(openTask).toHaveBeenCalledTimes(1);
    expect(openTask.mock.calls[0]![0]).toEqual({ taskId: 2 });
    expect(openTask.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(answers(server)[0]).toMatchObject({ method: "POST", url: "/api/chat/c1/browser-tools/call-1", body: { tabId: "tab-1", output: { opened: 2 } } });
    act(() => stream.finish());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(JSON.stringify(result.current.messages)).not.toContain("data-browser-call");
  });

  it("функция ничего не вернула — уходит output: null (сервер скажет модели «готово»)", async () => {
    const { server, stream } = await answering(bridgeWith({ open_task: () => undefined }));
    act(() => stream.push(callPart("call-1", "open_task", { taskId: 2 })));
    await waitFor(() => expect(answers(server)).toHaveLength(1));
    expect(answers(server)[0]!.body).toEqual({ tabId: "tab-1", output: null });
    act(() => stream.finish());
  });

  it("чужой tabId — пропуск: функция не вызвана, ответа нет", async () => {
    const openTask = vi.fn(() => "открыла");
    const { server, stream } = await answering(bridgeWith({ open_task: openTask }));
    act(() => stream.push(callPart("call-1", "open_task", { taskId: 2 }, "tab-other")));
    act(() => stream.push(callPart("call-2", "open_task", { taskId: 3 })));
    await waitFor(() => expect(answers(server)).toHaveLength(1));
    expect(openTask).toHaveBeenCalledTimes(1);
    expect(answers(server)[0]!.url).toContain("call-2");
    act(() => stream.finish());
  });

  it("исполненный вызов не исполняется второй раз: ни повтором куска, ни после перезагрузки вкладки (sessionStorage)", async () => {
    const openTask = vi.fn(() => "открыла");
    const first = await answering(bridgeWith({ open_task: openTask }));
    act(() => first.stream.push(callPart("call-1", "open_task", { taskId: 2 })));
    act(() => first.stream.push(callPart("call-1", "open_task", { taskId: 2 })));
    await waitFor(() => expect(answers(first.server)).toHaveLength(1));
    expect(JSON.parse(sessionStorage.getItem(BROWSER_CALLS_DONE_KEY)!)).toHaveLength(1);
    act(() => first.stream.finish());
    first.unmount();

    // «Перезагрузка»: новый хук, реестр сервера повторяет куски хода с начала.
    const second = await answering(bridgeWith({ open_task: openTask }));
    act(() => second.stream.push(callPart("call-1", "open_task", { taskId: 2 })));
    act(() => second.stream.push(callPart("call-9", "open_task", { taskId: 9 })));
    await waitFor(() => expect(answers(second.server)).toHaveLength(1));
    expect(answers(second.server)[0]!.url).toContain("call-9");
    expect(openTask).toHaveBeenCalledTimes(2);
    act(() => second.stream.finish());
  });

  it("помнит не больше 100 последних вызовов", async () => {
    const openTask = vi.fn(() => "ок");
    const { server, stream } = await answering(bridgeWith({ open_task: openTask }));
    act(() => {
      for (let index = 0; index <= 100; index += 1) stream.push(callPart(`call-${index}`, "open_task", {}));
    });
    await waitFor(() => expect(answers(server)).toHaveLength(101));
    expect(JSON.parse(sessionStorage.getItem(BROWSER_CALLS_DONE_KEY)!)).toHaveLength(100);
    // Самый старый забыт, последний помнится.
    act(() => stream.push(callPart("call-0", "open_task", {})));
    act(() => stream.push(callPart("call-100", "open_task", {})));
    await waitFor(() => expect(answers(server)).toHaveLength(102));
    expect(answers(server).at(-1)!.url).toContain("/call-0");
    act(() => stream.finish());
  });

  it("один номер вызова в двух чатах одной вкладки — исполняются оба", async () => {
    const openTask = vi.fn(() => "открыла");
    const first = await answering(bridgeWith({ open_task: openTask }));
    act(() => first.stream.push(callPart("call-1", "open_task", { taskId: 1 })));
    await waitFor(() => expect(answers(first.server)).toHaveLength(1));
    act(() => first.stream.finish());
    first.unmount();

    const second = await answering(bridgeWith({ open_task: openTask }), fakeChatServer(), "c2");
    act(() => second.stream.push(callPart("call-1", "open_task", { taskId: 2 })));
    await waitFor(() => expect(answers(second.server)).toHaveLength(1));
    expect(answers(second.server)[0]!.url).toBe("/api/chat/c2/browser-tools/call-1");
    expect(openTask).toHaveBeenCalledTimes(2);
    act(() => second.stream.finish());
  });

  it("нет функции — ответ «Инструмент недоступен на этой странице»; брошенная ошибка — её текст", async () => {
    const { server, stream } = await answering(
      bridgeWith({
        fail: () => {
          throw new Error("Задачи 9 нет");
        },
      }),
    );
    act(() => stream.push(callPart("call-1", "open_task", { taskId: 2 })));
    act(() => stream.push(callPart("call-2", "fail", {})));
    await waitFor(() => expect(answers(server)).toHaveLength(2));
    expect(answers(server).map((request) => request.body)).toEqual([
      { tabId: "tab-1", error: unavailable },
      { tabId: "tab-1", error: "Задачи 9 нет" },
    ]);
    act(() => stream.finish());
  });

  it("результат не переводится в JSON — уходит ошибка, а не сбой отправки", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { server, stream } = await answering(bridgeWith({ open_task: () => circular }));
    act(() => stream.push(callPart("call-1", "open_task", {})));
    await waitFor(() => expect(answers(server)).toHaveLength(1));
    expect(answers(server)[0]!.body).toMatchObject({ tabId: "tab-1", error: expect.any(String) });
    act(() => stream.finish());
  });

  it("409 not_pending на ответ — тихо: чат без ошибки, ответ дописывается", async () => {
    const server = fakeChatServer();
    server.state.browserCall = { status: 409, kind: "not_pending" };
    const { stream, result } = await answering(bridgeWith({ open_task: () => "поздно" }), server);
    act(() => stream.push(callPart("call-1", "open_task", {})));
    await waitFor(() => expect(answers(server)).toHaveLength(1));
    act(() => {
      stream.push({ type: "text-start", id: "t" });
      stream.push({ type: "text-delta", id: "t", delta: "Страница не ответила" });
      stream.finish();
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.sendFailed).toBe(false);
    expect(result.current.connection).toBe("online");
    expect(JSON.stringify(result.current.messages)).toContain("Страница не ответила");
  });

  it("исполнение не по onToolCall: вызов инструмента в потоке (до решения человека) функцию не зовёт", async () => {
    const openTask = vi.fn(() => "открыла");
    const { server, stream } = await answering(bridgeWith({ open_task: openTask }));
    act(() => {
      stream.push({ type: "tool-input-start", toolCallId: "call-1", toolName: "open_task" });
      stream.push({ type: "tool-input-available", toolCallId: "call-1", toolName: "open_task", input: { taskId: 2 } });
      stream.push({ type: "tool-approval-request", approvalId: "ap-1", toolCallId: "call-1" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(openTask).not.toHaveBeenCalled();
    expect(answers(server)).toHaveLength(0);
    act(() => stream.finish());
  });

  it("«стоп» обрывает сигнал идущей функции", async () => {
    let signal: AbortSignal | undefined;
    const { stream, result } = await answering(
      bridgeWith({
        open_task: (_input, context) => {
          signal = context.signal;
          return new Promise(() => {});
        },
      }),
    );
    act(() => stream.push(callPart("call-1", "open_task", {})));
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal!.aborted).toBe(false);
    await act(async () => {
      await result.current.stop();
    });
    expect(signal!.aborted).toBe(true);
  });

  it("без моста кусок молча пропускается", async () => {
    const server = fakeChatServer();
    const { result } = renderChatHook(server, {});
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("открой задачу 2"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push(callPart("call-1", "open_task", {}));
      server.streams[0]!.finish();
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(answers(server)).toHaveLength(0);
  });
});
