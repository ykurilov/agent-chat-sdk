import type { ToolSet, UIMessageChunk } from "ai";
import { BROWSER_CALL_PART_TYPE } from "../page-context/page-context";
import { cutAtCharBoundary } from "../text/safe-truncate";

export const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 30_000;
const MIN_BROWSER_TOOL_TIMEOUT_MS = 1000;
/** Больше этого `setTimeout` срабатывает сразу. */
const MAX_BROWSER_TOOL_TIMEOUT_MS = 2 ** 31 - 1;
/** Результат вкладки больше этого в JSON модели не отдаётся. */
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_ERROR_LENGTH = 1000;

/** Тексты ошибок вызова для модели. Текст «Инструмент недоступен на этой странице» шлёт сама вкладка. */
export const BROWSER_PAGE_NOT_CONNECTED = "Действие на экране недоступно: страница не подключена";
export const BROWSER_RESULT_TOO_LARGE = "Слишком большой результат";
const BROWSER_CALL_INTERRUPTED = "Вызов прерван: ход закончился";
const BROWSER_PAGE_ERROR = "Ошибка на странице";
/** Функция вернула пусто (вкладка шлёт `null`): модели нужен хоть какой-то результат. */
const DONE_OUTPUT = "готово";

export const browserTimeoutMessage = (timeoutMs: number) => `Страница не ответила за ${Math.max(1, Math.round(timeoutMs / 1000))} с`;

/** Вызов не ждёт ответа: уже отвечен, срок вышел, ход кончился, его не было — или отвечает не та вкладка. */
export class BrowserCallNotPendingError extends Error {
  constructor(toolCallId: string) {
    super(`Браузерный вызов ${toolCallId} не ждёт ответа этой вкладки`);
    this.name = "BrowserCallNotPendingError";
  }
}

/** Ответ вкладки: результат функции или текст её ошибки. */
export type BrowserCallAnswer = { tabId: string } & ({ output: unknown } | { error: string });

/** Срок ответа вкладки из настроек агента: по умолчанию 30 с, меньше 1 с или больше 2³¹−1 мс — ошибка настройки. */
export function resolveBrowserToolTimeoutMs(setting: number | undefined): number {
  if (setting === undefined) return DEFAULT_BROWSER_TOOL_TIMEOUT_MS;
  if (!Number.isFinite(setting) || setting < MIN_BROWSER_TOOL_TIMEOUT_MS || setting > MAX_BROWSER_TOOL_TIMEOUT_MS) {
    throw new Error(`Настройка agent.browserToolTimeoutMs должна быть числом от ${MIN_BROWSER_TOOL_TIMEOUT_MS} до ${MAX_BROWSER_TOOL_TIMEOUT_MS}`);
  }
  return Math.floor(setting);
}

/** Описания браузерных инструментов: без `execute` — действие делает функция на странице. */
export function checkBrowserToolDescriptions(descriptions: ToolSet): ToolSet {
  for (const [name, description] of Object.entries(descriptions)) {
    if (description.execute) {
      throw new Error(`Браузерный инструмент «${name}» задан с execute: функцию даёт страница (browserTools у панели), на сервере — только описание`);
    }
  }
  return descriptions;
}

/**
 * Вызовы, которые ждут ответа вкладки, — в памяти процесса, рядом с реестром идущих ответов (один сервер).
 * Ключ — чат и номер вызова. Любой конечный исход (ответ, срок, обрыв) убирает запись: повтор ответа — `BrowserCallNotPendingError`.
 */
export interface PendingBrowserCalls {
  /** Ждёт ответ вкладки `tabId`: результат — значение, ошибка вкладки, срок или обрыв — отказ с текстом для модели. */
  wait(call: { chatId: string; toolCallId: string; tabId: string; timeoutMs: number; signal: AbortSignal }): Promise<unknown>;
  /**
   * Ответ вкладки. Чужая вкладка не снимает ожидание.
   * @throws BrowserCallNotPendingError
   */
  answer(chatId: string, toolCallId: string, answer: BrowserCallAnswer): void;
}

interface WaitingCall {
  tabId: string;
  settle(outcome: { output: unknown } | { error: string }): void;
}

export function createPendingBrowserCalls(): PendingBrowserCalls {
  const waiting = new Map<string, WaitingCall>();
  const keyOf = (chatId: string, toolCallId: string) => JSON.stringify([chatId, toolCallId]);

  return {
    wait({ chatId, toolCallId, tabId, timeoutMs, signal }) {
      const key = keyOf(chatId, toolCallId);
      return new Promise<unknown>((resolve, reject) => {
        if (signal.aborted) return reject(new Error(BROWSER_CALL_INTERRUPTED));
        if (waiting.has(key)) return reject(new Error(`Браузерный вызов ${toolCallId} уже ждёт ответа`));
        const timer = setTimeout(() => settle({ error: browserTimeoutMessage(timeoutMs) }), timeoutMs);
        const onAbort = () => settle({ error: BROWSER_CALL_INTERRUPTED });
        signal.addEventListener("abort", onAbort, { once: true });
        function settle(outcome: { output: unknown } | { error: string }) {
          if (waiting.get(key) !== entry) return;
          waiting.delete(key);
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          if ("error" in outcome) reject(new Error(outcome.error));
          else resolve(outcome.output);
        }
        const entry: WaitingCall = { tabId, settle };
        waiting.set(key, entry);
      });
    },

    answer(chatId, toolCallId, answer) {
      const entry = waiting.get(keyOf(chatId, toolCallId));
      if (!entry || entry.tabId !== answer.tabId) throw new BrowserCallNotPendingError(toolCallId);
      entry.settle(checkedOutcome(answer));
    },
  };
}

/** Ответ вкладки в пределах: ошибка обрезана, результат не больше 16 КБ, пустой — «готово». */
function checkedOutcome(answer: BrowserCallAnswer): { output: unknown } | { error: string } {
  if ("error" in answer) {
    const text = String(answer.error).trim() || BROWSER_PAGE_ERROR;
    return { error: text.length > MAX_ERROR_LENGTH ? `${cutAtCharBoundary(text, MAX_ERROR_LENGTH - 1)}…` : text };
  }
  const output = answer.output ?? DONE_OUTPUT;
  let json: string | undefined;
  try {
    json = JSON.stringify(output);
  } catch {
    json = undefined;
  }
  if (json === undefined || new TextEncoder().encode(json).length > MAX_OUTPUT_BYTES) return { error: BROWSER_RESULT_TOO_LARGE };
  return { output };
}

/** Прокладки одного хода: инструмент на каждое описание и `close` в конце хода. */
export interface TurnBrowserTools {
  tools: ToolSet;
  /** Ход кончился: его вызовы больше не ждут. */
  close(): void;
}

/**
 * Каждое описание становится обычным инструментом: без вкладки — сразу ошибка; иначе ждёт ответа своей вкладки и
 * кладёт в поток временный кусок `data-browser-call`. Описание остаётся тем же (схема, `needsApproval`): подтверждение
 * работает как у серверных инструментов, а кусок уходит только из `execute`, то есть после «Разрешить».
 */
export function createTurnBrowserTools(context: {
  descriptions: ToolSet;
  pending: PendingBrowserCalls;
  chatId: string;
  /** Вкладка, с которой пришёл запрос хода; нет — страница без панели. */
  tabId: string | undefined;
  timeoutMs: number;
  emit: (chunk: UIMessageChunk) => void;
  /** «Стоп» и удаление чата. */
  signal: AbortSignal;
}): TurnBrowserTools {
  const turnEnded = new AbortController();
  const signal = AbortSignal.any([context.signal, turnEnded.signal]);
  const tools: ToolSet = {};
  for (const [toolName, description] of Object.entries(context.descriptions)) {
    tools[toolName] = {
      ...description,
      execute: async (input: unknown, { toolCallId }: { toolCallId: string }) => {
        const { tabId } = context;
        if (!tabId) throw new Error(BROWSER_PAGE_NOT_CONNECTED);
        // Ожидание заводится до куска: вкладка может ответить раньше, чем `execute` дойдёт до следующей строки.
        const answered = context.pending.wait({ chatId: context.chatId, toolCallId, tabId, timeoutMs: context.timeoutMs, signal });
        // Кусок может не уйти (после «Стоп» поток клиенту закрыт): отказ ожидания тогда не должен остаться без обработчика.
        answered.catch(() => {});
        context.emit({ type: BROWSER_CALL_PART_TYPE, id: toolCallId, data: { toolCallId, toolName, input, tabId }, transient: true });
        return answered;
      },
    } as ToolSet[string];
  }
  return { tools, close: () => turnEnded.abort() };
}
