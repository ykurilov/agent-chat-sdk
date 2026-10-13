import { normalizeTurnRefusal, SUBJECT_KEY_MAX_LENGTH } from "@ykurilov/agent-chat-core";
import type { ChatGreeting, ChatService, TurnRefusal } from "@ykurilov/agent-chat-core";
import { readJsonBody } from "./request-body";

/** Что приложение отдаёт для чата объекта: данные (только для сервера), название и приветствие нового чата. */
export interface SubjectChatSettings {
  /** JSON-объект до 16 КБ: инструментам и хукам на сервере, в браузер не уходит. Пишется только при создании чата. */
  data?: Record<string, unknown>;
  /** Название нового чата; нет — из первого сообщения человека. */
  title?: string;
  /** Первое сообщение от агента в новом чате. */
  greeting?: ChatGreeting;
}

/**
 * Решение приложения о чате объекта: настройки или отказ `{ code, message }` (человеку нельзя в этот объект). Отказ
 * узнаётся по полю `code`.
 */
export type SubjectChatsResolver = (input: { user: { id: string }; key: string; request: Request }) => Promise<SubjectChatSettings | TurnRefusal>;

/** Отказ приложения ответом 403 `turn_refused`: код и текст безопасно показать человеку. */
export function turnRefusalResponse(refusal: TurnRefusal): Response {
  const { code, message } = normalizeTurnRefusal(refusal);
  return Response.json({ error: { kind: "turn_refused", code, message } }, { status: 403 });
}

/** `POST {base}/subject { key }` → `{ id, created }`: найти или создать чат объекта человека. */
export async function openSubjectChatRoute(input: {
  request: Request;
  userId: string;
  service: Pick<ChatService, "openSubjectChat">;
  resolve: SubjectChatsResolver;
  invalid: () => Response;
}): Promise<Response> {
  const key = ((await readJsonBody(input.request)) as { key?: unknown } | null)?.key;
  if (typeof key !== "string" || key.length === 0 || key.length > SUBJECT_KEY_MAX_LENGTH) return input.invalid();
  const settings = await input.resolve({ user: { id: input.userId }, key, request: input.request });
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    // Ошибка приложения, а не человека: обработчик ответит 500 и запишет текст в журнал.
    throw new TypeError(`subjectChats должен вернуть объект настроек или отказ { code, message }, а вернул ${settings === null ? "null" : Array.isArray(settings) ? "массив" : typeof settings}.`);
  }
  if ("code" in settings) return turnRefusalResponse(settings);
  const { chat, created } = await input.service.openSubjectChat({ ownerId: input.userId, key, ...settings });
  return Response.json({ id: chat.id, created });
}
