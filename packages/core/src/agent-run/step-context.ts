import type { ModelMessage } from "ai";
import type { AppStateValues } from "../app-state/app-state";
import type { AgentAudience, AgentChannel, ChatSubject } from "../conversation/types";
import type { StaffActor } from "../turn-hooks/turn-hooks";
import { estimateTextTokens } from "./turn-usage";

/** Срок ответа `stepContext` по умолчанию: снимок нужен до запроса шага, долгая функция держит весь ход. */
export const DEFAULT_STEP_CONTEXT_TIMEOUT_MS = 5_000;

/** Что видит `stepContext` перед шагом модели. */
export interface StepContextInput {
  /** Состояние чата на ветке к этому шагу: записи инструментов прошлых шагов уже в нём. Без служебных ключей, копия. */
  state: AppStateValues;
  /** Номер шага во всём ходе, с нуля: запасной провайдер и продолжение его не сбрасывают. */
  stepNumber: number;
  chatId: string;
  ownerId: string;
  /** Ответ агента, который строит этот ход. */
  messageId: string;
  /** Данные чата (`Chat.data`), копия. */
  chat: { data?: Record<string, unknown> };
  /** Объект чата, копия; нет — обычный чат. */
  subject?: ChatSubject;
  /** Откуда ход: веб или мессенджер. Как `AgentToolsModel.channel`. */
  channel: AgentChannel;
  /** С кем говорит агент: в группе (`"group"`) снимок видят все участники, личного в нём быть не должно. */
  audience: AgentAudience;
  /** Сотрудник, который делает ход в копии чата человека, копия; нет — ход делает сам владелец. */
  staff?: StaffActor;
  modelId: string;
  providerId: string;
  /** Отмена: «Стоп», срок функции (`agent.stepContextTimeoutMs`), срок хода, переход к запасному. */
  abortSignal: AbortSignal;
}

/**
 * Снимок перед каждым шагом модели: текст ложится сообщением человека в самый конец запроса шага, в историю не пишется.
 * Пустая строка, `null` или `undefined` — шаг без снимка.
 */
export type StepContext = (input: StepContextInput) => string | null | undefined | Promise<string | null | undefined>;

export interface StepSnapshots {
  /**
   * Сообщения шага: снимок прошлого шага убран, новый — перед `trailing` последними сообщениями (служебная пометка
   * попытки), иначе последним. `tokens` — оценка размера снимка.
   */
  messagesFor(input: { messages: ModelMessage[]; trailing: number; context: StepContextInput }): Promise<{ messages: ModelMessage[]; tokens: number }>;
}

interface StepSnapshotsOptions {
  stepContext: StepContext;
  logError: (message: string) => void;
  chatId: string;
  /** Срок ответа функции, мс; `Infinity` — без срока. Нет — `DEFAULT_STEP_CONTEXT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Снимки одной попытки. На шаге снимок один: AI SDK переносит подменённые сообщения шага в следующие шаги, поэтому свой
 * прошлый снимок убирается по ссылке на сообщение. Всё до снимка остаётся теми же байтами (кэш модели). Функция бросила
 * или не ответила за срок — шаг без снимка, строка в журнал; «Стоп» — шаг без снимка сразу.
 */
export function createStepSnapshots(options: StepSnapshotsOptions): StepSnapshots {
  let previous: ModelMessage | undefined;
  return {
    async messagesFor({ messages, trailing, context }) {
      const withoutPrevious = previous ? messages.filter((message) => message !== previous) : messages;
      previous = undefined;
      const text = await snapshotText(options, context);
      if (!text) return { messages: withoutPrevious, tokens: 0 };
      const snapshot: ModelMessage = { role: "user", content: [{ type: "text", text }] };
      previous = snapshot;
      const at = withoutPrevious.length - Math.min(trailing, withoutPrevious.length);
      return { messages: [...withoutPrevious.slice(0, at), snapshot, ...withoutPrevious.slice(at)], tokens: estimateTextTokens(text) };
    },
  };
}

async function snapshotText(options: StepSnapshotsOptions, context: StepContextInput): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_CONTEXT_TIMEOUT_MS;
  const log = (message: string) => options.logError(`[снимок шага] чат=${options.chatId} шаг=${context.stepNumber} ${message}`);
  const stop = context.abortSignal;
  const ownAbort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onStop: (() => void) | undefined;
  // Функция может не слушать отмену: ход ждёт её не дольше срока и не дольше «Стопа».
  const cutOff = new Promise<"timeout" | "stopped">((resolve) => {
    if (Number.isFinite(timeoutMs)) timer = setTimeout(() => resolve("timeout"), timeoutMs);
    onStop = () => resolve("stopped");
    if (stop.aborted) onStop();
    else stop.addEventListener("abort", onStop, { once: true });
  });
  try {
    const call = Promise.resolve().then(() => options.stepContext({ ...context, abortSignal: AbortSignal.any([stop, ownAbort.signal]) }));
    const outcome = await Promise.race([call.then((text) => ({ text })), cutOff]);
    if (outcome === "stopped") return null;
    if (outcome === "timeout") {
      ownAbort.abort(new Error(`stepContext не ответил за ${timeoutMs} мс`));
      log(`не ответил за ${timeoutMs} мс`);
      return null;
    }
    const { text } = outcome;
    if (text === null || text === undefined || text === "") return null;
    if (typeof text !== "string") throw new TypeError(`stepContext вернул ${typeof text}, а не строку`);
    return text;
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timer);
    stop.removeEventListener("abort", onStop!);
  }
}
