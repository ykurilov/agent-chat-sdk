import { InvalidToolInputError, NoSuchToolError } from "ai";
import type { ToolSet } from "ai";
import { scrubSecrets } from "../text/scrub-secrets";
import { cutToolResult, resolveToolResultLimit } from "./tool-result-limit";
import type { ResolvedToolResultLimit } from "./tool-result-limit";

/**
 * Отличает ошибки инструментов приложения от ошибок провайдера. SDK пропускает те и другие
 * через один `onError` UI-потока: текст ошибки инструмента нужен в строке вызова (US2-3),
 * а сырой текст провайдера наружу не идёт.
 */
export interface ToolErrorTracker {
  /** Те же инструменты; брошенные ими ошибки запоминаются. */
  tools: ToolSet;
  /** Текст ошибки для UI-потока: у ошибок инструментов — их сообщение, у прочих — `describeOther`. */
  describe(error: unknown, describeOther?: (error: unknown) => string): string;
}

export interface ToolErrorTrackerOptions {
  /** Предел результата инструмента; без него — 50 000 знаков. */
  limit?: ResolvedToolResultLimit;
  /** Вызывается, когда результат обрезан: имя инструмента и полная длина (без содержимого). */
  onCut?: (toolName: string, length: number) => void;
  /** Известные секреты (ключи провайдеров из окружения): вычищаются из текста ошибки вместе с паролями и токенами. */
  secrets?: readonly string[];
}

export function trackToolErrors(tools: ToolSet | undefined, options: ToolErrorTrackerOptions = {}): ToolErrorTracker {
  const { limit = resolveToolResultLimit(undefined), onCut, secrets = [] } = options;
  const thrownByTools = new WeakSet<object>();
  const scrub = (text: string) => scrubSecrets(text, secrets);

  // Текст ошибки чистится сразу: он идёт и человеку, и в базу, и модели на следующем шаге.
  function remember(error: unknown): never {
    const marked = withoutSecrets(typeof error === "object" && error !== null ? error : new Error(String(error)), scrub);
    thrownByTools.add(marked);
    throw marked;
  }

  const tracked: ToolSet = {};
  for (const [name, original] of Object.entries(tools ?? {})) {
    const execute = original.execute;
    // У инструментов с `toModelOutput` модель видит не сам результат, а то, что вернёт он: картинка не режется.
    const maxLength = original.toModelOutput ? undefined : limit.forTool(name);
    const limited = (output: unknown): { output: unknown; cutFrom?: number } => {
      if (maxLength === undefined) return { output };
      const cut = cutToolResult(output, maxLength);
      return cut.cut ? { output: cut.text, cutFrom: cut.length } : { output };
    };
    const reportCut = (cutFrom: number | undefined) => {
      if (cutFrom !== undefined) onCut?.(name, cutFrom);
    };
    tracked[name] = execute
      ? {
          ...original,
          execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
            // Результат отдаётся того же вида: обещание, поток частичных результатов или значение.
            let result: unknown;
            try {
              result = execute(input, options);
            } catch (error) {
              return remember(error);
            }
            if (isAsyncIterable(result)) return limitIterationResults(result, limited, reportCut, remember);
            if (isPromiseLike(result)) {
              return Promise.resolve(result).then((value) => {
                const { output, cutFrom } = limited(value);
                reportCut(cutFrom);
                return output;
              }, remember);
            }
            const { output, cutFrom } = limited(result);
            reportCut(cutFrom);
            return output;
          },
        }
      : original;
  }

  return {
    tools: tracked,
    describe(error, describeOther = () => "other") {
      const fromTool = typeof error === "object" && error !== null && thrownByTools.has(error);
      const badCall = InvalidToolInputError.isInstance(error) || NoSuchToolError.isInstance(error);
      if ((fromTool || badCall) && error instanceof Error && error.message) return scrub(error.message);
      return describeOther(error);
    },
  };
}

/** Та же ошибка с вычищенными сообщением и стеком; не вышло поменять — новая `Error` с чистым текстом. */
function withoutSecrets(error: object, scrub: (text: string) => string, depth = 0): object {
  if (!(error instanceof Error)) return error;
  const message = scrub(error.message);
  const stack = typeof error.stack === "string" ? scrub(error.stack) : error.stack;
  // Причина тоже может попасть в журнал приложения: чистится на пару уровней вглубь.
  const cause = typeof error.cause === "string" ? scrub(error.cause) : error.cause instanceof Error && depth < 3 ? withoutSecrets(error.cause, scrub, depth + 1) : error.cause;
  if (message === error.message && stack === error.stack && cause === error.cause) return error;
  try {
    error.message = message;
    error.stack = stack;
    if (cause !== error.cause) error.cause = cause;
    return error;
  } catch {
    const clean = new Error(message, { cause });
    clean.name = error.name;
    return clean;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof (value as AsyncIterable<unknown> | null)?.[Symbol.asyncIterator] === "function";
}

/** Промежуточные результаты режутся каждый; в журнал идёт только обрезка последнего значения. */
async function* limitIterationResults(
  source: AsyncIterable<unknown>,
  limited: (output: unknown) => { output: unknown; cutFrom?: number },
  reportCut: (cutFrom: number | undefined) => void,
  remember: (error: unknown) => never,
): AsyncGenerator<unknown> {
  let lastCutFrom: number | undefined;
  try {
    for await (const value of source) {
      const { output, cutFrom } = limited(value);
      lastCutFrom = cutFrom;
      yield output;
    }
  } catch (error) {
    remember(error);
  }
  reportCut(lastCutFrom);
}
