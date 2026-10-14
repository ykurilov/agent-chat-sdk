import { createAppStateWriter, publicAppState } from "../app-state/app-state";
import type { AppStateRecord, AppStateValues } from "../app-state/app-state";
import type { AgentNotice } from "../notices/agent-notice";
import type { PrepareTurn, PrepareTurnContext, PrepareTurnResult } from "./prepare-turn";

/** Срок `prepareTurn`: дольше — ход идёт без записей. */
export const PREPARE_TURN_TIMEOUT_MS = 3000;

/** Что подготовка дала ходу. */
export interface PreparedTurn {
  /** Записи состояния по порядку: ход кладёт их частями `data-app-state` в начало ответа. */
  records: AppStateRecord[];
  /** Состояние ветки после записей, со служебными ключами: основа писателей хода и блоков контекста. */
  state: AppStateValues;
  /** Служебные сообщения хода для модели. */
  notices: AgentNotice[];
}

/**
 * Зовёт `prepareTurn` приложения со сроком и проверяет ответ. Ошибка, срок или негодная запись — `undefined` и строка
 * в журнал: ход идёт как без подготовки. «Стоп» — `undefined` без строки.
 */
export async function prepareTurnSafely(input: {
  prepareTurn: PrepareTurn;
  context: Omit<PrepareTurnContext, "state" | "abortSignal">;
  /** Состояние ветки до хода со служебными ключами; подготовка видит его без них. */
  state: AppStateValues;
  abortSignal: AbortSignal;
  logError: (line: string) => void;
  timeoutMs?: number;
}): Promise<PreparedTurn | undefined> {
  const { context, logError } = input;
  const timeoutMs = input.timeoutMs ?? PREPARE_TURN_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const onStop = () => controller.abort(input.abortSignal.reason);
  if (input.abortSignal.aborted) return undefined;
  input.abortSignal.addEventListener("abort", onStop, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`prepareTurn не уложился в ${timeoutMs} мс`));
  }, timeoutMs);
  const fail = (reason: string) => logError(`[prepareTurn] чат=${context.chatId} ход без записей: ${reason}`);
  try {
    const aborted = new Promise<"aborted">((resolve) => controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
    const result = await Promise.race([
      Promise.resolve().then(() => input.prepareTurn({ ...context, state: publicAppState(input.state), abortSignal: controller.signal })),
      aborted,
    ]);
    if (result === "aborted") {
      if (timedOut) fail(`не уложился в ${timeoutMs} мс`);
      return undefined;
    }
    return checkedResult(result ?? {}, input.state, context.chatId);
  } catch (failure) {
    if (!input.abortSignal.aborted) fail(failure instanceof Error ? failure.message : String(failure));
    return undefined;
  } finally {
    clearTimeout(timer);
    input.abortSignal.removeEventListener("abort", onStop);
  }
}

/** Записи через писатель приложения: те же правила, что у `model.state` инструментов. Негодное — исключение. */
function checkedResult(result: PrepareTurnResult, state: AppStateValues, chatId: string): PreparedTurn {
  const { set, unset, notices = [] } = result;
  if (set !== undefined && (typeof set !== "object" || set === null || Array.isArray(set))) throw new TypeError("set — объект «путь → значение»");
  if (unset !== undefined && !Array.isArray(unset)) throw new TypeError("unset — массив путей");
  if (!Array.isArray(notices) || !notices.every(isNotice)) throw new TypeError("notices — служебные сообщения с kind и title строками");
  const records: AppStateRecord[] = [];
  const writer = createAppStateWriter({
    base: state,
    write: (record) => records.push(record),
    logError: () => {},
    chatId,
  });
  for (const path of unset ?? []) writer.unset(path);
  for (const [path, value] of Object.entries(set ?? {})) writer.set(path, value);
  return { records, state: writer.values(), notices: structuredClone(notices) };
}

const isNotice = (notice: unknown): notice is AgentNotice =>
  typeof notice === "object" && notice !== null && typeof (notice as AgentNotice).kind === "string" && typeof (notice as AgentNotice).title === "string";
