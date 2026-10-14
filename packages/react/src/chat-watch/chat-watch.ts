/**
 * Подписка на события чата: `GET /:chatId/watch` отдаёт поток SSE, пока вкладка открыта.
 * Обрыв или затянувшаяся тишина — переподключение с паузами; адреса нет — подписка заканчивается.
 * Доступ закрыт (401, 403) — повтор через долгую паузу: вход могли восстановить. Вкладка, кроме того, открывает подписку
 * заново после каждого своего хода.
 */

export type ChatWatchEvent =
  | { type: "turn-started"; messageId: string; trigger: string; channel: string }
  | { type: "turn-finished"; messageId?: string }
  | { type: "tasks-changed" }
  | { type: "notice-added"; messageId: string }
  /** Сообщение записано без хода (пачка из мессенджера ждёт тишины, «Стоп» отменил пачку). */
  | { type: "message-added"; messageId: string }
  | { type: "chat-closed"; closed: { code: string; message: string } }
  | { type: "chat-reopened" }
  /** Состояние чата сменилось (ход, смена ветки, правка ответа — в том числе в другой вкладке). */
  | { type: "state-changed"; state: unknown; atMessageId: string | null }
  | { type: string; [key: string]: unknown };

export type WatchChatOptions = {
  url: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  signal: AbortSignal;
  /** Паузы перед повторами по порядку; последняя повторяется. */
  delaysMs: readonly number[];
  /** Пауза перед повтором после 401 или 403. По умолчанию минута. */
  refusedRetryMs?: number;
  /** Сколько ждать хоть какого-то байта (событие или пинг), прежде чем считать поток мёртвым. */
  silenceTimeoutMs: number;
  onOpen?: () => void;
  onEvent: (event: ChatWatchEvent) => void;
};

export type WatchChatEnd = "unavailable" | "stopped";

export async function watchChat(options: WatchChatOptions): Promise<WatchChatEnd> {
  const { signal, delaysMs } = options;
  let failures = 0;
  while (!signal.aborted) {
    const outcome = await readOnce(options);
    if (outcome === "unavailable") return "unavailable";
    if (signal.aborted) break;
    if (outcome === "refused") {
      await pause(options.refusedRetryMs ?? 60_000, signal);
      continue;
    }
    if (outcome === "opened") failures = 0;
    const delay = delaysMs[Math.min(failures, delaysMs.length - 1)] ?? 1000;
    failures += 1;
    await pause(delay, signal);
  }
  return "stopped";
}

/** Одно подключение: `opened` — поток открывался и потом закрылся; `failed` — не открылся; `refused` — нет доступа. */
async function readOnce(options: WatchChatOptions): Promise<"opened" | "failed" | "refused" | "unavailable"> {
  const connection = new AbortController();
  const stopConnection = () => connection.abort();
  options.signal.addEventListener("abort", stopConnection, { once: true });
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  const restartSilenceTimer = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(stopConnection, options.silenceTimeoutMs);
  };
  try {
    const response = await options.fetch(options.url, { headers: { accept: "text/event-stream" }, signal: connection.signal });
    if (!response.ok || !response.body) {
      if (response.status === 401 || response.status === 403) return "refused";
      if (isPermanentRefusal(response.status)) return "unavailable";
      return "failed";
    }
    // Сервер без подписки, который на любой адрес отвечает своей страницей или JSON: повторять бессмысленно.
    if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return "unavailable";
    options.onOpen?.();
    restartSilenceTimer();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      restartSilenceTimer();
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = eventOf(block);
        if (event && !connection.signal.aborted) options.onEvent(event);
        boundary = buffer.indexOf("\n\n");
      }
    }
    return "opened";
  } catch {
    return connection.signal.aborted && !options.signal.aborted ? "opened" : "failed";
  } finally {
    clearTimeout(silenceTimer);
    options.signal.removeEventListener("abort", stopConnection);
    connection.abort();
  }
}

/** Адреса нет или запрос неверен — повторять бессмысленно. Перегрузку и таймаут сервера повторяем. */
function isPermanentRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function eventOf(block: string): ChatWatchEvent | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") return parsed as ChatWatchEvent;
  } catch {
    // Битая строка — пропускаем, следующее событие дойдёт.
  }
  return undefined;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
