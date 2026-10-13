import { normalizeChatClosure } from "../access/chat-closure";
import type { ChatClosure } from "../access/chat-closure";

/**
 * Просьба инструментов закрыть чат. Запись в ответ (`write`) и копия для списка (`record`) — сразу при вызове: сервер
 * упадёт посреди хода — чат после восстановления всё равно закрыт. Событие и кусок потока — после записи итога хода.
 */
export interface ChatClosureRequest {
  /** Закрыть чат; повторная просьба заменяет прежнюю. Неверный код — `TypeError`; после `close` — только журнал. */
  request(closure: ChatClosure): void;
  /** Ход кончился: дальше просьбы не принимаются. Возвращает последнюю просьбу хода. */
  close(): ChatClosure | undefined;
  /** Записи копии, начатые просьбами, закончились (сбой — строка в журнал). */
  recorded(): Promise<void>;
}

export function createChatClosureRequest(context: {
  logError: (message: string) => void;
  chatId: string;
  /** Записать закрытие в ответ хода — сразу, в порядке просьб. */
  write?: (closure: ChatClosure) => void;
  /** Записать копию закрытия без события. Нет — копия пишется только в конце хода. */
  record?: (closure: ChatClosure) => Promise<void>;
}): ChatClosureRequest {
  let closed = false;
  let requested: ChatClosure | undefined;
  // Записи идут по очереди: последняя просьба хода записывается последней.
  let recording: Promise<void> = Promise.resolve();
  return {
    request(closure) {
      const checked = normalizeChatClosure(closure);
      if (closed) {
        context.logError(`Инструмент позвал closeChat («${checked.code}») после конца хода в чате ${context.chatId}: чат не закрыт`);
        return;
      }
      requested = checked;
      context.write?.(checked);
      const { record } = context;
      if (!record) return;
      recording = recording.then(() =>
        record(checked).catch((failure: unknown) =>
          context.logError(`Закрытие чата ${context.chatId} не записалось при вызове closeChat: ${failure instanceof Error ? failure.message : String(failure)}`),
        ),
      );
    },
    close() {
      closed = true;
      return requested;
    },
    recorded: () => recording,
  };
}
