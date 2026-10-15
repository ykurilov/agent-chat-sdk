/** Строка разницы двух текстов: была и осталась, добавлена, убрана. */
export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** Предел таблицы точной разницы (строки старого × строки нового): около 16 МБ памяти и доли секунды. */
const MAX_EXACT_CELLS = 4_000_000;

/**
 * Разница по строкам. Общее начало и конец — как есть; середина — точно (самая длинная общая часть остаётся),
 * если таблица на произведение строк в пределе. Огромная середина — упрощённо: вся убрана и вся добавлена.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const old = before === "" ? [] : before.split("\n");
  const next = after === "" ? [] : after.split("\n");
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let oldEnd = old.length;
  let nextEnd = next.length;
  while (oldEnd > start && nextEnd > start && old[oldEnd - 1] === next[nextEnd - 1]) {
    oldEnd--;
    nextEnd--;
  }
  const same = (lines: string[]) => lines.map((text): DiffLine => ({ kind: "same", text }));
  const oldMiddle = old.slice(start, oldEnd);
  const nextMiddle = next.slice(start, nextEnd);
  const middle =
    oldMiddle.length * nextMiddle.length <= MAX_EXACT_CELLS
      ? exactDiff(oldMiddle, nextMiddle)
      : [
          ...oldMiddle.map((text): DiffLine => ({ kind: "removed", text })),
          ...nextMiddle.map((text): DiffLine => ({ kind: "added", text })),
        ];
  return [...same(old.slice(0, start)), ...middle, ...same(old.slice(oldEnd))];
}

function exactDiff(old: string[], next: string[]): DiffLine[] {
  const common = Array.from({ length: old.length + 1 }, () => new Int32Array(next.length + 1));
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      common[i]![j] = old[i] === next[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length && j < next.length) {
    if (old[i] === next[j]) {
      lines.push({ kind: "same", text: old[i]! });
      i++;
      j++;
    } else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
      lines.push({ kind: "removed", text: old[i++]! });
    } else {
      lines.push({ kind: "added", text: next[j++]! });
    }
  }
  while (i < old.length) lines.push({ kind: "removed", text: old[i++]! });
  while (j < next.length) lines.push({ kind: "added", text: next[j++]! });
  return lines;
}
