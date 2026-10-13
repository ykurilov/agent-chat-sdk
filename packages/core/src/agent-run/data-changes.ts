import type { UIMessageChunk } from "ai";
import { APP_CHANGE_PART_TYPE } from "../page-context/page-context";
import type { DataChange } from "../page-context/page-context";

const MAX_TAG_LENGTH = 100;
/** Подробности изменения: больше этого в JSON — ошибка инструмента. */
const MAX_DETAILS_BYTES = 4096;

export interface DataChangeNotifier {
  /** Шлёт временный кусок «данные изменены» сразу. Неверная форма — `TypeError`; после `close` — только запись в журнал. */
  notify(change: DataChange): void;
  /** Ход кончился: дальше сообщения не уходят. */
  close(): void;
}

/** Сообщения инструментов об изменении данных одного хода: в хранилище не попадают, идут только в поток ответа. */
export function createDataChangeNotifier(context: {
  emit: (chunk: UIMessageChunk) => void;
  logError: (message: string) => void;
  chatId: string;
}): DataChangeNotifier {
  let closed = false;
  return {
    notify(change) {
      const checked = checkedChange(change);
      if (closed) {
        context.logError(`Инструмент сообщил об изменении данных «${checked.tag}» после конца хода в чате ${context.chatId}: сообщение не отправлено`);
        return;
      }
      context.emit({
        type: APP_CHANGE_PART_TYPE,
        id: crypto.randomUUID(),
        data: { tag: checked.tag, ...(checked.details !== undefined && { details: checked.details }) },
        transient: true,
      });
    },
    close() {
      closed = true;
    },
  };
}

function checkedChange(change: unknown): DataChange {
  if (typeof change !== "object" || change === null || Array.isArray(change)) {
    throw new TypeError("notifyDataChanged: нужен объект { tag, details? }");
  }
  const { tag, details } = change as { tag?: unknown; details?: unknown };
  if (typeof tag !== "string" || tag.length < 1 || tag.length > MAX_TAG_LENGTH) {
    throw new TypeError(`notifyDataChanged: tag — строка от 1 до ${MAX_TAG_LENGTH} знаков`);
  }
  if (details !== undefined) {
    let json: string | undefined;
    try {
      json = JSON.stringify(details);
    } catch {
      throw new TypeError("notifyDataChanged: details должны быть JSON");
    }
    if (json === undefined) throw new TypeError("notifyDataChanged: details должны быть JSON");
    if (new TextEncoder().encode(json).length > MAX_DETAILS_BYTES) {
      throw new TypeError(`notifyDataChanged: details больше ${MAX_DETAILS_BYTES} байт`);
    }
  }
  return { tag, ...(details !== undefined && { details }) };
}
