import { createAppStateWriter } from "../app-state/app-state";
import type { AppStateRecord, AppStateValues } from "../app-state/app-state";
import { logValue } from "../text/log-value";
import { TURN_REFUSAL_MESSAGE_MAX_LENGTH, validateAppEvent } from "../turn-hooks/turn-hooks";

/** Предел событий приложения одной проверки ответа в JSON, байт: как у одной записи состояния. */
const WIDGET_CHECK_EVENTS_MAX_BYTES = 16 * 1024;
import type { AppEvent } from "../turn-hooks/turn-hooks";
import { WIDGET_ANSWER_MAX_BYTES } from "./widget-tools";
import type { WidgetAnswerContext, WidgetAnswerVerdict } from "./widget-types";

/** Приложение отказало в ответе на виджет текстом (`checkAnswer`). Виджет остаётся открытым, ничего не записано. */
export class WidgetAnswerRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WidgetAnswerRefusedError";
  }
}

/** Проверку отменили до её конца («Стоп» в чате): ответ не записан, виджет открыт. */
export class WidgetAnswerCheckAbortedError extends Error {
  constructor() {
    super("Проверка ответа на виджет отменена");
    this.name = "WidgetAnswerCheckAbortedError";
  }
}

/** Проверка ответа не уложилась в срок: ответ не записан, виджет открыт. */
export class WidgetAnswerCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Проверка ответа на виджет не уложилась в срок ${timeoutMs} мс`);
    this.name = "WidgetAnswerCheckTimeoutError";
  }
}

/** Проверка приложения: своя у виджета или общая; `context.state` её заполняет служба. */
export type WidgetAnswerCheckFunction = (answer: unknown, context: WidgetAnswerContext) => WidgetAnswerVerdict | Promise<WidgetAnswerVerdict>;

/** Что получает служба от проверки: ответ для записи (возможно, замена), записи состояния и события, что лягут вместе с ним. */
export interface CheckedWidgetAnswer {
  output: unknown;
  stateRecords: AppStateRecord[];
  appEvents: AppEvent[];
}

/**
 * Проверка ответа приложением: зовёт `check` с контекстом, держит срок, превращает исход в ответ для записи.
 * Отказ — `WidgetAnswerRefusedError`; пустой или негодный исход, замена не JSON или больше 16 КБ — `TypeError` и ошибка
 * приложения; исключение проверки и срок идут наружу как есть. Записи состояния и события отказа и ошибки отбрасываются, а
 * запись и событие после конца проверки (в том числе опоздавшей) не принимаются.
 */
export async function checkWidgetAnswerByApp(input: {
  check: WidgetAnswerCheckFunction;
  answer: unknown;
  context: Omit<WidgetAnswerContext, "state" | "signal" | "emitAppEvent">;
  /** Состояние ветки до ответа (со служебными ключами). */
  base: AppStateValues;
  timeoutMs: number;
  /** Отмена проверки снаружи («Стоп»); служба сама держит её и отменяет. Срок отменяет её же. */
  controller: AbortController;
  logError: (message: string) => void;
}): Promise<CheckedWidgetAnswer> {
  const records: AppStateRecord[] = [];
  const writer = createAppStateWriter({
    base: input.base,
    write: (record) => records.push(record),
    logError: input.logError,
    chatId: input.context.chatId,
  });
  const events: AppEvent[] = [];
  let eventsBytes = 0;
  let finished = false;
  const emitAppEvent = (event: AppEvent): void => {
    const checked = validateAppEvent(event);
    if (finished) {
      input.logError(`Проверка ответа виджета положила событие приложения «${logValue(checked.type)}» после своего конца в чате ${input.context.chatId}: событие не записано`);
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(checked)).length;
    if (eventsBytes + bytes > WIDGET_CHECK_EVENTS_MAX_BYTES) {
      throw new RangeError(
        `События приложения одной проверки ответа виджета — больше 16 КБ в JSON (было ${eventsBytes} байт, событие «${checked.type}» — ${bytes}): событие не записано. Кладите в событие ссылку, а данные читайте из своей базы.`,
      );
    }
    eventsBytes += bytes;
    events.push(checked);
  };
  const { signal } = input.controller;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new WidgetAnswerCheckTimeoutError(input.timeoutMs));
        input.controller.abort();
      }, input.timeoutMs);
      onAbort = () => reject(new WidgetAnswerCheckAbortedError());
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    const verdict = await Promise.race([Promise.resolve(input.check(input.answer, { ...input.context, state: writer, signal, emitAppEvent })), interrupted]);
    // Исход пришёл, но «Стоп» успел раньше: ответ не пишется.
    if (signal.aborted) throw new WidgetAnswerCheckAbortedError();
    return { output: outputOf(verdict, input.answer), stateRecords: [...records], appEvents: [...events] };
  } finally {
    finished = true;
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    writer.close();
  }
}

function outputOf(verdict: WidgetAnswerVerdict, accepted: unknown): unknown {
  if (verdict === undefined || verdict === null) return accepted;
  if (typeof verdict !== "object" || Array.isArray(verdict)) throw invalidVerdict();
  if ("refuse" in verdict) {
    if (typeof verdict.refuse !== "string") throw invalidVerdict();
    const text = Array.from(verdict.refuse.trim()).slice(0, TURN_REFUSAL_MESSAGE_MAX_LENGTH).join("");
    if (text.length === 0) throw new TypeError("checkAnswer: текст отказа (refuse) пустой");
    throw new WidgetAnswerRefusedError(text);
  }
  if ("answer" in verdict) {
    assertAnswerFits(verdict.answer);
    return verdict.answer;
  }
  throw invalidVerdict();
}

function assertAnswerFits(answer: unknown): void {
  let json: string | undefined;
  try {
    json = JSON.stringify(answer);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new TypeError("checkAnswer: замена ответа (answer) должна быть JSON");
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > WIDGET_ANSWER_MAX_BYTES) throw new TypeError(`checkAnswer: замена ответа (answer) — ${bytes} байт, больше 16 КБ`);
}

const invalidVerdict = (): TypeError => new TypeError("checkAnswer вернул неверный исход: ждём undefined, { answer } или { refuse: \"текст\" }");
