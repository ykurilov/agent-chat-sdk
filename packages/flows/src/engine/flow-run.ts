import type { FlowConfirmationRecord, FlowConfirmationRef } from "./confirmation";

/** Ключ в состоянии чата (`ChatState`), под которым лежит `FlowRun`. */
export const FLOW_STATE_KEY = "flow";

/** Сколько последних шагов пути хранить в чате. */
export const FLOW_PATH_LIMIT = 50;

/** Больше стольких переходов подряд без ответа агента — сценарий зациклился, движок останавливается. */
export const FLOW_CHAIN_LIMIT = 5;

/** Политика обычных выходов словами; защищённые выходы всегда проверяются сервером. */
export type FlowTransitionMode = "rails" | "advisor" | "free";

/** Реальный ответ судьи. Текстового довода у decision-модели может не быть. */
export interface FlowJudgeAdvice {
  exitId: string;
  confirmed: boolean;
  probability: number;
  source: "decision" | "fallback" | "text";
  reason?: string;
}

/** Кто решил переход: агент заявил и судья подтвердил, судья сам, данные, событие или таймер. */
export type TransitionDecider = "claim" | "judge" | "data" | "event" | "timer";

/** Почему случился переход — словами для людей: «тишина 3 ч», «нода длится 1 день», «поле „Оплатил“ = да». */
export interface TransitionReason {
  kind: TransitionDecider;
  text: string;
}

/** Почему разговор закончился: конечная нода, срок вышел, человек пропал, канал заблокирован, своя причина приложения (`flow.end`). */
export type FlowEndReason = "final" | "deadline" | "abandoned" | "blocked" | (string & {});

/** Как чат попал в состояние: старт сценария, переход, перевод на новую версию или открытие заново (`flow.reopen`, с 0.68). */
export type FlowPathCause = TransitionDecider | "start" | "migrate" | "reopen";

export interface FlowPathEntry {
  state: string;
  /** Время входа, мс с 1970 года. */
  at: number;
  /** Метки состояния на момент входа. */
  tags: string[];
  from: string | null;
  exitId: string | null;
  decidedBy: FlowPathCause;
  /** Уверенность судьи, 0…1. */
  probability?: number;
  /** Причина перехода словами. В записях до 0.49 нет. */
  reason?: TransitionReason;
}

/** Где чат в сценарии. Хранится в состоянии чата под `FLOW_STATE_KEY`; все времена — мс с 1970 года. */
export interface FlowRun {
  /** Проверки сервера: на этой ветке, для этого человека/чата/сценария. Модель их не устанавливает. */
  confirmations?: Record<string, FlowConfirmationRecord>;
  /** Идемпотентность полного afterTurn check; отрицательный результат не переносится на следующий human turn. */
  confirmationCheck?: { answerId: string; configurationHash: string };
  /** Receipt и решение сохраняются одной записью до применения перехода. */
  checkedTransition?: {
    versionId: string;
    transition: Transition;
    requires: FlowConfirmationRef;
    criterionHash: string;
    answerId: string;
    humanMessageId: string;
  };
  /** Совет доступен только указанному ответу и текущему состоянию. */
  transitionAdvice?: { forTurnId: string; sourceTurnId: string; state: string; verdicts: FlowJudgeAdvice[] };
  /** Отрицательный совет: разрешает явное подтверждение только в том же ходе и месте. */
  claimAdvice?: { forTurnId: string; state: string; enteredAt: number; claims: Record<string, { verdict: FlowJudgeAdvice; toolCallId: string; why: string }> };
  state: string;
  /** Когда вошли в текущее состояние. */
  enteredAt: number;
  /** Когда чат начал сценарий. */
  startedAt: number;
  /** Последние `FLOW_PATH_LIMIT` шагов, первый — самый старый. */
  path: FlowPathEntry[];
  /** Остановленные часы «время в состоянии» основных состояний, пока чат в напоминаниях: id состояния → накоплено мс. */
  pausedClocks: Record<string, number>;
  /** Заметки этого чата по `id` поля `chatNotes`. */
  notes: Record<string, unknown>;
  humanMessages: number;
  /** Ответ агента, к которому записано место чата. У симуляции редактора нет. */
  answerId?: string;
  /**
   * Ответ агента, на котором вошли в текущее состояние, с 0.62: судья после хода смотрит реплики с него. Нет — переходов
   * ещё не было, место записано раньше или это симуляция: судья видит последние реплики.
   */
  enteredAfterAnswer?: string;
  agentAnswers: number;
  /** На каком сообщении человека (`humanMessages`) был последний вопрос между делом. */
  sideQuestionAt: number | null;
  /** Последний переход, который судья не подтвердил: заявлять его снова можно после нового сообщения человека. */
  lastRejected: { exitId: string; atHumanMessages: number } | null;
  lastAgentAt: number | null;
  lastHumanAt: number | null;
  /** Переходов подряд без ответа агента; предел — `FLOW_CHAIN_LIMIT`. */
  chain: number;
  /** Сдвиг часов для тестового чата, мс. В рабочих чатах нет. */
  timeOffset?: number;
  // Поля 0.49 — только у сценариев с «Днями и временем», касаниями или концом разговора. Записи 0.48 их не имеют.
  /** Начало первого дня сценария (с учётом позднего старта и пояса человека). */
  dayAnchorAt?: number;
  /** Сообщения человека за текущий день сценария: местная дата «ГГГГ-ММ-ДД» → сколько. Хранится только текущий день. */
  dayCounts?: Record<string, number>;
  /** Какой шаг ряда касаний следующий; сообщение человека возвращает к 0. */
  nudgeStep?: number;
  /** `nudgeStep` насчитан своим рядом ноды на N дней (`nudges.days`): после них общий ряд начинается сначала. С 0.55. */
  nudgeStepOwn?: boolean;
  /** Ходов сервера подряд (по служебным сообщениям) после последнего сообщения человека, с 0.53; нет — 0. */
  serverTurns?: number;
  /** Последний ход «пишет первым», после которого человек не писал, и счёт до него: не доставлен — не засчитан (FR-309). */
  touch?: FlowTouch;
  /** Когда разговор закончился. После конца таймеров и касаний нет. */
  endedAt?: number;
  endReason?: FlowEndReason;
  /** Разговор открыт заново (`flow.reopen`): тишина, утреннее и «не завершил» считаются не раньше этого момента. С 0.68. */
  reopenedAt?: number;
}

/** Ход «пишет первым» и что было до него. Ответ хода помечен «не доставлено» — счёт возвращается к этому. */
export interface FlowTouch {
  /** Ответ агента этого хода. */
  answerId: string;
  /** Когда ход был, по часам чата: от него считается следующий срок, если касание не дошло. */
  at: number;
  lastAgentAt: number | null;
  nudgeStep: number;
  nudgeStepOwn?: boolean;
  agentAnswers: number;
}

/** Переход, который движок решил сделать. */
export interface Transition {
  from: string;
  /** Новое состояние; при «назад» — уже найденное основное состояние. */
  to: string;
  exitId: string;
  decidedBy: TransitionDecider;
  probability?: number;
  /** Метки состояния `to`. */
  tags: string[];
  at: number;
  /** Переход «назад» (`@return`). */
  returned?: boolean;
  /** Причина словами: уходит в `onTransition` и в путь. */
  reason?: TransitionReason;
}

/** Тихие часы и потолок сообщений, которые агент пишет первым (по таймерам). */
export interface FirstMessagesRules {
  /** Ночью не писать: «ЧЧ:ММ» в поясе человека. Срок переносится на конец тихих часов. */
  quietHours: { from: string; to: string };
  /** Не больше стольких сообщений первым за сутки человека. */
  maxPerDay: number;
  /**
   * Своя проверка приложения: например, человек отписался или остановлены расходы. `true` — писать. `false` — не сейчас:
   * касание повторится через час. `"never"` — молчать до сообщения человека. `{ retryAt }` — повторить в этот момент
   * (негодная дата — как `false`, прошедшая — через минуту). Конец разговора («срок вышел», «не завершил») и переходы нод
   * по таймерам от ответа не зависят: наступают в свой срок.
   */
  canWriteNow?: (input: { ownerId: string; chatId: string; at: Date }) => CanWriteNow | Promise<CanWriteNow>;
}

/** Ответ `canWriteNow`: писать, не сейчас (повтор через час), молчать до сообщения человека или повторить в названный момент (с 0.53). */
export type CanWriteNow = boolean | "never" | { retryAt: Date };

/** `false` — правила выключены: агент пишет первым без тихих часов и потолка. Не писать первым — `canWriteNow: () => "never"`. */
export type FirstMessagesSetting = Partial<FirstMessagesRules> | false;

export const DEFAULT_FIRST_MESSAGES: Readonly<Omit<FirstMessagesRules, "canWriteNow">> = {
  quietHours: { from: "21:00", to: "09:00" },
  maxPerDay: 3,
};
