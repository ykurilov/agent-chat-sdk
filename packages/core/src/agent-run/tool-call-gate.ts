import type { ToolSet } from "ai";
import { LAST_STEP_TOOL_REFUSAL } from "./last-step";
import { isAsyncGeneratorFunction } from "./sequential-tools";

/** Дольше этого вызов записи не ждёт: база тормозит — инструмент всё равно идёт, а запись догонит. */
export const CALL_SAVE_WAIT_MS = 5_000;

export interface ToolCallGate {
  /** Шаг без инструментов (последний шаг хода, итог по потолку): вызов вопреки запрету не выполняется. */
  closed: () => boolean;
  /** Ждёт, пока начатый вызов попадёт в хранилище. Нет — вызов идёт сразу. */
  callSaved?: (toolCallId: string) => Promise<void>;
  /** Исходные инструменты: по ним видно, кто отдаёт промежуточный вывод (`async function*`). Нет — `tools`. */
  kindsFrom?: ToolSet;
}

/**
 * Пропуск вызова к выполнению. На закрытом шаге (`closed`) — отказ ошибкой с постоянным текстом: инструмент не
 * выполняется (модель могла бы, например, забронировать время), а у вызова есть закрывающий результат — строгие
 * провайдеры не принимают вызов без результата. Подтверждение на закрытом шаге не спрашивается: вызов сразу получает
 * отказ (`gateToolApproval`). Иначе вызов ждёт записи себя в хранилище (`callSaved`, не дольше `CALL_SAVE_WAIT_MS`):
 * упади сервер посреди инструмента, в базе остаётся начатый вызов. Инструменты без `execute` не трогаются.
 */
export function gateToolCalls(tools: ToolSet | undefined, gate: ToolCallGate): ToolSet | undefined {
  if (!tools) return tools;
  const gated: ToolSet = {};
  for (const [name, original] of Object.entries(tools)) {
    const execute = original.execute;
    if (!execute) {
      gated[name] = original;
      continue;
    }
    type CallOptions = Parameters<typeof execute>[1];
    const refuseIfClosed = () => {
      if (gate.closed()) throw new Error(LAST_STEP_TOOL_REFUSAL);
    };
    const saved = (callOptions: CallOptions) => (gate.callSaved ? withinWait(gate.callSaved(callOptions.toolCallId)) : Promise.resolve());
    gated[name] = {
      ...original,
      execute: isAsyncGeneratorFunction(gate.kindsFrom?.[name]?.execute ?? execute)
        ? (input: unknown, callOptions: CallOptions) => {
            refuseIfClosed();
            return (async function* () {
              await saved(callOptions);
              yield* execute(input, callOptions) as AsyncIterable<unknown>;
            })();
          }
        : (input: unknown, callOptions: CallOptions) => {
            refuseIfClosed();
            return saved(callOptions).then(() => execute(input, callOptions));
          },
    } as typeof original;
  }
  return gated;
}

/** Решение о подтверждении: на закрытом шаге подтверждение не спрашивается — вызов получит отказ в `execute`. */
export function gateToolApproval<Approval extends (...args: never[]) => unknown>(toolApproval: Approval, closed: () => boolean): Approval {
  return ((...args: Parameters<Approval>) => (closed() ? undefined : toolApproval(...args))) as Approval;
}

function withinWait(saved: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => (timer = setTimeout(resolve, CALL_SAVE_WAIT_MS)));
  return Promise.race([saved.catch(() => {}), cap]).finally(() => clearTimeout(timer));
}
