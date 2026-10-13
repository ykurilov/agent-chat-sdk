import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AgentChatMessage, AnswerStatus } from "./chat-types";

/** Ответ, под которым решается, показывать ли кнопку. */
export interface MessageActionTarget {
  message: AgentChatMessage;
  /** Итог ответа: пока ответ пишется, кнопок нет, и `visible` не зовётся. */
  status: Exclude<AnswerStatus, "streaming">;
  /** Последний ответ ветки. */
  last: boolean;
}

/** Что получает обработчик кнопки. */
export interface MessageActionContext {
  chatId: string;
  /** Id ответа — тот же, что в истории на сервере и в `onTurnFinished`. */
  messageId: string;
  message: AgentChatMessage;
  /** Текст ответа, как его копирует «Скопировать». */
  text: string;
}

/**
 * Своя кнопка приложения под ответом агента. Иконку даёт приложение готовым элементом (`<Heart />`): слой поведения и
 * скин дизайн-систему приложения не знают. Массив кнопок держите постоянным (вне компонента или в `useMemo`):
 * новый массив на каждой отрисовке перерисовывает все ответы ленты.
 */
export interface MessageAction {
  /** Постоянный и уникальный среди кнопок. */
  id: string;
  /** Подпись: текст кнопки или подсказка и `aria-label` у кнопки с одной иконкой. */
  label: string;
  icon?: ReactNode;
  /** Показывать ли кнопку у этого ответа. Нет — у каждого законченного ответа. */
  visible?: (target: MessageActionTarget) => boolean;
  /** Пока обещание не выполнено, кнопка «занята». Ошибка уходит в консоль, а не в чат. */
  onRun: (context: MessageActionContext) => void | Promise<void>;
}

/** Id кнопок, чьи обработчики ещё идут, по id ответа. Список ответа меняется, только когда меняются его кнопки. */
export type RunningMessageActions = ReadonlyMap<string, readonly string[]>;

/**
 * Запуск своих кнопок ответа: двойное нажатие не запускает обработчик второй раз, пока первый идёт; сбой обработчика
 * уходит в консоль.
 */
export function useMessageActionRuns(chatId: string): {
  running: RunningMessageActions;
  run: (action: MessageAction, message: AgentChatMessage, text: string) => void;
} {
  const [running, setRunning] = useState<RunningMessageActions>(() => new Map());
  const runningRef = useRef(new Set<string>());

  const run = useCallback(
    (action: MessageAction, message: AgentChatMessage, text: string) => {
      const key = `${message.id}\n${action.id}`;
      if (runningRef.current.has(key)) return;
      let result: void | Promise<void>;
      try {
        result = action.onRun({ chatId, messageId: message.id, message, text });
      } catch (error) {
        console.error(error);
        return;
      }
      if (!isPromiseLike(result)) return;
      runningRef.current.add(key);
      setRunning((current) => withRunning(current, message.id, action.id, true));
      void Promise.resolve(result)
        .catch((error: unknown) => console.error(error))
        .finally(() => {
          runningRef.current.delete(key);
          setRunning((current) => withRunning(current, message.id, action.id, false));
        });
    },
    [chatId],
  );

  // Лента перерисовывает ответы, только когда меняется то, что они рисуют.
  return useMemo(() => ({ running, run }), [running, run]);
}

function withRunning(current: RunningMessageActions, messageId: string, actionId: string, on: boolean): RunningMessageActions {
  const ids = current.get(messageId) ?? [];
  const next = new Map(current);
  const changed = on ? [...ids, actionId] : ids.filter((id) => id !== actionId);
  if (changed.length > 0) next.set(messageId, changed);
  else next.delete(messageId);
  return next;
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
