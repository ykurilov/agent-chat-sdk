import type { HeardWord } from "../protocol";
import { soundClassOf } from "./voice-tag-sounds";

export interface BargeInFilterOptions {
  /** Слово с уверенностью ниже не слушаем. По умолчанию 0,6. */
  minConfidence?: number;
  /** Сколько мс озвученный текст считается «только что сказанным» (эхо). По умолчанию 5000. */
  echoWindowMs?: number;
  /** Слова, которые перебивают, даже если совпали с озвученным. */
  stopWords?: string[];
  /** Слова, которые одиночкой не перебивают. */
  fillers?: string[];
  /** Два слова считаются идущими подряд, если между ними не больше стольких мс. По умолчанию 2000. */
  pairGapMs?: number;
  now?: () => number;
}

export type BargeInDecision = { interrupt: false } | { interrupt: true; reason: "stop_word" | "words" | "two_words" };

export interface BargeInFilter {
  /** Что агент только что произнёс. Дописывать по ходу воспроизведения, небольшими кусками: окно считается от этого момента. */
  noteSpoken(text: string): void;
  /** Слова распознавания: закреплённые приходят один раз, предварительные — заново целиком. */
  feed(heard: { settled: HeardWord[]; interim: HeardWord[] }): BargeInDecision;
  /** Забыть услышанное (новая фраза человека). Озвученное остаётся: эхо не кончилось. */
  reset(): void;
}

const DEFAULT_MIN_CONFIDENCE = 0.6;
const DEFAULT_ECHO_WINDOW_MS = 5000;
const DEFAULT_PAIR_GAP_MS = 2000;
const DEFAULT_STOP_WORDS = ["стоп", "подожди", "погоди", "нет", "хватит", "слушай", "подождите", "погодите", "стой", "стойте"];
const DEFAULT_FILLERS = ["угу", "ага", "ну", "мм", "ммм", "э", "эм", "эх", "хм", "да"];
/** Слова короче сверяются только точно: одна буква разницы там — уже другое слово. */
const FUZZY_MIN_LENGTH = 5;

type Kind = "stop" | "echo" | "filler" | "fresh";

/** Без регистра, знаков, дефисов и «ё»: «М-м», «Всё» и «все» сравниваются по-простому. */
function normalize(text: string): string {
  return text.toLowerCase().replaceAll("ё", "е").replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Слова текста. Слово через дефис разбирается по частям («дай-ка» → «дай», «ка»): распознавание то склеивает такие слова,
 * то разбивает, и сверка должна быть одинаковой с обеих сторон. Исключение — звуки («ха-ха-ха», «м-м», «ох-х»): это одно слово.
 */
function tokens(text: string): string[] {
  return text.split(/\s+/).flatMap((piece) => {
    const parts = piece.split(/[-\u2010\u2011]/).map(normalize).filter((part) => part.length > 0);
    if (parts.length > 1 && soundClassOf(parts.join("")) !== null) return [parts.join("")];
    return parts;
  });
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (short.length === long.length) return short.slice(i + 1) === long.slice(i + 1);
  return short.slice(i) === long.slice(i + 1);
}

export function createBargeInFilter(options: BargeInFilterOptions = {}): BargeInFilter {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const echoWindowMs = options.echoWindowMs ?? DEFAULT_ECHO_WINDOW_MS;
  const pairGapMs = options.pairGapMs ?? DEFAULT_PAIR_GAP_MS;
  const now = options.now ?? (() => Date.now());
  const stopWords = new Set((options.stopWords ?? DEFAULT_STOP_WORDS).map(normalize));
  const fillers = new Set((options.fillers ?? DEFAULT_FILLERS).map(normalize));

  let spoken: Array<{ at: number; words: string[] }> = [];
  /** Закреплённые междометия подряд (эхо и осмысленные слова обрывают счёт: осмысленное слово перебивает сразу). */
  let settledRun = { length: 0, lastAt: 0 };

  function spokenWords(at: number): string[] {
    spoken = spoken.filter((entry) => at - entry.at <= echoWindowMs);
    return spoken.flatMap((entry) => entry.words);
  }

  function classify(word: string, recent: string[]): Kind {
    if (stopWords.has(word)) return "stop";
    const sound = soundClassOf(word);
    // Звук того же вида, что агент только что издал, — эхо, как бы распознавание его ни записало.
    const echo = recent.some(
      (said) =>
        said === word ||
        (word.length >= FUZZY_MIN_LENGTH && said.length >= FUZZY_MIN_LENGTH && withinOneEdit(said, word)) ||
        (sound !== null && soundClassOf(said) === sound),
    );
    if (echo) return "echo";
    return fillers.has(word) ? "filler" : "fresh";
  }

  /** Слова с достаточной уверенностью, разбитые по словам. */
  function confident(list: HeardWord[]): string[] {
    return list.filter((word) => word.confidence >= minConfidence).flatMap((word) => tokens(word.text));
  }

  /** Двигает счёт междометий подряд; возвращает решение, если слово перебивает. */
  function step(kind: Kind, run: { length: number; lastAt: number }, at: number): BargeInDecision | null {
    if (kind === "stop") return { interrupt: true, reason: "stop_word" };
    if (kind === "fresh") return { interrupt: true, reason: "words" };
    if (kind === "echo") {
      run.length = 0;
      return null;
    }
    run.length = at - run.lastAt > pairGapMs ? 1 : run.length + 1;
    run.lastAt = at;
    return run.length >= 2 ? { interrupt: true, reason: "two_words" } : null;
  }

  return {
    noteSpoken(text) {
      const words = tokens(text);
      if (words.length > 0) spoken.push({ at: now(), words });
    },

    feed(heard) {
      const at = now();
      const recent = spokenWords(at);
      // Закреплённые слова оцениваются один раз, в момент прихода: позже окно эха уйдёт, а слово останется эхом.
      for (const word of confident(heard.settled)) {
        const decision = step(classify(word, recent), settledRun, at);
        if (decision) return decision;
      }
      // Предварительные слова приходят заново целиком: считаем на копии.
      const run = { ...settledRun };
      for (const word of confident(heard.interim)) {
        const decision = step(classify(word, recent), run, at);
        if (decision) return decision;
      }
      return { interrupt: false };
    },

    reset() {
      settledRun = { length: 0, lastAt: 0 };
    },
  };
}
