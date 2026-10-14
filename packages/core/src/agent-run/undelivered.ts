import { APP_STATE_PART_TYPE } from "../app-state/app-state";
import type { AppStateRecord } from "../app-state/app-state";
import { AGENT_NOTICE_PART_TYPE } from "../notices/agent-notice";

/**
 * Служебный ключ «не доставлено»: `{ [id ответа]: true }` на ветке. Ответ не дошёл до человека (мессенджер отказал,
 * приложение не доставило): он остаётся в истории с пометкой, а модель его не видит — ни сам ответ, ни служебное
 * сообщение, на которое он отвечал. Иначе модель считала бы, что уже это сказала.
 */
export const UNDELIVERED_STATE_KEY = "$undelivered";

type Message = { id: string; role: string; parts: ReadonlyArray<{ type: string; data?: unknown }> };

/** Запись пометки ответов: служебное сообщение состояния в конце ветки. */
export function undeliveredRecord(...messageIds: string[]): AppStateRecord {
  return { set: Object.fromEntries(messageIds.map((id) => [`${UNDELIVERED_STATE_KEY}.${id}`, true])) };
}

/** Помеченные ответы по записям состояния в `messages` (порядок не важен: пометку не снимают). */
export function undeliveredIdsOf(messages: readonly Message[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const prefix = `${UNDELIVERED_STATE_KEY}.`;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== APP_STATE_PART_TYPE) continue;
      const set = (part.data as { set?: unknown } | null | undefined)?.set;
      if (typeof set !== "object" || set === null) continue;
      for (const [path, value] of Object.entries(set)) {
        if (path.startsWith(prefix) && value === true) ids.add(path.slice(prefix.length));
        else if (path === UNDELIVERED_STATE_KEY && typeof value === "object" && value !== null) {
          for (const [id, marked] of Object.entries(value)) if (marked === true) ids.add(id);
        }
      }
    }
  }
  return ids;
}

const isNoticeOnly = (message: Message) =>
  message.role === "user" && message.parts.length > 0 && message.parts.every((part) => part.type === AGENT_NOTICE_PART_TYPE);

/**
 * История без недоставленных ответов и служебных сообщений, на которые они отвечали (сообщение прямо перед ответом из
 * одних служебных частей). Пометок нет — тот же массив: запрос побайтно прежний.
 */
export function withoutUndelivered<M extends Message>(history: readonly M[]): readonly M[] {
  const ids = undeliveredIdsOf(history);
  if (ids.size === 0) return history;
  const dropped = new Set<number>();
  history.forEach((message, index) => {
    if (message.role !== "assistant" || !ids.has(message.id)) return;
    dropped.add(index);
    const before = history[index - 1];
    if (before && isNoticeOnly(before)) dropped.add(index - 1);
  });
  return dropped.size === 0 ? history : history.filter((_, index) => !dropped.has(index));
}
