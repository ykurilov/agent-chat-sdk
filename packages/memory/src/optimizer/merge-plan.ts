import type { MemoryNote, MemoryNoteInput } from "@ykurilov/agent-chat-core";
import { z } from "zod";
import { duplicateKey, noteSize, parseNoteInput } from "../note-rules";
import type { MemoryLimits } from "../note-rules";
import { hasNegation, meaningfulWords, protectedDetails, wordsSharedByAll } from "./protected-details";

export const MAX_MERGE_GROUPS = 10;
const MIN_GROUP_SIZE = 2;
const MAX_GROUP_SIZE = 4;
/** Результат должен быть короче суммы текстов исходных хотя бы на столько знаков: склейка ради одного знака не стоит риска. */
const MIN_SAVED_CHARS = 4;

/** Что просим у модели: до десяти групп по две–четыре записи и текст с разделами для каждой. */
export const mergeProposalSchema = z.object({
  groups: z
    .array(
      z.object({
        sourceIds: z.array(z.string()).min(MIN_GROUP_SIZE).max(MAX_GROUP_SIZE),
        categories: z.array(z.string()),
        content: z.string(),
      }),
    )
    .max(MAX_MERGE_GROUPS),
});

/** Почему план отвергнут (код пишется в запуск как причина неудачи). */
export type MergePlanCode = "invalid_form" | "unknown_source" | "not_shorter" | "unrelated_group" | "lost_detail" | "duplicate_result" | "too_large";

/** Проверенная склейка: то, что уйдёт в `applyMemoryMerge`. */
export interface PlannedMerge {
  result: MemoryNoteInput;
  originals: { id: string; version: number }[];
}

export type MergePlan = { ok: true; merges: PlannedMerge[] } | { ok: false; code: MergePlanCode };

export interface MergePlanInput {
  /** Записи, что видела модель. */
  snapshot: readonly MemoryNote[];
  /** Ответ модели как есть: доверять нечему. */
  proposal: unknown;
  limits: MemoryLimits;
  /** Наборы записей из отменённых слияний: такие группы пропускаются, а не отвергаются. */
  undone?: readonly (readonly string[])[];
}

const reject = (code: MergePlanCode): MergePlan => ({ ok: false, code });

/** Группа вернула бы слияние, которое человек отменил: две и больше записи совпадают с отменённой группой. */
const isUndone = (sourceIds: readonly string[], undone: readonly (readonly string[])[]) =>
  undone.some((group) => sourceIds.filter((id) => group.includes(id)).length >= MIN_GROUP_SIZE);

/**
 * Строгая проверка предложения модели: модель предлагает, код решает. Любое нарушение отвергает весь план —
 * полумер нет. Пропускаются только группы, которые человек уже отменял. Пустой план — «нечего сливать».
 */
export function validateMergePlan({ snapshot, proposal, limits, undone = [] }: MergePlanInput): MergePlan {
  const parsed = mergeProposalSchema.safeParse(proposal);
  if (!parsed.success) return reject("invalid_form");
  const results: MemoryNoteInput[] = [];
  for (const group of parsed.data.groups) {
    const result = parseNoteInput({ categories: group.categories, content: group.content });
    if (!result.ok) return reject("invalid_form");
    results.push(result.value);
  }

  const byId = new Map(snapshot.map((note) => [note.id, note]));
  const used = new Set<string>();
  const sourcesOf = parsed.data.groups.map((group) =>
    group.sourceIds.map((id) => {
      const note = byId.get(id);
      if (!note || used.has(id)) return null;
      used.add(id);
      return note;
    }),
  );
  if (sourcesOf.some((sources) => sources.includes(null))) return reject("unknown_source");

  const merges: PlannedMerge[] = [];
  for (const [index, group] of parsed.data.groups.entries()) {
    if (isUndone(group.sourceIds, undone)) continue;
    const sources = sourcesOf[index] as MemoryNote[];
    const result = results[index]!;
    const rejection = checkGroup(sources, result);
    if (rejection) return reject(rejection);
    merges.push({ result, originals: sources.map(({ id, version }) => ({ id, version })) });
  }

  const mergedIds = new Set(merges.flatMap((merge) => merge.originals.map((original) => original.id)));
  const staying = snapshot.filter((note) => !mergedIds.has(note.id));
  const keys = new Set(staying.map(duplicateKey));
  for (const { result } of merges) {
    const key = duplicateKey(result);
    if (keys.has(key)) return reject("duplicate_result");
    keys.add(key);
  }
  const totalAfter = [...staying, ...merges.map((merge) => merge.result)].reduce((sum, note) => sum + noteSize(note), 0);
  if (merges.length > 0 && totalAfter > limits.maxTotalChars) return reject("too_large");
  return { ok: true, merges };
}

/** Проверка одной склейки по содержанию. */
function checkGroup(sources: readonly MemoryNote[], result: MemoryNoteInput): MergePlanCode | null {
  const sourceLength = sources.reduce((sum, note) => sum + note.content.length, 0);
  if (result.content.length > sourceLength - MIN_SAVED_CHARS) return "not_shorter";
  const texts = sources.map((note) => note.content);
  if (wordsSharedByAll(texts).size === 0) return "unrelated_group";
  const resultWords = meaningfulWords(result.content);
  if (texts.some((text) => ![...meaningfulWords(text)].some((word) => resultWords.has(word)))) return "unrelated_group";
  const output = result.content.toLocaleLowerCase("ru");
  if (texts.some((text) => protectedDetails(text).some((detail) => !output.includes(detail)))) return "lost_detail";
  // «Не любит кофе» и «Любит кофе» в «Любит кофе» не склеиваются: отрицание нельзя терять.
  if (texts.some(hasNegation) && !hasNegation(result.content)) return "lost_detail";
  return null;
}
