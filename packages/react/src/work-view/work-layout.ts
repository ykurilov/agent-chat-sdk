import type { WorkViewLabels } from "../labels";
import { stepIconOf } from "./step-icons";
import type { StepIcon } from "./step-icons";
import { stepPhraseOf } from "./step-phrases";
import type { StepCall, StepPhrases, StepPhraseText } from "./step-phrases";

/**
 * Шаг работы: размышление модели (`title` — заголовок раздумья от сервера, `durationMs` — сколько думала, `null` — ещё
 * думает) или вызов инструмента (`title` — название от приложения, `fallback` — запасные фразы).
 */
export type WorkStep =
  | { kind: "thinking"; title?: string; durationMs?: number | null }
  | { kind: "tool"; call: StepCall; title?: string; fallback?: StepPhraseText };

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

/** Строка списка шагов со значком (договор 28): и вызовы, и раздумья. */
export interface WorkStepItem extends WorkStepLine {
  icon: StepIcon;
}

/** Больше значков в свёрнутом ряду не рисуется: остальные — «+N». */
export const STEP_ICON_ROW_MAX = 8;

/** Раскладка ответа в простом виде: видимые части, живая строка последней группы, свёрнутые группы. */
export type WorkLayoutItem<Node> =
  | { kind: "shown"; node: Node }
  | { kind: "live"; key: string; phrase: string; icon: StepIcon }
  | { kind: "done"; key: string; steps: WorkStepLine[]; count: number; items: WorkStepItem[]; icons: StepIcon[]; moreIcons: number };

interface LayoutOptions {
  /** Ответ ещё пишется: последняя группа шагов — живая строка. */
  streaming: boolean;
  phrases?: StepPhrases | undefined;
  labels: WorkViewLabels;
  /**
   * Раздумья — тоже шаги списка и ряда значков (договор 28). Экран включает, когда у ответа есть заголовки раздумий
   * (`thoughtTitles`): без них в списке только вызовы, как до 0.69.
   */
  thoughts?: boolean;
}

/**
 * Простой вид: подряд идущие шаги (размышления и вызовы) — одна группа; пустой текст между ними группу не рвёт и
 * ставится после неё. Последняя группа идущего ответа, после которой ничего не видно, — живая строка с текущим шагом.
 * Остальные — свёрнутые «Сделано N шагов» с понятными фразами; одинаковые фразы подряд — одна строка «… ×N», группа из
 * одних размышлений не показывается. Вызов, оставшийся «идёт» в законченном ответе («Стоп», обрыв), — «не закончил».
 */
export function workLayoutOf<Node>(entries: AnswerEntry<Node>[], { streaming, phrases, labels, thoughts = false }: LayoutOptions): WorkLayoutItem<Node>[] {
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
    if (streaming && lastStep > lastShown) {
      const live = liveStepOf(group, phrases, labels);
      layout.push({ kind: "live", key, phrase: labels.live(live.phrase), icon: live.icon });
    } else {
      const done = doneLinesOf(thoughts ? group : group.filter((step) => step.kind === "tool"), phrases, labels, !streaming);
      if (done.count > 0) layout.push({ kind: "done", key, ...done });
    }
    layout.push(...blanks);
  }
  return layout;
}

/**
 * Текущий шаг живой строкой: идущий вызов — его фраза и значок (при параллельных — последний из ещё идущих),
 * размышление — его заголовок или «Думаю», все вызовы закончились — общая фраза.
 */
function liveStepOf(group: WorkStep[], phrases: StepPhrases | undefined, labels: WorkViewLabels): { phrase: string; icon: StepIcon } {
  const last = group.at(-1)!;
  const running = group.findLast((step) => step.kind === "tool" && step.call.state === "running");
  if (last.kind === "tool" && running?.kind === "tool") return { phrase: phraseOf(running, phrases, labels), icon: iconOf(running, phrases) };
  if (last.kind === "thinking") return { phrase: last.title ?? labels.thinking, icon: "thinking" };
  return { phrase: labels.stepRunning, icon: iconOf(last, phrases) };
}

function iconOf(step: Extract<WorkStep, { kind: "tool" }>, phrases: StepPhrases | undefined): StepIcon {
  return stepIconOf(step.call, { phrases, fallback: step.fallback });
}

function phraseOf(step: Extract<WorkStep, { kind: "tool" }>, phrases: StepPhrases | undefined, labels: WorkViewLabels, unfinished = false): string {
  return stepPhraseOf({ ...step.call, ...(step.title !== undefined && { title: step.title }) }, { phrases, labels, fallback: step.fallback, unfinished });
}

/**
 * Строки списка, число вызовов и ряд значков; `finished` — ответ закончен, и «идёт» значит «не закончил». `steps` —
 * только вызовы (скины 23–27), `items` — вызовы и раздумья со значками, одинаковые подряд схлопнуты; в ряду значков
 * схлопывания нет: по значку на шаг.
 */
function doneLinesOf(
  group: WorkStep[],
  phrases: StepPhrases | undefined,
  labels: WorkViewLabels,
  finished: boolean,
): { steps: WorkStepLine[]; count: number; items: WorkStepItem[]; icons: StepIcon[]; moreIcons: number } {
  const all = group.map((step) =>
    step.kind === "tool"
      ? { ...toolLineOf(step, phrases, labels, finished), tool: true }
      : { icon: "thinking", phrase: step.title ?? labels.thought(step.durationMs ?? null), failed: false, tool: false },
  );
  const calls = all.filter((line) => line.tool);
  const icons = all.map((line) => line.icon);
  return {
    steps: collapsed(calls, labels).map(({ phrase, failed }) => ({ phrase, failed })),
    count: calls.length,
    items: collapsed(all, labels),
    icons: icons.slice(0, STEP_ICON_ROW_MAX),
    moreIcons: Math.max(0, icons.length - STEP_ICON_ROW_MAX),
  };
}

/** Одинаковые строки подряд — одна строка «… ×N». */
function collapsed(lines: WorkStepItem[], labels: WorkViewLabels): WorkStepItem[] {
  const runs: Array<WorkStepItem & { repeats: number }> = [];
  for (const line of lines) {
    const previous = runs.at(-1);
    if (previous?.phrase === line.phrase && previous.failed === line.failed && previous.icon === line.icon) previous.repeats++;
    else runs.push({ icon: line.icon, phrase: line.phrase, failed: line.failed, repeats: 1 });
  }
  return runs.map(({ repeats, ...line }) => (repeats > 1 ? { ...line, phrase: labels.stepRepeated(line.phrase, repeats) } : line));
}

function toolLineOf(step: Extract<WorkStep, { kind: "tool" }>, phrases: StepPhrases | undefined, labels: WorkViewLabels, finished: boolean): WorkStepItem {
  const unfinished = finished && step.call.state === "running";
  return { icon: iconOf(step, phrases), phrase: phraseOf(step, phrases, labels, unfinished), failed: step.call.state === "error" || unfinished };
}
