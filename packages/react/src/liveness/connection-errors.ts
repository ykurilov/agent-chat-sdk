/**
 * Свои ошибки связи. Имя у них не `TypeError` и не `AbortError`: SDK чата принимает сетевой
 * `TypeError` за «обрыв, можно продолжить с места» и удвоит части ответа, а `AbortError` — за «стоп».
 */

/** Сеть отказала, соединение оборвалось или вышел срок запроса. */
export class ConnectionLostError extends Error {
  constructor(message = "Connection to the server lost", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConnectionLostError";
  }
}

/** Сервер слишком долго не присылал ни байта. */
export class ConnectionSilentError extends Error {
  constructor(silenceMs?: number) {
    super(silenceMs === undefined ? "Server is silent" : `Server has been silent for ${silenceMs} ms`);
    this.name = "ConnectionSilentError";
  }
}

export function isConnectionError(error: unknown): error is ConnectionLostError | ConnectionSilentError {
  return error instanceof ConnectionLostError || error instanceof ConnectionSilentError;
}
