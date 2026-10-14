import type { JudgeMessage } from "./flow-types";

/** Сколько последних реплик видит судья. */
export const JUDGE_MESSAGES = 6;
/** Длина одной реплики, знаков. */
export const JUDGE_MESSAGE_CHARS = 600;
/** Весь вход судьи, знаков: контекст decision-1 — 32 тыс. токенов, а токен бывает и в один знак. */
export const JUDGE_INPUT_CHARS = 24_000;

const GOAL_CHARS = 2000;
const WHY_CHARS = 1000;
const CONDITION_CHARS = 800;
/** Рамка вопроса к судье вокруг условия: «Выполнено ли условие «…»?» и ключ. */
const QUESTION_OVERHEAD_CHARS = 90;
const MIN_FIELD_CHARS = 24;

export interface JudgeContextInput {
  goal?: string;
  /** Слова агента при заявке: почему он считает условие выполненным. */
  why?: string;
  messages: JudgeMessage[];
  conditions: Array<{ exitId: string; text: string }>;
}

export interface JudgeContext {
  /** Что оценивает судья: цель, последние реплики, слова агента. */
  state: { goal?: string; conversation: JudgeMessage[]; agent_words?: string };
  /** Условия с обрезанным текстом, в исходном порядке. */
  conditions: Array<{ exitId: string; text: string }>;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function build(input: JudgeContextInput, messages: JudgeMessage[], scale: number): JudgeContext {
  const limit = (chars: number) => Math.max(MIN_FIELD_CHARS, Math.floor(chars * scale));
  return {
    state: {
      ...(input.goal !== undefined && { goal: clip(input.goal, limit(GOAL_CHARS)) }),
      conversation: messages.map((message) => ({ role: message.role, text: clip(message.text, limit(JUDGE_MESSAGE_CHARS)) })),
      ...(input.why !== undefined && { agent_words: clip(input.why, limit(WHY_CHARS)) }),
    },
    conditions: input.conditions.map(({ exitId, text }) => ({ exitId, text: clip(text, limit(CONDITION_CHARS)) })),
  };
}

function sizeOf(context: JudgeContext): number {
  return JSON.stringify(context).length + context.conditions.length * QUESTION_OVERHEAD_CHARS;
}

/**
 * Вход судьи: последние реплики, каждая обрезана, и общий потолок под контекст модели.
 * Не помещается — сначала уходят старые реплики (свежая остаётся), потом все поля сжимаются вдвое, пока не уложатся.
 * Условия не пропадают: на каждое судья должен ответить.
 */
export function buildJudgeContext(input: JudgeContextInput): JudgeContext {
  const messages = input.messages.slice(-JUDGE_MESSAGES);
  let context = build(input, messages, 1);
  while (sizeOf(context) > JUDGE_INPUT_CHARS && messages.length > 1) {
    messages.shift();
    context = build(input, messages, 1);
  }
  for (let scale = 0.5; sizeOf(context) > JUDGE_INPUT_CHARS && scale > 0.001; scale /= 2) context = build(input, messages, scale);
  return context;
}
