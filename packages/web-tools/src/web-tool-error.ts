export type WebToolErrorKind =
  | "bad_address"
  | "bad_query"
  | "invalid_key"
  | "insufficient_funds"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "bad_response";

/**
 * Ошибка веб-инструмента. Текст по-русски показывается и модели, и человеку в строке вызова,
 * поэтому в нём нет ключа, адреса сервиса и заголовков.
 */
export class WebToolError extends Error {
  readonly kind: WebToolErrorKind;

  constructor(kind: WebToolErrorKind, message: string) {
    super(message);
    this.name = "WebToolError";
    this.kind = kind;
  }
}

export const serviceFailureMessages = {
  invalid_key: "Сервис веб-инструментов отклонил ключ доступа.",
  insufficient_funds: "На счёте сервиса веб-инструментов закончились средства.",
  rate_limited: "Превышен лимит запросов сервиса веб-инструментов, попробуйте позже.",
  unavailable: "Сервис веб-инструментов сейчас недоступен, попробуйте позже.",
  timeout: "Сервис веб-инструментов не ответил вовремя.",
  bad_response: "Сервис веб-инструментов вернул неожиданный ответ.",
} as const;

export function serviceFailure(kind: keyof typeof serviceFailureMessages): WebToolError {
  return new WebToolError(kind, serviceFailureMessages[kind]);
}
