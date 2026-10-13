import type { WorkViewLabels } from "../labels";
import { stepPhraseOf } from "./step-phrases";
import type { StepCall, StepPhrases, StepPhraseText } from "./step-phrases";

/** Шаг работы: размышление модели или вызов инструмента (`title` — название от приложения, `fallback` — запасные фразы). */
export type WorkStep = { kind: "thinking" } | { kind: "tool"; call: StepCall; title?: string; fallback?: StepPhraseText };

/**
 * Часть ответа для раскладки: то, что видно как обычно (`blank` — пустой текст, модель только начала писать), или шаг
 * работы. `key` шага — ключ части ответа: по первому шагу группы хранится раскрытие свёрнутой строки.
 */
export type AnswerEntry<Node> = { kind: "shown"; node: Node; blank?: boolean } | { kind: "step"; key: string; step: WorkStep };

/** Строка списка шагов. */
export interface WorkStepLine {
  phrase: string;
  failed: boolean;
}

/** Раскладка ответа в простом виде: видимые части, живая строка последней группы, свёрнутые группы. */
export type WorkLayoutItem<Node> =
  | { kind: "shown"; node: Node }
  | { kind: "live"; key: string; phrase: string }
  | { kind: "done"; key: string; steps: WorkStepLine[]; count: number };

interface LayoutOptions {
  /** Ответ ещё пишется: последняя группа шагов — живая строка. */
  streaming: boolean;
  phrases?: StepPhrases | undefined;
  labels: WorkViewLabels;
}

/**
 * Простой вид: подряд идущие шаги (размышления и вызовы) — одна группа; пустой текст между ними группу не рвёт и
 * ставится после неё. Последняя группа идущего ответа, после которой ничего не видно, — живая строка с текущим шагом.
 * Остальные — свёрнутые «Сделано N шагов» с понятными фразами; одинаковые фразы подряд — одна строка «… ×N», группа из
 * одних размышлений не показывается. Вызов, оставшийся «идёт» в законченном ответе («Стоп», обрыв), — «не закончил».
 */
export function workLayoutOf<Node>(entries: AnswerEntry<Node>[], { streaming, phrases, labels }: LayoutOptions): WorkLayoutItem<Node>[] {
  const lastShown = entries.findLastIndex((entry) => entry.kind === "shown" && !entry.blank);
  const layout: WorkLayoutItem<Node>[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index]!;
    if (entry.kind === "shown") {
      layout.push({ kind: "shown", node: entry.node });
      index++;
      continue;
    }
    const group: WorkStep[] = [];
    const blanks: WorkLayoutItem<Node>[] = [];
    const key = entry.key;
    let lastStep = index;
    for (; index < entries.length; index++) {
      const next = entries[index]!;
      if (next.kind === "step") {
        group.push(next.step);
        lastStep = index;
      } else if (next.blank) blanks.push({ kind: "shown", node: next.node });
      else break;
    }
    if (streaming && lastStep > lastShown) layout.push({ kind: "live", key, phrase: labels.live(livePhraseOf(group, phrases, labels)) });
    else {
      const done = doneLinesOf(group, phrases, labels, !streaming);
      if (done.count > 0) layout.push({ kind: "done", key, ...done });
    }
    layout.push(...blanks);
  }
  return layout;
}

/**
 * Текущий шаг живой строкой: идущий вызов — его фраза (при параллельных — последний из ещё идущих), размышление —
 * «Думаю», все вызовы закончились — общая фраза.
 */
function livePhraseOf(group: WorkStep[], phrases: StepPhrases | undefined, labels: WorkViewLabels): string {
  const last = group.at(-1)!;
  const running = group.findLast((step) => step.kind === "tool" && step.call.state === "running");
  if (last.kind === "tool" && running?.kind === "tool") return phraseOf(running, phrases, labels);
  return last.kind === "thinking" ? labels.thinking : labels.stepRunning;
}

function phraseOf(step: Extract<WorkStep, { kind: "tool" }>, phrases: StepPhrases | undefined, labels: WorkViewLabels, unfinished = false): string {
  return stepPhraseOf({ ...step.call, ...(step.title !== undefined && { title: step.title }) }, { phrases, labels, fallback: step.fallback, unfinished });
}

/** Строки списка и число вызовов; `finished` — ответ закончен, и «идёт» значит «не закончил». */
function doneLinesOf(group: WorkStep[], phrases: StepPhrases | undefined, labels: WorkViewLabels, finished: boolean): { steps: WorkStepLine[]; count: number } {
  const lines: Array<WorkStepLine & { repeats: number }> = [];
  let count = 0;
  for (const step of group) {
    if (step.kind !== "tool") continue;
    count++;
    const unfinished = finished && step.call.state === "running";
    const phrase = phraseOf(step, phrases, labels, unfinished);
    const failed = step.call.state === "error" || unfinished;
    const previous = lines.at(-1);
    if (previous?.phrase === phrase && previous.failed === failed) previous.repeats++;
    else lines.push({ phrase, failed, repeats: 1 });
  }
  const steps = lines.map(({ phrase, failed, repeats }) => ({ phrase: repeats > 1 ? labels.stepRepeated(phrase, repeats) : phrase, failed }));
  return { steps, count };
}
