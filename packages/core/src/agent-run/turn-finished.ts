import type { FinalAnswerStatus } from "../conversation/types";

/** Ход агента закончен: итог записан в хранилище. Что приложению знать о нём. */
export interface TurnFinished {
  /** Владелец чата: тот, кто задал вопрос. */
  userId: string;
  chatId: string;
  /** Id ответа агента — тот же, что у сообщения в истории и на экране. */
  messageId: string;
  status: FinalAnswerStatus;
  modelId: string;
  /** Провайдер, который ответил: при переходе на запасной — запасной. */
  providerId: string;
}

/** Обработчик приложения «ход закончен». Ход его не ждёт. */
export type TurnFinishedHandler = (turn: TurnFinished) => void | Promise<void>;

/** Зовёт обработчик приложения, не дожидаясь его: бросок или отказ уходит в журнал сервера, ход и дела после него идут дальше. */
export function notifyTurnFinished(handler: TurnFinishedHandler, turn: TurnFinished, logError: (message: string) => void): void {
  const reportFailure = (failure: unknown) =>
    logError(`onTurnFinished упал (чат ${turn.chatId}, ответ ${turn.messageId}): ${failure instanceof Error ? failure.message : String(failure)}`);
  try {
    void Promise.resolve(handler(turn)).catch(reportFailure);
  } catch (failure) {
    reportFailure(failure);
  }
}
