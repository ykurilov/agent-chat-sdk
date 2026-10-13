import type { AgentChatMessage } from "../conversation/types";
import { FROZEN_CONTEXT_PART_TYPE } from "../frozen-context/context-blocks";

type Part = AgentChatMessage["parts"][number];

/** Сколько последних шагов текущего ответа остаются как есть, когда первые пересказываются. */
const KEPT_STEPS = 2;

const numberFormat = new Intl.NumberFormat("ru-RU");

/**
 * Где резать текущий ответ, когда в окно модели не влез уже сам ход: первые шаги — в пересказ, последние один-два — как
 * есть. Граница только перед `step-start`: вызов инструмента не отрывается от результата. Пустой шаг в конце (начат
 * и оборван) шагом не считается, часть застывших блоков — тоже. Меньше двух шагов — `null`: резать нечего.
 */
export function splitAnswerSteps(parts: readonly Part[]): { earlier: Part[]; kept: Part[] } | null {
  const starts = parts.flatMap((part, index) => (part.type === "step-start" && index > 0 ? [index] : []));
  const steps = [0, ...starts].map((start, index, bounds) => ({ start, end: bounds[index + 1] ?? parts.length }));
  // Шагом не считаются ни начатый и оборванный шаг, ни часть застывших блоков хода перед первым шагом.
  const isEmpty = ({ start, end }: { start: number; end: number }) =>
    parts.slice(start, end).every((part) => part.type === "step-start" || part.type === FROZEN_CONTEXT_PART_TYPE);
  while (steps.length > 0 && isEmpty(steps.at(-1)!)) steps.pop();
  while (steps.length > 0 && isEmpty(steps[0]!)) steps.shift();
  if (steps.length < 2) return null;
  const cut = steps[steps.length - Math.min(KEPT_STEPS, steps.length - 1)]!.start;
  return { earlier: parts.slice(0, cut), kept: parts.slice(cut) };
}

/** Задание пересказать первые шаги текущего ответа, последнее сообщение запроса. Текст постоянный: зависит только от потолка. */
export function answerStepsTask(summaryCeilingTokens: number): string {
  return `Последний ответ выше ещё не закончен, и его шаги уже не помещаются в контекст. Перескажи, что сделано в этих шагах, чтобы продолжить ответ без них: какие инструменты вызваны и с чем, какие данные и результаты получены, что уже сделано и что осталось.

Сохраняй точные значения, которые понадобятся снова: имена, пути, числа, адреса, идентификаторы. Не выдумывай ничего, чего не было. Не вызывай инструменты. Объём — не больше ${numberFormat.format(summaryCeilingTokens).replace(/\s/g, " ")} токенов.

Ответь только пересказом, без вступления.`;
}

/** Как пересказ шагов выглядит для модели: в постоянном обрамлении, следом идут оставленные шаги ответа. */
export function answerStepsFrame(summary: string): string {
  return `<answer_progress>
Ниже пересказ первых шагов твоего текущего ответа. Сами эти шаги убраны из контекста, чтобы он не переполнился; последние шаги идут дальше как есть. Продолжай ответ с того места, где он остановился, не повторяя сделанного.

${summary}
</answer_progress>`;
}
