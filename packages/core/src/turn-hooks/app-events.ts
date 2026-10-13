import type { UIMessageChunk } from "ai";
import { validateAppEvent } from "./turn-hooks";
import type { AppEvent } from "./turn-hooks";

/**
 * Часть ответа с событием приложения: `{ type: "data-app-event", data: AppEvent }`. Хранится в ответе и идёт в поток,
 * модели не отправляется, мессенджеру текстом не уходит. На экране её рисует компонент приложения по `event.type`.
 */
export const APP_EVENT_PART_TYPE = "data-app-event" as const;

/**
 * Начало `id` у части события, скопированной из прежнего ответа («Повторить» продолжает с выполненных шагов): событие
 * уже сработало там, страница показывает его, но живым (`live: true`) не считает. У своих событий хода `id` нет.
 */
export const COPIED_APP_EVENT_ID_PREFIX = "copied:";

/**
 * Части, скопированные из ответа `sourceMessageId`, с пометкой событий: `id` = `copied:<ответ>:<номер части>`. Уже
 * помеченные (копия копии) не меняются. Модели `id` не уходит: запрос тот же.
 */
export function markedAsCopiedAppEvents<Part extends { type: string }>(parts: Part[], sourceMessageId: string): Part[] {
  return parts.map((part, index) =>
    part.type === APP_EVENT_PART_TYPE && !(part as { id?: string }).id ? { ...part, id: `${COPIED_APP_EVENT_ID_PREFIX}${sourceMessageId}:${index}` } : part,
  );
}

/** События приложения от инструментов одного хода. */
export interface AppEventEmitter {
  /** Кладёт событие в ответ: часть пишется и сразу уходит в поток. Неверная форма — `TypeError`; после `close` — только запись в журнал. */
  emit(event: AppEvent): void;
  /** Ход кончился: дальше события в ответ не попадают. */
  close(): void;
}

export function createAppEventEmitter(context: {
  /** Кусок в запись ответа и клиенту. */
  emit: (chunk: UIMessageChunk) => void;
  logError: (message: string) => void;
  chatId: string;
}): AppEventEmitter {
  let closed = false;
  return {
    emit(event) {
      const checked = validateAppEvent(event);
      if (closed) {
        context.logError(`Инструмент положил событие приложения «${checked.type}» после конца хода в чате ${context.chatId}: событие не записано`);
        return;
      }
      context.emit({ type: APP_EVENT_PART_TYPE, data: checked });
    },
    close() {
      closed = true;
    },
  };
}
