import type { MemoryError, MemoryNote, MemoryNoteInput } from "./long-term-memory";

/**
 * Состояние запуска оптимизации дублей: идёт → слито / нечего сливать / не удалось; слитое можно вернуть (`reverted`).
 * Запуск `running` у человека не больше одного.
 */
export type MemoryOptimizationStatus = "running" | "applied" | "no_changes" | "failed" | "reverted";

/** Одна склейка: записи `originalIds` скрыты и подчинены новой записи `resultId`. */
export interface MemoryMergeGroup {
  resultId: string;
  originalIds: string[];
  /** Версия результата на момент слияния: пока она та же, результат не менялся и слияние можно вернуть. */
  resultVersion: number;
}

/** Запуск оптимизации. Владелец (`ownerId`) — свойство хранилища и наружу не выдаётся. */
export interface MemoryOptimizationRun {
  id: string;
  /** Время в формате ISO 8601. Часы даёт вызывающий: от них считаются срок между запусками и пауза после сбоя. */
  startedAt: string;
  finishedAt: string | null;
  status: MemoryOptimizationStatus;
  /** Склейки запуска; у не слитых запусков пусто. */
  groups: MemoryMergeGroup[];
  /** Причина сбоя одним словом-кодом; у остальных `null`. */
  error: string | null;
  /** Запись расхода модели, если вызывающий её знает. */
  usageRecordId: string | null;
}

/** Правила запуска: их проверяет хранилище в той же операции, что и берёт запуск, чтобы два процесса не начали его вдвоём. */
export interface MemoryOptimizationRules {
  /** Сколько должно пройти после законченного запуска (слито, нечего сливать, отменено) до следующего. */
  minIntervalMs: number;
  /**
   * Сколько должно пройти после неудачного запуска до повтора. Число — одна пауза на все неудачи; список — паузы после
   * 1-й, 2-й, … неудачи подряд (последняя держится дальше). Успешный, пустой или отменённый запуск начинает счёт заново.
   */
  retryAfterFailureMs: number | readonly number[];
  /** Сколько запуск `running` считается живым; после этого срока он становится неудачным (`failed`, ошибка `lease_expired`). */
  leaseMs: number;
}

/** Чем закончился запуск без слияния. */
export interface MemoryOptimizationOutcome {
  status: "no_changes" | "failed";
  finishedAt: string;
  error?: string | null;
  usageRecordId?: string | null;
}

/** Что слить: новая запись-результат вместо оригиналов; версии оригиналов — те, что видел планировщик. */
export interface MemoryMergeInput {
  runId: string;
  finishedAt: string;
  usageRecordId?: string | null;
  merges: { result: MemoryNoteInput; originals: { id: string; version: number }[] }[];
}

/** Скрытая запись слияния: оригинал, подчинённый результату. Список, блок памяти и поиск таких записей не видят. */
export interface MergedMemoryNote extends MemoryNote {
  mergedInto: string;
}

export type MemoryMergeApplyResult = MemoryOptimizationRun | "stale_version" | "run_not_active";
/** `limit_reached` и `duplicate` — возврат вышел бы за пределы памяти или вернул бы повтор записи, сделанной за это время. */
export type MemoryMergeRevertResult = "ok" | "not_found" | "conflict" | "limit_reached" | "duplicate";

/** Запуск в том виде, что нужен для решения «можно ли начать новый»; время — миллисекунды. */
export interface OptimizationRunTiming {
  status: MemoryOptimizationStatus;
  startedAtMs: number;
  /** Конец запуска; у идущего его нет. */
  endedAtMs: number | null;
}

/** Пауза после неудачи с номером `failuresInRow` (с 1) подряд. */
export function pauseAfterFailure(rules: Pick<MemoryOptimizationRules, "retryAfterFailureMs">, failuresInRow: number): number {
  const { retryAfterFailureMs } = rules;
  if (typeof retryAfterFailureMs === "number") return retryAfterFailureMs;
  return retryAfterFailureMs[Math.min(failuresInRow, retryAfterFailureMs.length) - 1] ?? 0;
}

/**
 * Мешает ли история запусков начать новый: идёт другой, или не вышла пауза после последнего. Пауза после неудачи
 * растёт с числом неудач подряд. Все три хранилища решают этим одним правилом.
 */
export function isOptimizationBlocked(runs: readonly OptimizationRunTiming[], rules: MemoryOptimizationRules, nowMs: number): boolean {
  const ordered = [...runs].sort((left, right) => left.startedAtMs - right.startedAtMs);
  let failuresInRow = 0;
  for (const run of ordered) {
    if (run.status === "running") return true;
    failuresInRow = run.status === "failed" ? failuresInRow + 1 : 0;
    const pause = run.status === "failed" ? pauseAfterFailure(rules, failuresInRow) : rules.minIntervalMs;
    if (nowMs - (run.endedAtMs ?? run.startedAtMs) < pause) return true;
  }
  return false;
}

/** Ответ отката слияния на ошибку проверки: повтор записи — `duplicate`, всё остальное (число, объём) — `limit_reached`. */
export function revertRefusal(error: MemoryError): "limit_reached" | "duplicate" {
  return error.kind === "duplicate" ? "duplicate" : "limit_reached";
}
