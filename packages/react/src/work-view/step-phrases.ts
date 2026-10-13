import type { WorkViewLabels } from "../labels";
import type { ToolCallState } from "../skin-contract";

/**
 * Вид работы агента в ленте. `detailed` — мысли и строки инструментов с входом и выходом, как до 0.45.
 * `simple` — пока ход идёт, одна живая строка с текущим шагом; после хода шаги свёрнуты в «Сделано N шагов».
 */
export type WorkView = "detailed" | "simple";

/** Вызов инструмента для фразы. Вход и выход бывают не всегда: вход ещё пишется или скрыт правами. */
export interface StepCall {
  toolName: string;
  state: ToolCallState;
  input?: unknown;
  output?: unknown;
}

/** Фразы шага: пока идёт («Делаю календарь»), готово («Сделал календарь»), не вышло (необязательно). */
export interface StepPhraseText {
  running: string;
  done: string;
  failed?: string;
}

/** Фразы шага готовые или по вызову. Нет ответа (`undefined`) — общая фраза. */
export type StepPhrase = StepPhraseText | ((call: StepCall) => Partial<StepPhraseText> | undefined);

/** Фразы шагов приложения: имя инструмента → фразы. */
export type StepPhrases = Record<string, StepPhrase>;

/** Самая длинная фраза шага: длиннее — обрезается с «…», чтобы строка помещалась в пузырь на телефоне. */
const PHRASE_MAX_LENGTH = 120;

/** Непустая строка в одну строку, без многоточия на конце, не длиннее `PHRASE_MAX_LENGTH`; иначе `undefined`. */
function cleanPhrase(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const phrase = value.replace(/\s+/g, " ").trim().replace(/(…|\.\.\.)$/, "").trimEnd();
  if (phrase.length === 0) return undefined;
  return phrase.length > PHRASE_MAX_LENGTH ? `${phrase.slice(0, PHRASE_MAX_LENGTH - 1).trimEnd()}…` : phrase;
}

/** Фразы приложения для вызова; ошибка функции или странный ответ — `undefined`, чат не ломается. */
function appPhraseOf(call: StepCall, phrases: StepPhrases | undefined): Partial<StepPhraseText> | undefined {
  const entry = phrases && Object.hasOwn(phrases, call.toolName) ? phrases[call.toolName] : undefined;
  if (entry === undefined) return undefined;
  try {
    const phrase = typeof entry === "function" ? entry(call) : entry;
    return typeof phrase === "object" && phrase !== null ? phrase : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Понятная фраза шага по его состоянию. Порядок: фраза приложения (`stepPhrases`), запасная фраза слоя поведения
 * (`fallback`, например у помощника), название инструмента от приложения (`title`), общая фраза словаря.
 * `unfinished` — ответ закончился, а вызов так и остался «идёт» («Стоп», обрыв): «Делаю календарь — не закончил».
 */
export function stepPhraseOf(
  call: StepCall & { title?: string },
  {
    phrases,
    labels,
    fallback,
    unfinished = false,
  }: { phrases?: StepPhrases | undefined; labels: WorkViewLabels; fallback?: StepPhraseText | undefined; unfinished?: boolean },
): string {
  const { title, ...appCall } = call;
  const own = appPhraseOf(appCall, phrases);
  const named = cleanPhrase(title);
  const running = cleanPhrase(own?.running) ?? cleanPhrase(fallback?.running) ?? named;
  if (call.state === "running") {
    if (unfinished) return running ? labels.stepUnfinished(running) : labels.stepUnfinishedUnknown;
    return running ?? labels.stepRunning;
  }
  if (call.state === "error") return cleanPhrase(own?.failed) ?? cleanPhrase(fallback?.failed) ?? (running ? labels.stepFailed(running) : labels.stepFailedUnknown);
  return cleanPhrase(own?.done) ?? cleanPhrase(fallback?.done) ?? named ?? labels.stepDone;
}
