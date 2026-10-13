import type { LanguageModel } from "ai";
import type { ChatStorage, MemoryNote, MemoryOptimizationRules, TokenUsage } from "@ykurilov/agent-chat-core";
import { requiredStorageMethods } from "../memory-operations";
import type { MemoryLimits } from "../note-rules";
import { mergeProposalSchema, validateMergePlan } from "./merge-plan";
import type { MergePlanCode } from "./merge-plan";
import { proposeMerges } from "./propose-merges";
import type { ProposalFailureCode } from "./propose-merges";

/** Методы хранилища, без которых оптимизация дублей не работает (сверх методов памяти). */
export const requiredOptimizerMethods = [
  "claimMemoryOptimizationRun",
  "finishMemoryOptimizationRun",
  "applyMemoryMerge",
  "revertMemoryMerge",
  "listMemoryOptimizationRuns",
  "listMergedMemoryNotes",
] as const;

export type OptimizerStorage = ChatStorage & Required<Pick<ChatStorage, (typeof requiredStorageMethods)[number] | (typeof requiredOptimizerMethods)[number]>>;

const HOUR_MS = 3_600_000;
/** Запуск живёт дольше запроса к модели (2 минуты) с запасом; потом хранилище считает его потерянным. */
const LEASE_MS = 5 * 60_000;
const MIN_NOTES = 2;

/**
 * Правила запуска: раз в `intervalHours` (по умолчанию сутки). После неудач подряд пауза растёт: час, потом 6 часов,
 * потом сутки, — чтобы постоянный сбой (модель без структурного вывода, обрыв ответа) не платил каждый час.
 * Удачный запуск сбрасывает счёт.
 */
export function optimizerRules(intervalHours = 24): MemoryOptimizationRules {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) throw new RangeError("Срок между запусками оптимизации — число часов больше нуля");
  return { minIntervalMs: intervalHours * HOUR_MS, retryAfterFailureMs: [HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS], leaseMs: LEASE_MS };
}

/** Код причины неудачи, как он пишется в запуск. */
export type OptimizationFailure = MergePlanCode | ProposalFailureCode | "snapshot_changed" | "run_not_active" | "internal_error";

export type OptimizationResult =
  | { status: "skipped" }
  /** `cause` — то, что стоит записать в журнал (сбой модели или хранилища); у отказов проверки его нет. */
  | { status: "applied" | "no_changes" | "failed"; runId: string; error?: OptimizationFailure; cause?: unknown };

export interface OptimizationInput {
  storage: OptimizerStorage;
  ownerId: string;
  /** Модель, что вела ход. */
  model: LanguageModel;
  recordUsage(usage: TokenUsage): Promise<string | null>;
  limits: MemoryLimits;
  rules: MemoryOptimizationRules;
  /** Часы: от них считаются срок между запусками и пауза после неудачи. */
  now: () => Date;
}

/** Снимок не менялся: те же записи в тех же версиях. */
function sameSnapshot(before: readonly MemoryNote[], after: readonly MemoryNote[]): boolean {
  const versions = new Map(before.map((note) => [note.id, note.version]));
  return before.length === after.length && after.every((note) => versions.get(note.id) === note.version);
}

/** Предложение только из групп, все записи которых остались на месте в тех же версиях, что видела модель. */
function proposalOfUnchangedGroups(proposal: unknown, before: readonly MemoryNote[], after: readonly MemoryNote[]) {
  const seen = new Map(before.map((note) => [note.id, note.version]));
  const now = new Map(after.map((note) => [note.id, note.version]));
  const unchanged = (id: string) => seen.has(id) && seen.get(id) === now.get(id);
  return { groups: mergeProposalSchema.parse(proposal).groups.filter((group) => group.sourceIds.every(unchanged)) };
}

/**
 * Один запуск оптимизации дублей: берёт запуск у хранилища (раз в срок, один на человека), просит у модели
 * предложение, строго проверяет его кодом и применяет одной операцией. Любая неудача закрывает запуск с кодом
 * причины и ничего не меняет в записях. Если записи поменялись, пока модель думала, отвергаются только склейки
 * с затронутыми записями. Не бросает: сбой уходит в `cause` результата.
 */
export async function runMemoryOptimization(input: OptimizationInput): Promise<OptimizationResult> {
  const { storage, ownerId } = input;
  const enoughNotes = async () => (await storage.listMemoryNotes(ownerId)).length >= MIN_NOTES;
  if (!(await enoughNotes())) return { status: "skipped" };
  const run = await storage.claimMemoryOptimizationRun(ownerId, input.rules, input.now().toISOString());
  if (!run) return { status: "skipped" };
  const runId = run.id;
  let usageRecordId: string | null = null;

  const close = async (status: "no_changes" | "failed", error?: OptimizationFailure, cause?: unknown): Promise<OptimizationResult> => {
    await storage.finishMemoryOptimizationRun(ownerId, runId, { status, finishedAt: input.now().toISOString(), error: error ?? null, usageRecordId });
    return { status, runId, ...(error && { error }), ...(cause !== undefined && { cause }) };
  };

  try {
    const snapshot = await storage.listMemoryNotes(ownerId);
    if (snapshot.length < MIN_NOTES) return await close("no_changes");

    const proposed = await proposeMerges({ model: input.model, notes: snapshot });
    if (proposed.usage) usageRecordId = await input.recordUsage(proposed.usage).catch(() => null);
    if (!proposed.ok) return await close("failed", proposed.code, proposed.cause);

    const reverted = await storage.listMemoryOptimizationRuns(ownerId, { status: ["reverted"] });
    const undone = reverted.flatMap((past) => past.groups.map((group) => group.originalIds));
    const plan = validateMergePlan({ snapshot, proposal: proposed.proposal, limits: input.limits, undone });
    if (!plan.ok) return await close("failed", plan.code);
    if (plan.merges.length === 0) return await close("no_changes");

    // Пока модель думала, записи могли поменяться: отвергаются только склейки с изменившимися записями,
    // остальные проверяются заново уже по свежим записям (повтор результата, предел объёма).
    let merges = plan.merges;
    const current = await storage.listMemoryNotes(ownerId);
    if (!sameSnapshot(snapshot, current)) {
      const replan = validateMergePlan({ snapshot: current, proposal: proposalOfUnchangedGroups(proposed.proposal, snapshot, current), limits: input.limits, undone });
      if (!replan.ok) return await close("failed", replan.code);
      if (replan.merges.length === 0) return await close("failed", "snapshot_changed");
      merges = replan.merges;
    }
    const applied = await storage.applyMemoryMerge(ownerId, { runId, finishedAt: input.now().toISOString(), usageRecordId, merges });
    if (applied === "stale_version") return await close("failed", "snapshot_changed");
    // Запуск уже закрыт другим (наш срок вышел): записывать нечего.
    if (applied === "run_not_active") return { status: "failed", runId, error: "run_not_active" };
    return { status: "applied", runId };
  } catch (failure) {
    try {
      return await close("failed", "internal_error", failure);
    } catch {
      return { status: "failed", runId, error: "internal_error", cause: failure };
    }
  }
}
