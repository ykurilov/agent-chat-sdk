import { ChatClosedError } from "../access/chat-closure";
import type { Chat } from "../conversation/types";
import { ChatBusyError } from "../running-answers/running-answer-registry";
import { TooManyTurnsError } from "../running-answers/turn-slots";
import { SpendingLimitReachedError } from "../spending/spending-limits";
import { DuplicateMessageError } from "../storage/chat-storage";
import { TurnRefusedError } from "./turn-hooks";
import type { AbandonedAnswers, BeforeTurnHandler, TurnAction, TurnNotStartedHandler, TurnNotStartedReason } from "./turn-hooks";

export interface TurnGateInput extends AbandonedAnswers {
  userId: string;
  chat: Chat;
  action: TurnAction;
  text?: string;
  /** Id сообщения человека (`send`, `edit`). */
  messageId?: string;
}

/**
 * Проверка приложения перед ходом: пускает или отказывает до любой записи. Каждый пропуск закрывается ровно одним:
 * начатым ходом или `turnNotStarted`.
 */
export interface TurnGate {
  /**
   * Отказ приложения — `TurnRefusedError`, исключение приложения идёт наружу как есть: `work` не зовётся. Пропуск —
   * `work`, который начинает ход. Бросил — `turnNotStarted` с причиной по ошибке, ошибка наружу прежняя. Вернул без
   * хода (`notStartedBecause(result)` дал причину) — `turnNotStarted` с ней. Нет хука — только `work`.
   */
  admit<T>(input: TurnGateInput, work: () => Promise<T>, notStartedBecause?: (result: T) => TurnNotStartedReason | undefined): Promise<T>;
  /**
   * Для служебных ходов без человека: как `admit`, но отказ — `skip()` (сообщение пишется без хода) вместо
   * `TurnRefusedError`. `beforeTurn` зовётся один раз.
   */
  admitOrSkip<T>(
    input: TurnGateInput,
    work: () => Promise<T>,
    skip: () => Promise<T>,
    notStartedBecause?: (result: T) => TurnNotStartedReason | undefined,
  ): Promise<T>;
  /** Пропущенный ход не начнётся: `turnNotStarted`. Не бросает: сбой хука — в журнал. */
  notStarted(input: TurnGateInput, reason: TurnNotStartedReason): Promise<void>;
}

/**
 * Неверный отказ (код не по правилам, текст не строка) — ошибка приложения: ход не начат, строка в журнал,
 * наружу — `TypeError`, а не отказ человеку. `isInvalidRequest` — ошибки неверного запроса службы (сообщение, файл,
 * решение): они объявлены в службе, гейт их не знает.
 */
export function createTurnGate(hooks: {
  beforeTurn: BeforeTurnHandler | undefined;
  turnNotStarted: TurnNotStartedHandler | undefined;
  isInvalidRequest: (error: unknown) => boolean;
  /** Ошибка после начала хода (ход закроет `afterTurn`): `turnNotStarted` на неё не зовётся. */
  isStartedTurn: (error: unknown) => boolean;
  logError: (message: string) => void;
}): TurnGate {
  const { beforeTurn, turnNotStarted, isInvalidRequest, isStartedTurn, logError } = hooks;

  async function refusalOf(input: TurnGateInput): Promise<TurnRefusedError | undefined> {
    if (!beforeTurn) return undefined;
    const refusal = await beforeTurn({
      userId: input.userId,
      chat: input.chat,
      action: input.action,
      ...(input.text !== undefined && { text: input.text }),
      ...(input.messageId !== undefined && { messageId: input.messageId }),
      ...abandonedOf(input),
    });
    if (!refusal) return undefined;
    try {
      return new TurnRefusedError(refusal);
    } catch (error) {
      logError(`beforeTurn вернул неверный отказ (чат ${input.chat.id}, действие ${input.action}): ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async function notStarted(input: TurnGateInput, reason: TurnNotStartedReason): Promise<void> {
    if (!turnNotStarted) return;
    try {
      await turnNotStarted({
        userId: input.userId,
        chat: input.chat,
        action: input.action,
        ...(input.messageId !== undefined && { messageId: input.messageId }),
        ...(input.text !== undefined && { text: input.text }),
        reason,
        ...abandonedOf(input),
      });
    } catch (error) {
      logError(`turnNotStarted упал (чат ${input.chat.id}, действие ${input.action}, причина ${reason}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function reasonOf(error: unknown): TurnNotStartedReason {
    if (error instanceof ChatBusyError) return "busy";
    if (error instanceof TooManyTurnsError) return "too_many_turns";
    if (error instanceof SpendingLimitReachedError) return "spending_limit";
    if (error instanceof DuplicateMessageError) return "duplicate_message";
    if (error instanceof ChatClosedError) return "chat_closed";
    if (isInvalidRequest(error)) return "invalid";
    return "error";
  }

  /** Пропущенная работа: не начала ход — `turnNotStarted`. */
  async function passed<T>(input: TurnGateInput, work: () => Promise<T>, notStartedBecause?: (result: T) => TurnNotStartedReason | undefined): Promise<T> {
    // Без хука закрывать нечего: работа идёт как раньше.
    if (!turnNotStarted) return work();
    let result: T;
    try {
      result = await work();
    } catch (error) {
      if (!isStartedTurn(error)) await notStarted(input, reasonOf(error));
      throw error;
    }
    const reason = notStartedBecause?.(result);
    if (reason) await notStarted(input, reason);
    return result;
  }

  return {
    async admit(input, work, notStartedBecause) {
      const refused = await refusalOf(input);
      if (refused) throw refused;
      return passed(input, work, notStartedBecause);
    },
    async admitOrSkip(input, work, skip, notStartedBecause) {
      return (await refusalOf(input)) ? skip() : passed(input, work, notStartedBecause);
    },
    notStarted,
  };
}

/** Поля ушедших ответов копиями: правка хука не доходит до другого хука. */
function abandonedOf(input: AbandonedAnswers): AbandonedAnswers {
  return {
    ...(input.abandonedAnswerIds && { abandonedAnswerIds: [...input.abandonedAnswerIds] }),
    ...(input.previousAnswerId !== undefined && { previousAnswerId: input.previousAnswerId }),
  };
}
