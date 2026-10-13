import type { ChatStorage, MemoryMergeRevertResult, MemoryNote, MergedMemoryNote } from "@ykurilov/agent-chat-core";
import { checkCanCreate, defaultMemoryLimits } from "../note-rules";
import type { MemoryLimits } from "../note-rules";
import { createOwnerLock } from "../owner-lock";
import type { OwnerLock } from "../owner-lock";

/** Сколько слияний по умолчанию отдаёт список для экрана. */
const DEFAULT_LIST_LIMIT = 20;

/** Одна склейка: «стало» (результат) и «было» (скрытые оригиналы, в порядке склейки). */
export interface MergedGroupView {
  result: MemoryNote;
  originals: MergedMemoryNote[];
}

/** Слияние одного запуска для экрана «Объединено». */
export interface MemoryMergeRecord {
  runId: string;
  finishedAt: string;
  /** Можно ли «Вернуть как было»: все результаты целы и не менялись. */
  revertible: boolean;
  groups: MergedGroupView[];
}

export interface MergeHistory {
  /** Слитые запуски человека, новейшие первыми. Склейки, чей результат удалён или снова склеен, не показываются. */
  listMerges(ownerId: string, limit?: number): Promise<MemoryMergeRecord[]>;
  /**
   * Возвращает слияние как было. `conflict` — результат с тех пор менялся или его нет; `not_found` — запуска нет или он не слит;
   * `limit_reached` — записей или знаков стало бы больше предела; `duplicate` — среди оригиналов есть факт, записанный заново.
   */
  revertMerge(ownerId: string, runId: string): Promise<MemoryMergeRevertResult>;
}

/** `lock` общий с записью заметок: пока идёт возврат, новая запись не займёт место, которое он проверил. */
export function createMergeHistory(storage: ChatStorage, limits: MemoryLimits = defaultMemoryLimits, lock: OwnerLock = createOwnerLock()): MergeHistory {
  const supported = Boolean(storage.listMemoryNotes && storage.listMemoryOptimizationRuns && storage.listMergedMemoryNotes && storage.revertMemoryMerge);

  return {
    async listMerges(ownerId, limit = DEFAULT_LIST_LIMIT) {
      if (!supported) return [];
      const [runs, visible, hidden] = await Promise.all([
        storage.listMemoryOptimizationRuns!(ownerId, { status: ["applied"] }),
        storage.listMemoryNotes!(ownerId),
        storage.listMergedMemoryNotes!(ownerId),
      ]);
      const visibleById = new Map(visible.map((note) => [note.id, note]));
      const hiddenById = new Map(hidden.map((note) => [note.id, note]));
      const records: MemoryMergeRecord[] = [];
      for (const run of runs) {
        const groups: MergedGroupView[] = [];
        let revertible = run.groups.length > 0;
        for (const { resultId, originalIds, resultVersion } of run.groups) {
          const result = visibleById.get(resultId);
          const originals = originalIds.flatMap((id) => {
            const original = hiddenById.get(id);
            return original?.mergedInto === resultId ? [original] : [];
          });
          if (!result || originals.length === 0) {
            revertible = false;
            continue;
          }
          if (result.version !== resultVersion || originals.length !== originalIds.length) revertible = false;
          groups.push({ result, originals });
        }
        if (groups.length > 0 && run.finishedAt) records.push({ runId: run.id, finishedAt: run.finishedAt, revertible, groups });
      }
      return records.slice(0, limit);
    },

    async revertMerge(ownerId, runId) {
      if (!storage.revertMemoryMerge) return "not_found";
      // Проверка идёт внутри операции хранилища: оно даёт записи, которые останутся, и оригиналы, что вернутся.
      const guard: Parameters<NonNullable<ChatStorage["revertMemoryMerge"]>>[2] = (remaining, restored) => checkCanCreate(remaining, restored, limits);
      return lock(ownerId, async () => storage.revertMemoryMerge!(ownerId, runId, guard));
    },
  };
}
