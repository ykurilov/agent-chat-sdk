import { JSONParseError, TypeValidationError } from "ai";

const MAX_PIECE = 30;
const MAX_ISSUES = 3;
const MAX_ISSUE_LENGTH = 120;
const RETRY_NOTE = "пришли вызов заново";

/**
 * Короткое сообщение модели о вызове, который не удалось ни разобрать, ни починить (1–2 строки).
 * Вместо ошибки SDK, где аргументы повторены целиком: для JSON — что за знак и около какой позиции, с куском текста;
 * для схемы — какие поля не так. Самих аргументов в тексте почти нет: только кусок до 30 знаков.
 */
export function describeUnreadableToolInput(error: unknown, input: string): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (JSONParseError.isInstance(cause)) return describeBrokenJson(cause, input);
  if (TypeValidationError.isInstance(cause)) return describeSchemaMismatch(cause);
  return `аргументы не подходят инструменту; ${RETRY_NOTE}`;
}

function describeBrokenJson(error: JSONParseError, input: string): string {
  const reason = error.cause instanceof Error ? error.cause.message : "";
  const position = /position (\d+)/.exec(reason)?.[1];
  if (position === undefined) {
    return `аргументы не разбираются как JSON: текст оборван на позиции ${input.length} (…${piece(input, input.length)}); ${RETRY_NOTE}`;
  }
  const at = Number(position);
  const char = input[at];
  const what = char === "}" || char === "]" ? `лишняя \`${char}\`` : "ошибка";
  return `аргументы не разбираются как JSON: ${what} около позиции ${at} (…${piece(input, at)}…); ${RETRY_NOTE}`;
}

/** Кусок текста вокруг позиции, в одну строку. */
function piece(input: string, at: number): string {
  const start = Math.max(0, at - MAX_PIECE / 2);
  return JSON.stringify(input.slice(start, start + MAX_PIECE)).slice(1, -1);
}

function describeSchemaMismatch(error: TypeValidationError): string {
  const issues = (error.cause as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    const text = error.cause instanceof Error ? error.cause.message : "не подходят по схеме";
    return `аргументы не подходят по схеме: ${text.slice(0, MAX_ISSUE_LENGTH)}; ${RETRY_NOTE}`;
  }
  const listed = issues.slice(0, MAX_ISSUES).map(describeIssue).join("; ");
  const rest = issues.length > MAX_ISSUES ? ` (и ещё ${issues.length - MAX_ISSUES})` : "";
  return `аргументы не подходят по схеме — ${listed}${rest}; ${RETRY_NOTE}, поправив эти поля`;
}

function describeIssue(issue: unknown): string {
  const { path, message } = issue as { path?: unknown; message?: unknown };
  const where = Array.isArray(path) && path.length > 0 ? path.join(".") : "аргументы";
  return `${where}: ${String(message ?? "неверное значение").slice(0, MAX_ISSUE_LENGTH)}`;
}
