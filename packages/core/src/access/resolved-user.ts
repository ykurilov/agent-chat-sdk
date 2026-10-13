import { normalizeTurnRefusal } from "../turn-hooks/turn-hooks";

/** Отказ приложения человеку в доступе: код для программы, текст для человека, HTTP-статус (по умолчанию 403). */
export interface AccessRefusal {
  /** Латиница в нижнем регистре, цифры и `.`, `_`, `-`; от 1 до 64 знаков. */
  code: string;
  /** До 300 знаков; длиннее — обрезается. */
  message: string;
  status?: 401 | 403;
}

/** Ответ `resolveUser`: человек, отказ в доступе со своими словами или `null` (не вошёл — 401 `invalid`). */
export type ResolvedUser = { id: string } | { refused: AccessRefusal } | null;

/** Человек, которого пустили; для остальных видов ответа — `null`. */
export function allowedUser(resolved: ResolvedUser): { id: string } | null {
  return resolved && "id" in resolved ? resolved : null;
}

/**
 * Ответ на отказ в доступе: `{ error: { kind: "access_refused", code, message } }`; `headers` — свои заголовки ответа
 * (например, `Cache-Control: no-store`). Неверный код — `TypeError`: это ошибка приложения, обработчик отвечает
 * 500 `other` и пишет строку в журнал. `null` — отказа нет.
 */
export function accessRefusedResponse(resolved: ResolvedUser, headers?: Record<string, string>): Response | null {
  if (!resolved || !("refused" in resolved)) return null;
  const { code, message } = normalizeTurnRefusal(resolved.refused);
  const status = resolved.refused.status === 401 ? 401 : 403;
  return Response.json({ error: { kind: "access_refused", code, message } }, { status, ...(headers && { headers }) });
}
