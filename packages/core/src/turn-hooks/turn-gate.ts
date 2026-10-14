import { ChatClosedError } from "../access/chat-closure";
import type { Chat } from "../conversation/types";
import { ChatBusyError } from "../running-answers/running-answer-registry";
import { TooManyTurnsError } from "../running-answers/turn-slots";
import { SpendingLimitReachedError } from "../spending/spending-limits";
import { DuplicateMessageError } from "../storage/chat-storage";
import { TurnRefusedError } from "./turn-hooks";
import type { AbandonedAnswers, BeforeTurnHandler, TurnAction, TurnNotStartedHandler, TurnNotStartedReason, TurnRefusal } from "./turn-hooks";

const TURN: TurnPass = { kind: "turn" };

export interface TurnGateInput extends AbandonedAnswers {
  userId: string;
  chat: Chat;
  action: TurnAction;
  text?: string;
  /** Id сообщения человека (`send`, `edit`). */
  messageId?: string;
  /** Ход на пачку сообщений (`sendBurstMessage`): их id по порядку, последнее — `messageId`. */
  burstMessageIds?: string[];
}

/**
 * С чем пропущен ход: обычный ход модели, «записать и промолчать» (`hold`) или готовый текст без модели (`reply`).
 * `hold` и `reply` — решения приложения, а не пропуск: `turnNotStarted` на `hold` не зовётся.
 */
export type TurnPass = { kind: "turn" } | { kind: "hold" } | { kind: "reply"; text: string };

/** Готовый текст пропуска: только у `reply`. */
export const replyOf = (pass: TurnPass): string | undefined => (pass.kind === "reply" ? pass.text : undefined);

/** Временный кусок потока: сообщение записано, агент ответит позже (`{ hold: true }`). В истории его нет. */
export const TURN_HELD_PART_TYPE = "data-turn-held";

/** `hold` для действий, где записывать нечего, и `reply` там, где ответу некуда встать, — отказ с этим кодом. */
export const TURN_HELD_CODE = "turn_held";
const TURN_HELD_MESSAGE = "Агент ответит позже.";

/** Где `beforeTurn` может сказать «записать и промолчать»: есть новое сообщение. */
const HOLD_ACTIONS: ReadonlySet<TurnAction> = new Set(["send", "edit", "notice"]);
/** Где возможен готовый текст: ход начинает новый ответ. */
const REPLY_ACTIONS: ReadonlySet<TurnAction> = new Set(["send", "edit", "regenerate", "retry", "notice"]);

/**
 * Проверка приложения перед ходом: пускает или отказывает до любой записи. Каждый пропуск закрывается ровно одним:
 * начатым ходом или `turnNotStarted`.
 */
export interface TurnGate {
  /**
   * Отказ приложения — `TurnRefusedError`, исключение приложения идёт наружу как есть: `work` не зовётся. Пропуск —
   * `work(pass)`, который начинает ход (или пишет сообщение без хода при `hold`). Бросил — `turnNotStarted` с причиной по ошибке, ошибка наружу прежняя. Вернул без
   * хода (`notStartedBecause(result)` дал причину) — `turnNotStarted` с ней. Нет хука — только `work`.
   */
  admit<T>(input: TurnGateInput, work: (pass: TurnPass) => Promise<T>, notStartedBecause?: (result: T) => TurnNotStartedReason | undefined): Promise<T>;
  /**
   * Для служебных ходов без человека: как `admit`, но отказ — `skip()` (сообщение пишется без хода) вместо
   * `TurnRefusedError`, `hold` — тоже `skip()`. `beforeTurn` зовётся один раз.
   */
  admitOrSkip<T>(
    input: TurnGateInput,
    work: (pass: TurnPass) => Promise<T>,
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

  async function decisionOf(input: TurnGateInput): Promise<TurnRefusedError | TurnPass> {
    if (!beforeTurn) return TURN;
    const decision = await beforeTurn({
      userId: input.userId,
      chat: input.chat,
      action: input.action,
      ...(input.text !== undefined && { text: input.text }),
      ...(input.messageId !== undefined && { messageId: input.messageId }),
      ...(input.burstMessageIds && { burstMessageIds: [...input.burstMessageIds] }),
      ...abandonedOf(input),
    });
    if (!decision) return TURN;
    if ("hold" in decision && decision.hold === true) {
      return HOLD_ACTIONS.has(input.action) ? { kind: "hold" } : new TurnRefusedError({ code: TURN_HELD_CODE, message: TURN_HELD_MESSAGE });
    }
    if ("reply" in decision) {
      const text = decision.reply?.text;
      if (typeof text !== "string" || text.trim().length === 0) {
        const error = new TypeError("Готовый текст beforeTurn — непустая строка: { reply: { text } }");
        logError(`beforeTurn вернул неверный готовый текст (чат ${input.chat.id}, действие ${input.action}): ${error.message}`);
        throw error;
      }
      return REPLY_ACTIONS.has(input.action) ? { kind: "reply", text } : new TurnRefusedError({ code: TURN_HELD_CODE, message: TURN_HELD_MESSAGE });
    }
    try {
      return new TurnRefusedError(decision as TurnRefusal);
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
        ...(input.burstMessageIds && { burstMessageIds: [...input.burstMessageIds] }),
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
  async function passed<T>(
    input: TurnGateInput,
    pass: TurnPass,
    work: (pass: TurnPass) => Promise<T>,
    notStartedBecause?: (result: T) => TurnNotStartedReason | undefined,
  ): Promise<T> {
    // Без хука закрывать нечего: работа идёт как раньше. «Записать и промолчать» — не пропуск хода.
    if (!turnNotStarted || pass.kind === "hold") return work(pass);
    let result: T;
    try {
      result = await work(pass);
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
      const decision = await decisionOf(input);
      if (decision instanceof TurnRefusedError) throw decision;
      return passed(input, decision, work, notStartedBecause);
    },
    async admitOrSkip(input, work, skip, notStartedBecause) {
      const decision = await decisionOf(input);
      return decision instanceof TurnRefusedError || decision.kind === "hold" ? skip() : passed(input, decision, work, notStartedBecause);
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
