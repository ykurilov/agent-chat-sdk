/** Вид отказа: по нему журнал и экран понимают, что случилось, а модель получает понятный текст. */
export type McpErrorKind =
  | "bad_input"
  | "bad_address"
  | "unavailable"
  | "timeout"
  | "too_large"
  | "tool_error"
  | "not_allowed"
  | "limit"
  | "not_found";

/** Ошибка пакета: текст без секретов, его можно показать модели, админу и в журнале. */
export class McpError extends Error {
  readonly kind: McpErrorKind;

  constructor(kind: McpErrorKind, message: string) {
    super(message);
    this.name = "McpError";
    this.kind = kind;
  }
}

/** Ищет `McpError` в цепочке причин: клиент MCP заворачивает ошибку `fetch` в свою. */
export function findMcpError(error: unknown): McpError | undefined {
  for (let current = error, depth = 0; current && depth < 8; depth++) {
    if (current instanceof McpError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
