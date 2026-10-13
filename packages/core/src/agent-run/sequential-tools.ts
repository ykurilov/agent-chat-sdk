import type { ToolSet } from "ai";

/**
 * Настройка `agent.sequentialTools`: инструменты с последствиями («спиши деньги», «забронируй слот»), которые не должны
 * идти одновременно. `true` — все серверные инструменты, список — только названные. Не задано — все вместе, как раньше.
 */
export type SequentialToolsSetting = true | readonly string[];

export interface ResolvedSequentialTools {
  isSequential(toolName: string): boolean;
}

/** Проверяет настройку при создании службы; неверная — `TypeError` с путём настройки. */
export function resolveSequentialTools(setting: SequentialToolsSetting | undefined): ResolvedSequentialTools {
  if (setting === undefined) return { isSequential: () => false };
  if (setting === true) return { isSequential: () => true };
  if (!Array.isArray(setting) || !setting.every((name) => typeof name === "string")) {
    throw new TypeError("agent.sequentialTools: ждём true или список имён инструментов");
  }
  const names = new Set(setting);
  return { isSequential: (toolName) => names.has(toolName) };
}

export type ToolQueue = ReturnType<typeof createToolQueue>;

/**
 * Очередь вызовов чата: её делят попытки хода и ходы подряд («Стоп» и сразу «Повторить»). Вызов «по очереди» ждёт всех
 * начатых раньше, начатые после него — его; обычные вызовы друг друга не ждут. Так шаг с таким вызовом идёт по порядку
 * прихода вызовов (как `executionMode: "sequential"` в Pi).
 */
export function createToolQueue() {
  // Когда кончится последний вызов «по очереди» и всё, что он ждал.
  let lastSequential: Promise<void> = Promise.resolve();
  // Обычные вызовы, начатые после него.
  let parallelSince: Promise<void>[] = [];
  // Вызовы, отменённые в ожидании очереди: они не запускались.
  const cancelledWaiting = new Set<string>();
  // Вызовы, которые ещё не ушли из очереди, и кто ждёт, когда их не станет.
  let inQueue = 0;
  let idleWaiters: Array<() => void> = [];
  return {
    /** Место в очереди: `ready` — можно начинать, `leave` — вызов кончился или отменён. */
    join(sequential: boolean): { ready: Promise<void>; leave: () => void } {
      let leave!: () => void;
      const left = new Promise<void>((resolve) => (leave = resolve));
      const ready = sequential ? Promise.all([lastSequential, ...parallelSince]).then(() => {}) : lastSequential;
      // Ушедший раньше времени (отмена) не пропускает следующих вперёд того, кого ждал сам.
      inQueue += 1;
      const done = Promise.all([ready, left]).then(() => {
        inQueue -= 1;
        if (inQueue > 0) return;
        for (const wake of idleWaiters) wake();
        idleWaiters = [];
      });
      if (sequential) {
        lastSequential = done;
        parallelSince = [];
      } else {
        parallelSince.push(done);
      }
      return { ready, leave };
    },
    /** Вызов отменён, пока ждал очереди. */
    markNotStarted(toolCallId: string): void {
      cancelledWaiting.add(toolCallId);
    },
    /** Вызов отменён в ожидании и не запускался. */
    notStarted: (toolCallId: string): boolean => cancelledWaiting.has(toolCallId),
    /** В очереди никого: ни идущих вызовов, ни ждущих. */
    idle: (): boolean => inQueue === 0,
    /** Ждёт, когда в очереди никого не останется. */
    whenIdle(): Promise<void> {
      return inQueue === 0 ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

/**
 * Инструменты хода через очередь (FR-049): `execute` инструментов «по очереди» и обычных встаёт в `queue`. Ожидание
 * очереди не съедает срок ответа инструмента: обёртка снаружи предела ожидания. «Стоп» во время ожидания отменяет
 * вызов, не запуская его: в ответе он закрывается текстом «не запускался». Идущий вызов держит очередь до конца
 * или срока инструмента, даже отменённый: порядок инструментов с последствиями важнее скорости. Инструмент с промежуточным выводом
 * (`async function*` в `kindsFrom`) держит очередь до последнего значения. Ни одного инструмента «по очереди» — тот же набор.
 */
export function withSequentialTools(
  tools: ToolSet | undefined,
  options: {
    isSequential: (toolName: string) => boolean;
    queue: ToolQueue;
    /** Исходные инструменты приложения: по ним видно, кто отдаёт промежуточный вывод. Нет — `tools`. */
    kindsFrom?: ToolSet;
  },
): ToolSet | undefined {
  if (!tools || !Object.keys(tools).some((name) => tools[name]!.execute && options.isSequential(name))) return tools;
  const queued: ToolSet = {};
  for (const [name, original] of Object.entries(tools)) {
    const execute = original.execute;
    if (!execute) {
      queued[name] = original;
      continue;
    }
    const sequential = options.isSequential(name);
    type CallOptions = Parameters<typeof execute>[1];
    const enter = async (callOptions: CallOptions) => {
      const place = options.queue.join(sequential);
      try {
        await untilReady(place.ready, callOptions.abortSignal);
      } catch (error) {
        place.leave();
        options.queue.markNotStarted(callOptions.toolCallId);
        throw error;
      }
      // Идущий вызов держит очередь до своего конца даже после отмены: новая попытка не пустит второе «спиши деньги»,
      // пока первое, не слушающее отмену, не кончилось или не упёрлось в срок инструмента (FR-057).
      return place.leave;
    };
    queued[name] = {
      ...original,
      execute: isAsyncGeneratorFunction(options.kindsFrom?.[name]?.execute ?? execute)
        ? async function* (input: unknown, callOptions: CallOptions) {
            const leave = await enter(callOptions);
            try {
              yield* execute(input, callOptions) as AsyncIterable<unknown>;
            } finally {
              leave();
            }
          }
        : async (input: unknown, callOptions: CallOptions) => {
            const leave = await enter(callOptions);
            try {
              const result: unknown = await execute(input, callOptions);
              // Промежуточный вывод без `async function*` заранее не виден: берётся последнее значение.
              return isAsyncIterable(result) ? await lastValue(result) : result;
            } finally {
              leave();
            }
          },
    };
  }
  return queued;
}

/** Ждёт очереди; «Стоп» раньше — отказ с причиной отмены. */
function untilReady(ready: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return ready;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    ready.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

async function lastValue(source: AsyncIterable<unknown>): Promise<unknown> {
  let last: unknown;
  for await (const value of source) last = value;
  return last;
}

export function isAsyncGeneratorFunction(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object AsyncGeneratorFunction]";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof (value as AsyncIterable<unknown> | null)?.[Symbol.asyncIterator] === "function";
}
