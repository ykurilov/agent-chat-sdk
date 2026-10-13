import type { FillerCategory } from "../protocol";

export type { FillerCategory } from "../protocol";

/** Заполнитель, готовый прозвучать: звук уже загружен. */
export interface FillerPhrase {
  id: string;
  category: FillerCategory;
  text: string;
  durationMs: number;
}

/** Пороги и правила заполнителей. Значения по умолчанию — `DEFAULT_FILLER_SETTINGS`. */
export interface FillerSchedulerSettings {
  /** Сколько тишины после конца фразы человека (текста ответа нет, модель ничего не делает на виду), мс. */
  thinkingAfterMs: number;
  /** Сколько идёт размышление модели, мс. */
  reasoningAfterMs: number;
  /** Сколько идёт вызов инструмента, мс. */
  toolAfterMs: number;
  /** Через сколько после первого заполнителя, если ответа всё нет, сказать «ещё чуть-чуть», мс. */
  longAfterMs: number;
  /** Сколько тишины должно стоять после настоящего ответа (его слов и звука), прежде чем заполнитель можно говорить, мс. */
  quietAfterAnswerMs: number;
  /** Пауза между двумя заполнителями, считая от конца прежнего, мс. */
  minGapMs: number;
  /** Сколько заполнителей на один ход. */
  maxPerTurn: number;
  /** Имя инструмента → вид заполнителя; неизвестный инструмент получает общий вид `tool`. */
  toolCategories: Record<string, FillerCategory>;
}

export const DEFAULT_FILLER_SETTINGS: FillerSchedulerSettings = {
  thinkingAfterMs: 1500,
  reasoningAfterMs: 2500,
  toolAfterMs: 700,
  longAfterMs: 6000,
  quietAfterAnswerMs: 1500,
  minGapMs: 2000,
  maxPerTurn: 2,
  toolCategories: {
    web_search: "web",
    read_page: "page",
    page_screenshot: "page",
    manage_memory: "memory",
    search_earlier_conversation: "memory",
  },
};

export interface FillerClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FillerSchedulerDeps {
  settings: FillerSchedulerSettings;
  clock?: FillerClock;
  random?: () => number;
  /** Фразы вида, которые уже загружены и могут прозвучать. Спрашивается в момент срабатывания: загрузка идёт в фоне. */
  phrases(category: FillerCategory): readonly FillerPhrase[] | undefined;
  /** Сейчас звучит настоящий ответ. */
  isAnswerAudioPlaying(): boolean;
  /** Сказать фразу. `false` — не вышло (звука нет); тогда фраза не считается сказанной. */
  speak(phrase: FillerPhrase): boolean;
}

/**
 * Решает, когда голосу сказать заполнитель, пока модель не отвечает. Ничего не знает о звуке, сети и чате:
 * получает события хода, спрашивает у часов время, а сказанное отдаёт через `speak`.
 */
export interface FillerScheduler {
  /** Человек договорил, слова ушли агенту: начинается ход. */
  turnStarted(): void;
  /** Конец хода (ответ кончился, перебит, режим закрыт): все ожидания сняты. */
  turnEnded(): void;
  /** Модель начала размышлять или вызывать инструмент. `id` — любой ключ, одинаковый у начала и конца. */
  activityStarted(id: string, kind: "reasoning" | "tool", toolName?: string): void;
  activityEnded(id: string): void;
  /** Пришёл кусок текста настоящего ответа. */
  answerText(): void;
  /** Настоящий звук ответа доиграл (но ответ ещё может продолжиться). */
  answerAudioEnded(): void;
  dispose(): void;
}

const THINKING = "thinking";
const LONG = "long";

export function createFillerScheduler(deps: FillerSchedulerDeps): FillerScheduler {
  const { settings } = deps;
  const clock: FillerClock = deps.clock ?? {
    now: () => Date.now(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const random = deps.random ?? Math.random;

  const timers = new Map<string, unknown>();
  const activities = new Map<string, { kind: "reasoning" | "tool"; toolName?: string }>();
  const usedThisTurn = new Set<string>();
  /** Последняя сказанная фраза живёт и между ходами: одну и ту же подряд не повторяем, если есть из чего выбрать. */
  let lastPhraseId: string | null = null;
  let active = false;
  let disposed = false;
  let count = 0;
  let answerSeen = false;
  let answerAfterFiller = false;
  let lastAnswerSoundAt: number | null = null;
  let gapUntil = 0;

  function cancel(key: string) {
    const handle = timers.get(key);
    if (handle === undefined) return;
    clock.clearTimeout(handle);
    timers.delete(key);
  }

  function cancelAll() {
    for (const handle of timers.values()) clock.clearTimeout(handle);
    timers.clear();
  }

  /** Сколько ещё ждать, прежде чем говорить; 0 — можно сейчас. */
  function waitMs(): number {
    const now = clock.now();
    if (deps.isAnswerAudioPlaying()) return settings.quietAfterAnswerMs;
    if (now < gapUntil) return gapUntil - now;
    if (lastAnswerSoundAt !== null && now - lastAnswerSoundAt < settings.quietAfterAnswerMs) return settings.quietAfterAnswerMs - (now - lastAnswerSoundAt);
    return 0;
  }

  function pick(category: FillerCategory): FillerPhrase | null {
    const all = deps.phrases(category) ?? [];
    const other = all.filter((phrase) => phrase.id !== lastPhraseId);
    const candidates = other.length > 0 ? other : all;
    const fresh = candidates.filter((phrase) => !usedThisTurn.has(phrase.id));
    const pool = fresh.length > 0 ? fresh : candidates;
    return pool[Math.floor(random() * pool.length)] ?? null;
  }

  function say(category: FillerCategory) {
    const phrase = pick(category);
    if (!phrase || !deps.speak(phrase)) return;
    count += 1;
    usedThisTurn.add(phrase.id);
    lastPhraseId = phrase.id;
    gapUntil = clock.now() + phrase.durationMs + settings.minGapMs;
    if (count === 1) arm(LONG, settings.longAfterMs, () => "long", () => !answerAfterFiller);
  }

  /** Поставить срабатывание: по сроку проверяет, что оно ещё нужно, и ждёт тишины, если мешает настоящий ответ. */
  function arm(key: string, delayMs: number, category: () => FillerCategory, stillNeeded: () => boolean) {
    cancel(key);
    timers.set(
      key,
      clock.setTimeout(() => {
        timers.delete(key);
        if (!active || count >= settings.maxPerTurn || !stillNeeded()) return;
        const wait = waitMs();
        if (wait > 0) return arm(key, wait, category, stillNeeded);
        say(category());
      }, delayMs),
    );
  }

  /** Модель ничего не делает на виду и текста ответа нет: через `thinkingAfterMs` тишины — фраза «думает». */
  function armThinking() {
    arm(THINKING, settings.thinkingAfterMs, () => "thinking", () => !answerSeen && activities.size === 0);
  }

  return {
    turnStarted() {
      if (disposed) return;
      cancelAll();
      activities.clear();
      usedThisTurn.clear();
      active = true;
      count = 0;
      answerSeen = false;
      answerAfterFiller = false;
      lastAnswerSoundAt = null;
      gapUntil = 0;
      armThinking();
    },

    turnEnded() {
      active = false;
      cancelAll();
      activities.clear();
    },

    activityStarted(id, kind, toolName) {
      if (!active) return;
      activities.set(id, { kind, ...(toolName !== undefined && { toolName }) });
      cancel(THINKING);
      const category = (): FillerCategory => (kind === "reasoning" ? "reasoning" : ((toolName && settings.toolCategories[toolName]) || "tool"));
      arm(`activity:${id}`, kind === "reasoning" ? settings.reasoningAfterMs : settings.toolAfterMs, category, () => activities.has(id));
    },

    activityEnded(id) {
      activities.delete(id);
      cancel(`activity:${id}`);
      if (active && !answerSeen && activities.size === 0) armThinking();
    },

    answerText() {
      if (!active) return;
      answerSeen = true;
      lastAnswerSoundAt = clock.now();
      cancel(THINKING);
      if (count > 0) {
        answerAfterFiller = true;
        cancel(LONG);
      }
    },

    answerAudioEnded() {
      if (!active) return;
      lastAnswerSoundAt = clock.now();
    },

    dispose() {
      disposed = true;
      active = false;
      cancelAll();
      activities.clear();
    },
  };
}
