import type { MemoryError, MemoryNote, MemoryNoteInput } from "@ykurilov/agent-chat-core";

export interface MemoryLimits {
  /** Записей на человека. */
  maxNotes: number;
  /** Знаков в сумме: разделы и тексты всех записей. */
  maxTotalChars: number;
  /** Записей в одном действии `create`. */
  maxBatch: number;
  /** Знаков в блоке памяти, который идёт в запрос. */
  maxBlockChars: number;
  /** Записей в ответе поиска. */
  searchLimit: number;
}

export const defaultMemoryLimits: MemoryLimits = {
  maxNotes: 200,
  maxTotalChars: 48_000,
  maxBatch: 5,
  maxBlockChars: 12_000,
  searchLimit: 10,
};

const MAX_CATEGORIES = 3;
const MAX_CATEGORY_CHARS = 60;
const MAX_CONTENT_CHARS = 500;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: MemoryError };

const invalid = (message: string): { ok: false; error: MemoryError } => ({ ok: false, error: { kind: "invalid", message } });

/** Символ с кодом ноль выбрасывается: Postgres не принимает его в тексте записи. */
const squeezeSpaces = (text: string) => text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();

/** Форма одной записи: 1–3 раздела до 60 знаков без «/», текст до 500 знаков. Пробелы схлопываются. */
export function parseNoteInput(input: unknown): Checked<MemoryNoteInput> {
  if (typeof input !== "object" || input === null) return invalid("Запись должна быть объектом с полями categories и content.");
  const { categories, content } = input as { categories?: unknown; content?: unknown };
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > MAX_CATEGORIES) {
    return invalid(`Разделов должно быть от 1 до ${MAX_CATEGORIES}.`);
  }
  const cleanCategories: string[] = [];
  for (const category of categories) {
    if (typeof category !== "string") return invalid("Раздел — это строка.");
    const clean = squeezeSpaces(category);
    if (!clean) return invalid("Раздел не может быть пустым.");
    if (clean.length > MAX_CATEGORY_CHARS) return invalid(`Раздел длиннее ${MAX_CATEGORY_CHARS} знаков.`);
    if (clean.includes("/")) return invalid("В названии раздела нельзя «/»: слэш разделяет уровни. Задай уровни отдельными разделами.");
    cleanCategories.push(clean);
  }
  if (typeof content !== "string") return invalid("Текст записи — это строка.");
  const cleanContent = squeezeSpaces(content);
  if (!cleanContent) return invalid("Текст записи не может быть пустым.");
  if (cleanContent.length > MAX_CONTENT_CHARS) return invalid(`Текст записи длиннее ${MAX_CONTENT_CHARS} знаков: сократи или раздели на несколько записей.`);
  return { ok: true, value: { categories: cleanCategories, content: cleanContent } };
}

/** Пакет `create`: от 1 до `maxBatch` записей, все годные. */
export function parseNoteBatch(input: unknown, limits: Pick<MemoryLimits, "maxBatch">): Checked<MemoryNoteInput[]> {
  if (!Array.isArray(input) || input.length < 1 || input.length > limits.maxBatch) {
    return invalid(`Записей в одном действии должно быть от 1 до ${limits.maxBatch}.`);
  }
  const notes: MemoryNoteInput[] = [];
  for (const item of input) {
    const parsed = parseNoteInput(item);
    if (!parsed.ok) return parsed;
    notes.push(parsed.value);
  }
  return { ok: true, value: notes };
}

/** Ключ дубля: без регистра и лишних пробелов; порядок разделов важен, границы полей не смешиваются. */
export function duplicateKey(note: MemoryNoteInput): string {
  return JSON.stringify([note.categories.map((category) => squeezeSpaces(category).toLowerCase()), squeezeSpaces(note.content).toLowerCase()]);
}

/** Размер записи для предела объёма: разделы плюс текст. */
export function noteSize(note: MemoryNoteInput): number {
  return note.categories.reduce((sum, category) => sum + category.length, 0) + note.content.length;
}

const totalSize = (notes: readonly MemoryNoteInput[]) => notes.reduce((sum, note) => sum + noteSize(note), 0);

const duplicateError: MemoryError = { kind: "duplicate", message: "Такая запись уже есть. Обнови существующую (search, затем update) вместо второй." };
const limitError = (what: string): MemoryError => ({
  kind: "limit_reached",
  message: `Память заполнена (${what}). Удали ненужные записи (delete) или объедини похожие, потом повтори.`,
});

/** Можно ли добавить пакет: дубли, число записей, объём. Ничего не записано — `null`. */
export function checkCanCreate(existing: readonly MemoryNote[], added: readonly MemoryNoteInput[], limits: MemoryLimits): MemoryError | null {
  const keys = new Set(existing.map(duplicateKey));
  for (const note of added) {
    const key = duplicateKey(note);
    if (keys.has(key)) return duplicateError;
    keys.add(key);
  }
  if (existing.length + added.length > limits.maxNotes) return limitError(`не больше ${limits.maxNotes} записей`);
  if (totalSize(existing) + totalSize(added) > limits.maxTotalChars) return limitError(`не больше ${limits.maxTotalChars} знаков`);
  return null;
}

/** Можно ли заменить запись `id` на `next`: она есть, не дубль другой и не выводит за предел объёма. */
export function checkCanUpdate(existing: readonly MemoryNote[], id: string, next: MemoryNoteInput, limits: MemoryLimits): MemoryError | null {
  const current = existing.find((note) => note.id === id);
  if (!current) return { kind: "not_found", message: "Такой записи нет. Найди её заново действием search." };
  const key = duplicateKey(next);
  if (existing.some((note) => note.id !== id && duplicateKey(note) === key)) return duplicateError;
  if (totalSize(existing) - noteSize(current) + noteSize(next) > limits.maxTotalChars) return limitError(`не больше ${limits.maxTotalChars} знаков`);
  return null;
}
