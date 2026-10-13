import { WebToolError, serviceFailure } from "./web-tool-error";

/**
 * Вызов сервиса из инструмента. Ошибки своей реализации сервиса (не `WebToolError`) наружу не идут:
 * в их тексте могут оказаться ключ или адрес. Остановка хода проходит как есть.
 */
export async function callService<Result>(signal: AbortSignal | undefined, call: () => Promise<Result>): Promise<Result> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof WebToolError || signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw serviceFailure("unavailable");
  }
}
