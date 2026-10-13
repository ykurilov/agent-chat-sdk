import type { MemoryNote } from "./memory-types";

/** Раздел дерева: записи, лежащие прямо в нём, и вложенные разделы. */
export interface MemoryTreeGroup {
  name: string;
  /** Путь от верхнего раздела, имена в нижнем регистре: годится в ключ. */
  key: string;
  notes: MemoryNote[];
  groups: MemoryTreeGroup[];
  /** Записей в разделе вместе с вложенными. */
  count: number;
}

/**
 * Раскладывает записи по разделам: запись с разделами `["О себе", "Работа"]` лежит в «Работа» внутри «О себе».
 * Разделы, различающиеся только регистром, сливаются (имя берётся у первой записи); разделы идут по алфавиту,
 * записи — в порядке списка.
 */
export function buildMemoryTree(notes: readonly MemoryNote[]): MemoryTreeGroup[] {
  const roots: MemoryTreeGroup[] = [];
  for (const note of notes) {
    let level = roots;
    let key = "";
    note.categories.forEach((name, index) => {
      key = `${key}/${name.trim().toLowerCase()}`;
      let group = level.find((candidate) => candidate.key === key);
      if (!group) {
        group = { name: name.trim(), key, notes: [], groups: [], count: 0 };
        level.push(group);
      }
      group.count += 1;
      if (index === note.categories.length - 1) group.notes.push(note);
      level = group.groups;
    });
  }
  return sortGroups(roots);
}

function sortGroups(groups: MemoryTreeGroup[]): MemoryTreeGroup[] {
  for (const group of groups) sortGroups(group.groups);
  return groups.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
