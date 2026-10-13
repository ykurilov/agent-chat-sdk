import type { ToolExecutionOptions } from "ai";
import { vi } from "vitest";
import { pngBytes } from "./image-bytes";

export const KEY = "rw-key-0123456789";

export function executeOptions(abortSignal?: AbortSignal): ToolExecutionOptions<unknown> {
  return { toolCallId: "call-1", messages: [], context: undefined, ...(abortSignal && { abortSignal }) } as ToolExecutionOptions<unknown>;
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Ответ Runware с готовой картинкой: адрес по номеру задачи. */
export const ready = (number: number, cost?: number) =>
  json({ data: [{ taskType: "imageInference", imageURL: `https://im.runware.ai/image/${number}.png`, ...(cost !== undefined && { cost }) }] });

/** Ответ или функция от запроса: так ответ может ждать «Стопа» или теста. */
type Answer = Response | ((init: RequestInit) => Response | Promise<Response>);

/**
 * Поддельный `fetch`: POST задачи отвечает по номеру задачи (порядок отправки, с 1), GET картинки — байтами PNG или
 * ответом из `downloads`. Ни один ответ не задан — готовая картинка без цены.
 */
export function fakeRunware(options: { tasks?: Record<number, Answer>; downloads?: Record<number, Answer> } = {}) {
  const sent: Array<{ url: string; init: RequestInit; task: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (init?.method === "POST") {
      const [task] = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
      sent.push({ url, init, task: task! });
      const number = sent.length;
      const answer = options.tasks?.[number] ?? ready(number);
      return abortable(await (typeof answer === "function" ? answer(init) : answer), init.signal);
    }
    const number = Number(/\/(\d+)\.png$/.exec(url)?.[1]);
    const answer = options.downloads?.[number] ?? new Response(pngBytes() as BodyInit);
    return abortable(await (typeof answer === "function" ? answer(init ?? {}) : answer), init?.signal);
  });
  return { fetch, sent };
}

/** Ответ, который «Стоп» обрывает, как настоящий `fetch`. */
function abortable(response: Response, signal: AbortSignal | null | undefined): Response {
  signal?.throwIfAborted();
  return response;
}

/** Обещание, которое разрешает тест. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Ответ, висящий до «Стопа» запроса: тогда отказ с причиной сигнала, как у настоящего `fetch`. */
export function hanging(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
}
