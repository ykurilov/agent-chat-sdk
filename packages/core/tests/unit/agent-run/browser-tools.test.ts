import { tool } from "ai";
import type { ToolSet } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  BROWSER_PAGE_NOT_CONNECTED,
  BROWSER_RESULT_TOO_LARGE,
  BrowserCallNotPendingError,
  checkBrowserToolDescriptions,
  createPendingBrowserCalls,
  createTurnBrowserTools,
  resolveBrowserToolTimeoutMs,
} from "../../../src/agent-run/browser-tools";

const openTask = tool({ description: "Открыть задачу", inputSchema: z.object({ taskId: z.number() }) });

describe("настройки браузерных инструментов", () => {
  it("срок: по умолчанию 30 с, меньше 1 с и больше 2³¹−1 мс (таймер сработал бы сразу) — ошибка настройки", () => {
    expect(resolveBrowserToolTimeoutMs(undefined)).toBe(30_000);
    expect(resolveBrowserToolTimeoutMs(3000)).toBe(3000);
    expect(() => resolveBrowserToolTimeoutMs(999)).toThrow(/browserToolTimeoutMs/);
    expect(() => resolveBrowserToolTimeoutMs(Number.NaN)).toThrow(/browserToolTimeoutMs/);
    expect(resolveBrowserToolTimeoutMs(2 ** 31 - 1)).toBe(2 ** 31 - 1);
    expect(() => resolveBrowserToolTimeoutMs(2 ** 31)).toThrow(/browserToolTimeoutMs/);
    expect(() => resolveBrowserToolTimeoutMs(Number.POSITIVE_INFINITY)).toThrow(/browserToolTimeoutMs/);
  });

  it("описание с execute — ошибка: функцию даёт страница", () => {
    const withExecute = tool({ description: "x", inputSchema: z.object({}), execute: async () => "ок" });
    expect(() => checkBrowserToolDescriptions({ open_task: openTask, bad: withExecute })).toThrow(/bad/);
    expect(checkBrowserToolDescriptions({ open_task: openTask })).toEqual({ open_task: openTask });
  });
});

describe("ожидающие браузерные вызовы", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const waitFor = (pending: ReturnType<typeof createPendingBrowserCalls>, extra: { signal?: AbortSignal; timeoutMs?: number } = {}) =>
    pending.wait({ chatId: "chat-1", toolCallId: "c1", tabId: "tab-1", timeoutMs: extra.timeoutMs ?? 30_000, signal: extra.signal ?? new AbortController().signal });

  it("ответ вкладки с результатом — вызов получает результат; undefined и null — «готово»", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = waitFor(pending);
    pending.answer("chat-1", "c1", { tabId: "tab-1", output: { opened: 2 } });
    await expect(waiting).resolves.toEqual({ opened: 2 });

    const second = waitFor(pending);
    pending.answer("chat-1", "c1", { tabId: "tab-1", output: undefined });
    await expect(second).resolves.toBe("готово");

    const third = waitFor(pending);
    pending.answer("chat-1", "c1", { tabId: "tab-1", output: null });
    await expect(third).resolves.toBe("готово");
  });

  it("ответ с ошибкой — вызов закрывается ошибкой с её текстом; длинный текст обрезан до 1000 знаков", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = waitFor(pending);
    pending.answer("chat-1", "c1", { tabId: "tab-1", error: "Нет такой задачи" });
    await expect(waiting).rejects.toThrow("Нет такой задачи");

    const long = waitFor(pending);
    pending.answer("chat-1", "c1", { tabId: "tab-1", error: "о".repeat(5000) });
    const error = await long.catch((thrown: Error) => thrown);
    expect((error as Error).message.length).toBe(1000);
  });

  it("результат больше 16 КБ в JSON — ошибка «Слишком большой результат», ответ принят", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = waitFor(pending);
    expect(() => pending.answer("chat-1", "c1", { tabId: "tab-1", output: "я".repeat(9000) })).not.toThrow();
    await expect(waiting).rejects.toThrow(BROWSER_RESULT_TOO_LARGE);
  });

  it("чужая вкладка — BrowserCallNotPendingError, вызов ждёт дальше и принимает ответ своей", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = waitFor(pending);
    expect(() => pending.answer("chat-1", "c1", { tabId: "tab-2", output: "чужое" })).toThrow(BrowserCallNotPendingError);
    pending.answer("chat-1", "c1", { tabId: "tab-1", output: "своё" });
    await expect(waiting).resolves.toBe("своё");
  });

  it("повторный ответ и ответ на неизвестный вызов — BrowserCallNotPendingError", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = waitFor(pending);
    pending.answer("chat-1", "c1", { tabId: "tab-1", output: 1 });
    await waiting;
    expect(() => pending.answer("chat-1", "c1", { tabId: "tab-1", output: 2 })).toThrow(BrowserCallNotPendingError);
    expect(() => pending.answer("chat-2", "c1", { tabId: "tab-1", output: 2 })).toThrow(BrowserCallNotPendingError);
  });

  it("срок вышел — ошибка «Страница не ответила за N с»; поздний ответ — BrowserCallNotPendingError", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = waitFor(pending, { timeoutMs: 3000 });
    const settled = vi.fn();
    waiting.catch(settled);
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).rejects.toThrow("Страница не ответила за 3 с");
    expect(() => pending.answer("chat-1", "c1", { tabId: "tab-1", output: "поздно" })).toThrow(BrowserCallNotPendingError);
  });

  it("срок по умолчанию — 30 с", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = waitFor(pending);
    const caught = waiting.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await caught).toBe("Страница не ответила за 30 с");
  });

  it("обрыв (стоп, удаление чата) снимает ожидание сразу; ответ после — BrowserCallNotPendingError; таймер не остаётся", async () => {
    const pending = createPendingBrowserCalls();
    const controller = new AbortController();
    const waiting = waitFor(pending, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toThrow();
    expect(() => pending.answer("chat-1", "c1", { tabId: "tab-1", output: 1 })).toThrow(BrowserCallNotPendingError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("уже оборванный сигнал — ожидания нет", async () => {
    const pending = createPendingBrowserCalls();
    const controller = new AbortController();
    controller.abort();
    await expect(waitFor(pending, { signal: controller.signal })).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("прокладки одного хода", () => {
  const options = { toolCallId: "c1", messages: [], abortSignal: new AbortController().signal };
  /** Вызов инструмента так, как его зовёт SDK. */
  const execute = (tools: ToolSet, name: string, input: unknown) =>
    (tools[name]!.execute as unknown as (input: unknown, callOptions: typeof options) => Promise<unknown>)(input, options);

  it("без вкладки — сразу ошибка «страница не подключена», кусков нет", async () => {
    const emit = vi.fn();
    const turn = createTurnBrowserTools({
      descriptions: { open_task: openTask },
      pending: createPendingBrowserCalls(),
      chatId: "chat-1",
      tabId: undefined,
      timeoutMs: 30_000,
      emit,
      signal: new AbortController().signal,
    });
    await expect(execute(turn.tools, "open_task", { taskId: 2 })).rejects.toThrow(BROWSER_PAGE_NOT_CONNECTED);
    expect(emit).not.toHaveBeenCalled();
  });

  it("ход уже остановлен и кусок не ушёл: отказ ожидания не остаётся без обработчика (иначе падает весь процесс)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const stopped = new AbortController();
      stopped.abort();
      const turn = createTurnBrowserTools({
        descriptions: { open_task: openTask },
        pending: createPendingBrowserCalls(),
        chatId: "chat-1",
        tabId: "tab-1",
        timeoutMs: 30_000,
        // Поток клиенту уже закрыт: кусок не отправить.
        emit: () => {
          throw new TypeError("Invalid state: Controller is already closed");
        },
        signal: stopped.signal,
      });
      await expect(execute(turn.tools, "open_task", { taskId: 2 })).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("кусок data-browser-call уходит после того, как ожидание заведено: мгновенный ответ не теряется", async () => {
    const pending = createPendingBrowserCalls();
    const turn = createTurnBrowserTools({
      descriptions: { open_task: openTask },
      pending,
      chatId: "chat-1",
      tabId: "tab-1",
      timeoutMs: 30_000,
      // Вкладка отвечает прямо в момент куска.
      emit: (chunk) => pending.answer("chat-1", (chunk as { id: string }).id, { tabId: "tab-1", output: "открыла" }),
      signal: new AbortController().signal,
    });
    await expect(execute(turn.tools, "open_task", { taskId: 2 })).resolves.toBe("открыла");
  });

  it("кусок: временный, id — номер вызова, данные — имя, вход и вкладка; описание сохраняет схему и needsApproval", async () => {
    const emit = vi.fn();
    const pending = createPendingBrowserCalls();
    const guarded = tool({ description: "Подсветить", inputSchema: z.object({}), needsApproval: true });
    const turn = createTurnBrowserTools({
      descriptions: { open_task: openTask, highlight: guarded },
      pending,
      chatId: "chat-1",
      tabId: "tab-1",
      timeoutMs: 30_000,
      emit,
      signal: new AbortController().signal,
    });
    expect(turn.tools.open_task!.inputSchema).toBe(openTask.inputSchema);
    expect((turn.tools.highlight as { needsApproval?: unknown }).needsApproval).toBe(true);
    const running = execute(turn.tools, "open_task", { taskId: 2 });
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith({
      type: "data-browser-call",
      id: "c1",
      data: { toolCallId: "c1", toolName: "open_task", input: { taskId: 2 }, tabId: "tab-1" },
      transient: true,
    });
    pending.answer("chat-1", "c1", { tabId: "tab-1", output: "ок" });
    await expect(running).resolves.toBe("ок");
  });

  it("конец хода снимает ожидание его вызовов", async () => {
    const pending = createPendingBrowserCalls();
    const turn = createTurnBrowserTools({
      descriptions: { open_task: openTask },
      pending,
      chatId: "chat-1",
      tabId: "tab-1",
      timeoutMs: 30_000,
      emit: () => {},
      signal: new AbortController().signal,
    });
    const running = execute(turn.tools, "open_task", { taskId: 2 });
    turn.close();
    await expect(running).rejects.toThrow();
    expect(() => pending.answer("chat-1", "c1", { tabId: "tab-1", output: 1 })).toThrow(BrowserCallNotPendingError);
  });
});
