import { appRefusalOf, shortenedRefusalText } from "./app-refusal";
import type { AppRefusalKind } from "./app-refusal";

/**
 * Отказ сервера 4xx с понятным человеку текстом. `final` — повтор того же запроса снова получит отказ.
 * `kind` и `code` есть, когда отказало само приложение (`beforeTurn` или `resolveUser`).
 */
export interface ServerRefusal {
  text: string;
  final: boolean;
  kind?: AppRefusalKind;
  code?: string;
}

/** 4xx, после которых повтор имеет смысл: истёк срок запроса, сервер просит подождать. */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

/**
 * Текст отказа из тела 4xx: `{ error: "…" }` обёрток приложения или `{ error: { message: "…" } }`.
 * `null` — не 4xx, вход истёк (401), тела нет, оно не JSON или текста в нём нет: показывается общая надпись.
 */
export async function serverRefusalOf(response: Response): Promise<ServerRefusal | null> {
  if (response.status < 400 || response.status >= 500) return null;
  // Приложение отказало своими словами — окончательно, даже если это 401: вход тут ни при чём.
  const app = await appRefusalOf(response);
  if (app) return { text: app.message, final: true, kind: app.kind, code: app.code };
  if (response.status === 401) return null;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  const text = shortenedRefusalText(refusalTextOf(body));
  return text ? { text, final: !RETRYABLE_STATUSES.has(response.status) } : null;
}

function refusalTextOf(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}
