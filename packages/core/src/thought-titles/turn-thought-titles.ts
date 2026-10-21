import type { UIMessageChunk } from "ai";
import { cleanThoughtTitle, providerHeadingOf, shortThoughtTitle } from "./thought-title-text";
import type { ThoughtTitleRules } from "./thought-title-text";

/** Заголовки раздумий по порядковому номеру части рассуждения в сообщении («0», «1»…), как `reasoningDurationsMs`. */
export type ThoughtTitles = Record<string, string>;

export interface TurnThoughtTitlesInput {
  /** Язык человека, код («ru»). */
  language: string;
  maxLength: number;
  /** Сколько раз за ход можно звать модель заголовков. */
  maxPerTurn: number;
  /** Раздумье короче — его первое предложение, если оно на языке человека; иначе — пересказ моделью. */
  minChars: number;
  /** Пересказ моделью заголовков: сырой ответ модели; `signal` — «Стоп» хода. Нет — только заголовки провайдера и короткие. */
  summarize?: (text: string, signal?: AbortSignal) => Promise<string | undefined>;
  /** Имена инструментов и навыков хода (и не вызванных): заголовок с ними — техника, а не мысль. */
  toolNames?: readonly string[];
  /** Сигнал хода: «Стоп» отменяет начатые пересказы, новых не будет. */
  signal?: AbortSignal;
  /**
   * Продолжение ответа: сколько раздумий уже в сообщении, их заголовки и сколько раз уже звали модель (`asked`):
   * `maxPerTurn` — на ответ целиком.
   */
  existing?: { count: number; titles: ThoughtTitles; asked?: number };
  /** Карта заголовков изменилась: полная копия. После `close` не зовётся. */
  onChange: (titles: ThoughtTitles) => void;
  logError: (message: string) => void;
}

export type TurnThoughtTitles = ReturnType<typeof createTurnThoughtTitles>;

/** Сколько конец хода ждёт недоделанные заголовки, мс: дольше — они остаются без заголовка. */
export const THOUGHT_TITLES_SETTLE_MS = 1500;

/** Заголовки для хода: всё, кроме того, что ход знает сам. `settleMs` — ожидание в конце хода (`THOUGHT_TITLES_SETTLE_MS`). */
export type TurnThoughtTitlesSource = Omit<TurnThoughtTitlesInput, "existing" | "onChange" | "logError" | "signal"> & { settleMs?: number };

/**
 * Заголовки раздумий одного хода. Смотрит куски потока: копит текст каждого раздумья, на его конце решает — заголовок
 * провайдера (жирная строка на языке человека), короткое раздумье (первое предложение, если оно на языке человека),
 * иначе пересказ моделью (не больше `maxPerTurn` за ход). Ход не ждёт: модель отвечает в фоне, готовый заголовок уходит в `onChange`.
 */
export function createTurnThoughtTitles(input: TurnThoughtTitlesInput) {
  const titles: ThoughtTitles = { ...(input.existing?.titles ?? {}) };
  const open = new Map<string, { key: string; text: string }>();
  const pending = new Set<Promise<void>>();
  const toolNames = new Set<string>(input.toolNames ?? []);
  // Раздумья, которые уже пересказывала модель: отметка ложится в часть, и продолжение ответа знает счёт.
  const askedKeys = new Set<string>();
  let count = input.existing?.count ?? 0;
  // Номер поколения: стирание шага делает ответы, начатые до него, чужими.
  let generation = 0;
  let asked = input.existing?.asked ?? 0;
  let closed = false;

  const rules = (): ThoughtTitleRules => ({ maxLength: input.maxLength, language: input.language, toolNames: [...toolNames] });

  function set(key: string, title: string): void {
    if (closed || titles[key] === title) return;
    titles[key] = title;
    input.onChange({ ...titles });
  }

  function titleFor(key: string, text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const heading = providerHeadingOf(trimmed);
    const fromProvider = heading && cleanThoughtTitle(heading, rules());
    if (fromProvider) return set(key, fromProvider);
    // Короткое раздумье на языке человека — его первое предложение; не на том языке (черновик DeepSeek по-английски) —
    // пересказ моделью, как длинное.
    const short = trimmed.length < input.minChars ? shortThoughtTitle(trimmed, rules()) : undefined;
    if (short) return set(key, short);
    if (!input.summarize || asked >= input.maxPerTurn || input.signal?.aborted) return;
    asked++;
    askedKeys.add(key);
    const started = generation;
    const job = input
      .summarize(trimmed, input.signal)
      .then((raw) => {
        if (started !== generation || raw === undefined) return;
        const title = cleanThoughtTitle(raw, rules());
        if (title) set(key, title);
      })
      .catch((error: unknown) => {
        // «Стоп» — не сбой: пересказ отменён вместе с ходом.
        if (!input.signal?.aborted) input.logError(`[заголовок раздумья] не вышел: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => pending.delete(job));
    pending.add(job);
  }

  return {
    observe(chunk: UIMessageChunk): void {
      if (chunk.type === "reasoning-start") open.set(chunk.id, { key: String(count++), text: "" });
      else if (chunk.type === "reasoning-delta") {
        const current = open.get(chunk.id);
        if (current) current.text += chunk.delta;
      } else if (chunk.type === "reasoning-end") {
        const current = open.get(chunk.id);
        if (!current) return;
        open.delete(chunk.id);
        titleFor(current.key, current.text);
      } else if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") toolNames.add(chunk.toolName);
    },
    /** Имена инструментов набора попытки: весь набор, а не только вызванные. */
    addToolNames(names: readonly string[]): void {
      for (const name of names) toolNames.add(name);
    },
    /** Шаг стёрт: в сообщении осталось `kept` раздумий, заголовки и ответы после них забываются; счёт запросов — нет. */
    rewind(kept: number): void {
      generation++;
      for (const key of Object.keys(titles)) if (Number(key) >= kept) delete titles[key];
      for (const key of askedKeys) if (Number(key) >= kept) askedKeys.delete(key);
      open.clear();
      count = kept;
    },
    titles: (): ThoughtTitles => ({ ...titles }),
    /** Раздумья этого хода, которые пересказывала модель: для отметки в частях. */
    askedKeys: (): string[] => [...askedKeys],
    /** Ждёт начатые пересказы, но не дольше `timeoutMs`: ход кончается, недоделанные останутся без заголовка. */
    async settle(timeoutMs: number): Promise<void> {
      if (pending.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
      await Promise.race([Promise.allSettled([...pending]).then(() => {}), deadline]);
      clearTimeout(timer);
    },
    /** Ход кончился: поздние заголовки больше не принимаются. */
    close(): void {
      closed = true;
    },
  };
}
