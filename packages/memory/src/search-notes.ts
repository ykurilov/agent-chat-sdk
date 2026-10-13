import type { MemoryNote } from "@ykurilov/agent-chat-core";
import type { Checked } from "./note-rules";
import { sortNotesForBlock } from "./memory-block";

const MIN_WORD_CHARS = 2;

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length >= MIN_WORD_CHARS) ?? [];

/** Поиск по словам без учёта регистра в разделах и тексте. Больше совпавших слов — выше; при равенстве недавние первыми. */
export function searchNotes(notes: readonly MemoryNote[], query: string, limit: number): Checked<{ notes: MemoryNote[]; total: number }> {
  const words = typeof query === "string" ? [...new Set(wordsOf(query))] : [];
  if (words.length === 0) {
    return { ok: false, error: { kind: "invalid", message: "Запрос поиска пуст: назови одно или несколько слов (от двух знаков)." } };
  }
  const scored = sortNotesForBlock(notes)
    .map((note) => {
      const haystack = `${note.categories.join(" ")} ${note.content}`.toLowerCase();
      return { note, score: words.filter((word) => haystack.includes(word)).length };
    })
    .filter((item) => item.score > 0);
  // Сортировка устойчива: при равном числе слов остаётся порядок «недавние первыми».
  scored.sort((left, right) => right.score - left.score);
  return { ok: true, value: { notes: scored.slice(0, limit).map((item) => item.note), total: scored.length } };
}
