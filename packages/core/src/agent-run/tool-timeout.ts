import type { ToolSet } from "ai";
import { resolveTimeoutMs } from "../provider-errors/model-silence";

/** Срок ответа серверного инструмента по умолчанию (FR-045). */
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

/**
 * Настройка `agent.toolTimeoutMs`: срок для всех инструментов или срок по умолчанию и по имени — как у
 * `toolResultMaxLength`. 0 и `Infinity` — без предела: например, инструменту, который сам ждёт ответа человека.
 */
export type ToolTimeoutSetting = number | { default?: number; byTool?: Record<string, number> };

/**
 * Метка срока на объекте инструмента: её ставит `declareToolTimeout`. `Symbol.for` — одна метка у всех копий пакета;
 * копия объекта (`{ ...tool }`) метку сохраняет.
 */
export const TOOL_TIMEOUT_HINT: unique symbol = Symbol.for("@ykurilov/agent-chat.toolTimeoutMs");

/**
 * Инструмент сам объявляет, сколько ему нужно (генерация картинок ждёт провайдера дольше общих 120 с): ядро ждёт
 * его не меньше этого срока, даже если приложение не настроило `agent.toolTimeoutMs`. Свой срок по имени в
 * `byTool` главнее объявленного.
 */
export function declareToolTimeout<T extends object>(tool: T, timeoutMs: number): T {
  (tool as Record<symbol, unknown>)[TOOL_TIMEOUT_HINT] = timeoutMs;
  return tool;
}

function declaredToolTimeout(tool: unknown): number | undefined {
  const value = (tool as Record<symbol, unknown> | null)?.[TOOL_TIMEOUT_HINT];
  return typeof value === "number" && value > 0 ? value : undefined;
}

export interface ResolvedToolTimeout {
  /**
   * Срок ответа инструмента, мс; `Infinity` — без предела. `declaredMs` — срок, объявленный самим инструментом: общий
   * срок короче него не применяется; свой срок по имени в `byTool` главнее.
   */
  forTool(toolName: string, declaredMs?: number): number;
}

/** Проверяет настройку при создании службы. Нет — 120 с всем; неверная — `TypeError` с путём настройки. */
export function resolveToolTimeout(setting: ToolTimeoutSetting | undefined): ResolvedToolTimeout {
  const atLeastDeclared = (fallback: number, declaredMs: number | undefined) => Math.max(fallback, declaredMs ?? 0);
  if (setting === undefined || typeof setting === "number") {
    const all = resolveTimeoutMs(setting, DEFAULT_TOOL_TIMEOUT_MS, "agent.toolTimeoutMs");
    return { forTool: (_toolName, declaredMs) => atLeastDeclared(all, declaredMs) };
  }
  if (!isPlainObject(setting)) throw new TypeError("agent.toolTimeoutMs: ждём число мс или объект { default?, byTool? }");
  if (setting.byTool !== undefined && !isPlainObject(setting.byTool)) {
    throw new TypeError("agent.toolTimeoutMs.byTool: ждём объект «имя инструмента → срок, мс»");
  }
  const fallback = resolveTimeoutMs(setting.default, DEFAULT_TOOL_TIMEOUT_MS, "agent.toolTimeoutMs.default");
  const byTool = new Map(
    Object.entries(setting.byTool ?? {}).map(([name, value]) => [
      name,
      resolveTimeoutMs(value, fallback, `agent.toolTimeoutMs.byTool["${name}"]`),
    ]),
  );
  return { forTool: (toolName, declaredMs) => byTool.get(toolName) ?? atLeastDeclared(fallback, declaredMs) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Что модель и человек узнают о вызове, который не ответил вовремя: действие могло выполниться. */
export const toolTimeoutMessage = (timeoutMs: number) =>
  `Инструмент не ответил за ${Math.max(1, Math.round(timeoutMs / 1000))} с и отменён. Выполнено ли действие, неизвестно; не повторяй его, не проверив`;

/** Серверный инструмент не ответил за срок. */
export class ToolTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(toolTimeoutMessage(timeoutMs));
    this.name = "ToolTimeoutError";
  }
}

/**
 * Предел ожидания серверных инструментов: `execute`, не ответивший за свой срок, получает отмену через `abortSignal`,
 * а вызов закрывается `ToolTimeoutError` — модель видит его текст результатом и продолжает ход. У потока промежуточных
 * результатов срок считается до каждого следующего значения. «Стоп» хода доходит до инструмента как раньше. Срок
 * `Infinity` — инструмент как есть; ни у кого срока нет — те же инструменты. Браузерным инструментам не нужен: у них
 * свой срок ответа вкладки.
 */
export function withToolTimeout(
  tools: ToolSet | undefined,
  options: { timeoutFor: (toolName: string, declaredMs: number | undefined) => number; onTimeout?: (toolName: string, timeoutMs: number) => void },
): ToolSet | undefined {
  const { timeoutFor, onTimeout } = options;
  if (!tools) return tools;
  let changed = false;
  const limited: ToolSet = {};
  for (const [name, original] of Object.entries(tools)) {
    const execute = original.execute;
    const timeoutMs = timeoutFor(name, declaredToolTimeout(original));
    if (execute && Number.isFinite(timeoutMs)) changed = true;
    limited[name] = execute && Number.isFinite(timeoutMs)
      ? {
          ...original,
          execute: (input: unknown, callOptions: Parameters<typeof execute>[1]) => {
            const call = createCallDeadline(timeoutMs, callOptions.abortSignal, () => onTimeout?.(name, timeoutMs));
            let result: unknown;
            try {
              result = execute(input, { ...callOptions, abortSignal: call.signal });
            } catch (error) {
              call.done();
              throw error;
            }
            if (isAsyncIterable(result)) return limitIteration(result, call);
            if (isPromiseLike(result)) return call.race(Promise.resolve(result)).finally(call.done);
            call.done();
            return result;
          },
        }
      : original;
  }
  return changed ? limited : tools;
}

type CallDeadline = ReturnType<typeof createCallDeadline>;

/**
 * Срок одного вызова: свой сигнал отмены (его отменяет и «Стоп» хода, и обрыв попытки) и таймер на каждое ожидание.
 * После отмены срок идёт дальше: инструмент, не слушающий отмену, отпускает вызов (и очередь «по одному») не позже
 * срока — с причиной отмены, без записи «не ответил» в журнал.
 */
function createCallDeadline(timeoutMs: number, turnSignal: AbortSignal | undefined, onTimeout: () => void) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  // «Стоп» или обрыв попытки: отмена — инструменту.
  const onTurnAbort = () => controller.abort(turnSignal?.reason);
  if (turnSignal?.aborted) onTurnAbort();
  else turnSignal?.addEventListener("abort", onTurnAbort, { once: true });
  return {
    signal: controller.signal,
    /** Ждёт `promise`, но не дольше срока: срок вышел — отмена инструменту и отказ `ToolTimeoutError`. */
    race<T>(promise: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        stop();
        timer = setTimeout(() => {
          timer = undefined;
          // Вызов уже отменён: срок только отпускает его, инструменту и журналу сообщать нечего.
          if (controller.signal.aborted) return reject(controller.signal.reason);
          const error = new ToolTimeoutError(timeoutMs);
          onTimeout();
          controller.abort(error);
          reject(error);
        }, timeoutMs);
        // Срок не держит процесс: выключение сервера не ждёт брошенный после «Стопа» вызов.
        timer.unref?.();
        promise.then(
          (value) => {
            stop();
            resolve(value);
          },
          (error: unknown) => {
            stop();
            reject(error);
          },
        );
      });
    },
    done(): void {
      stop();
      turnSignal?.removeEventListener("abort", onTurnAbort);
    },
  };
}

/**
 * Каждое следующее значение — не дольше срока; брошенное и `ToolTimeoutError` уходят тому, кто читает. Чтение
 * кончилось раньше источника (срок, ошибка, читатель закрыл поток сам) — источник закрывается.
 */
async function* limitIteration(source: AsyncIterable<unknown>, call: CallDeadline): AsyncGenerator<unknown> {
  const iterator = source[Symbol.asyncIterator]();
  let sourceDone = false;
  try {
    for (;;) {
      const next = await call.race(Promise.resolve(iterator.next()));
      if (next.done) {
        sourceDone = true;
        return;
      }
      yield next.value;
    }
  } finally {
    call.done();
    // Источник мог так и висеть: закрываем его, не дожидаясь.
    if (!sourceDone) void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof (value as AsyncIterable<unknown> | null)?.[Symbol.asyncIterator] === "function";
}
