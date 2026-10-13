import type { AgentAppBridge, BrowserCall, BrowserCallResult } from "./app-bridge";
import { rememberedIds } from "./remembered-ids";

/** Тип куска потока ответа «выполни браузерный инструмент»; совпадает с `BROWSER_CALL_PART_TYPE` ядра. */
export const BROWSER_CALL_PART_TYPE = "data-browser-call";

/**
 * Под этим ключом `sessionStorage` хранит исполненные на вкладке вызовы (адрес чата и номер вызова, как ключ ожидания на
 * сервере): повтор кусков после перезагрузки их не повторит, а тот же номер в другом чате исполнится.
 */
export const BROWSER_CALLS_DONE_KEY = "agent-chat:browser-calls-done";

/** Исполненные на вкладке вызовы; помнятся последние 100. */
const doneCalls = rememberedIds(BROWSER_CALLS_DONE_KEY, 100);

/** Данные куска `data-browser-call`: вызов и вкладка, которой он адресован. */
export interface BrowserCallRequest extends BrowserCall {
  tabId: string;
}

/**
 * Исполняет вызов из потока ответа, если он адресован этой вкладке и ещё не исполнялся, и отправляет итог на
 * `{chatUrl}/browser-tools/{toolCallId}`. Сбой связи — тихо, вызов на сервере закроется сам. `409` (срок вышел, ход
 * кончился) — тоже без ошибки, но сервер уже ушёл дальше: `onNotPending` даёт ленте перечитать историю.
 */
export async function runBrowserCall(
  call: BrowserCallRequest,
  context: {
    bridge: AgentAppBridge;
    chatUrl: string;
    request: (input: string, init?: RequestInit) => Promise<Response>;
    signal: AbortSignal;
    onNotPending?: () => void;
  },
): Promise<void> {
  const { bridge } = context;
  if (call.tabId !== bridge.tabId || !doneCalls.claim(JSON.stringify([context.chatUrl, call.toolCallId]))) return;
  const result = await bridge.browserCall({ toolCallId: call.toolCallId, toolName: call.toolName, input: call.input }, { signal: context.signal });
  try {
    const response = await context.request(`${context.chatUrl}/browser-tools/${encodeURIComponent(call.toolCallId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: answerBody(bridge.tabId, result),
    });
    if (response.status === 409) context.onNotPending?.();
  } catch {
    // Связь оборвалась: сервер закроет вызов по сроку.
  }
}

/** Тело ответа: пустой результат — `null` (сервер скажет модели «готово»), результат не в JSON — ошибка с текстом. */
function answerBody(tabId: string, result: BrowserCallResult): string {
  if ("error" in result) return JSON.stringify({ tabId, error: result.error });
  try {
    return JSON.stringify({ tabId, output: result.output === undefined ? null : result.output });
  } catch (error) {
    return JSON.stringify({ tabId, error: error instanceof Error ? error.message : String(error) });
  }
}
