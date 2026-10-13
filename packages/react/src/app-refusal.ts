/** Длиннее экран не показывает: текст отказа — короткая причина, а не страница. */
export const SERVER_REFUSAL_MAX_LENGTH = 300;

/**
 * Чей отказ: `turn_refused` — приложение не пустило ход (`beforeTurn`), `access_refused` — не пустило человека
 * (`resolveUser`), `chat_closed` — чат закрыт, `action_forbidden` — действие запрещено правами чата (`code` — право),
 * `chat_creation_refused` — приложение не дало создать новый чат («Новый чат» в списке).
 */
export type AppRefusalKind = "turn_refused" | "access_refused" | "chat_closed" | "action_forbidden" | "chat_creation_refused";

const APP_REFUSAL_KINDS: ReadonlySet<unknown> = new Set<AppRefusalKind>(["turn_refused", "access_refused", "chat_closed", "action_forbidden", "chat_creation_refused"]);

/** Отказ приложения: код для программы и слова для человека (до 300 знаков). */
export interface AppRefusal {
  kind: AppRefusalKind;
  code: string;
  message: string;
}

/**
 * Отказ приложения из тела ответа: `{ error: { kind, code, message } }`, `kind` — один из `AppRefusalKind`.
 * Статус не важен (403 или 401): вид и слова в теле главнее. `null` — тело другое, без кода или без слов.
 */
export async function appRefusalOf(response: Response): Promise<AppRefusal | null> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof error !== "object" || error === null) return null;
  const { kind, code, message } = error as { kind?: unknown; code?: unknown; message?: unknown };
  if (!APP_REFUSAL_KINDS.has(kind)) return null;
  if (typeof code !== "string" || typeof message !== "string") return null;
  const text = shortenedRefusalText(message);
  return text ? { kind: kind as AppRefusalKind, code, message: text } : null;
}

/** Слова отказа в одну строку, не длиннее `SERVER_REFUSAL_MAX_LENGTH`. */
export function shortenedRefusalText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= SERVER_REFUSAL_MAX_LENGTH ? flat : `${flat.slice(0, SERVER_REFUSAL_MAX_LENGTH - 1).trimEnd()}…`;
}
