import type { StateMap } from "../engine/migrate-run";
import type { ChatsInState, FlowPendingDelivery, MigrateBatchInput, PendingFlowChange, TakePendingTurn } from "./flow-store";

// Общее у трёх хранилищ сценариев: одинаковые ключи, порядок и правила, чтобы договор держался везде.

/** Ожидающий перевод версии. Ключ с временем: перевод v1 → v2 → v1 → v2 не схлопывается в один. */
export function migratePending(input: MigrateBatchInput): PendingFlowChange {
  return { kind: "migrate", key: `migrate:${input.toVersionId}:${input.at}`, versionId: input.toVersionId, map: input.map, at: input.at };
}

/** Переход, применённый в срок без хода: «забрать» его не снимает — «Переделать» на той же ветке применит его снова. */
export const appliedInTime = (change: PendingFlowChange): boolean => change.kind === "transition" && change.appliedAt !== undefined;

/**
 * `takePending`: что отдать ходу и что оставить в записи. Без хода — отдать всё, оставить применённые в срок. С ходом —
 * стереть забранное ходом, чьё место записано, остальное отдать и оставить с пометкой этого хода.
 */
export function pendingTaken(pending: readonly PendingFlowChange[], turn?: TakePendingTurn): { taken: PendingFlowChange[]; kept: PendingFlowChange[] } {
  if (!turn) return { taken: [...pending], kept: pending.filter(appliedInTime) };
  const taken = pendingNotLanded(pending, turn.landedTurnId).map(withoutTaker);
  return { taken, kept: taken.map((change) => (appliedInTime(change) ? change : { ...change, takenBy: turn.turnId })) };
}

const withoutTaker = ({ takenBy: _takenBy, ...change }: PendingFlowChange) => change as PendingFlowChange;

/** Ожидающее, которое место чата ещё не учло: без забранного ходом `landedTurnId`, чьё место записано. */
export const pendingNotLanded = (pending: readonly PendingFlowChange[], landedTurnId: string | null): PendingFlowChange[] =>
  pending.filter((change) => appliedInTime(change) || change.takenBy === undefined || change.takenBy !== landedTurnId);

/**
 * Ожидающее после `addPending`: новый ключ — в конец; тот же ключ — прежний остаётся, но `appliedAt` нового дописывается,
 * если его не было (переход отложили ночью, а утром применили в срок). Ничего не изменилось — `null`.
 */
export function pendingAdded(pending: readonly PendingFlowChange[], change: PendingFlowChange): PendingFlowChange[] | null {
  const index = pending.findIndex((item) => item.key === change.key);
  if (index === -1) return [...pending, change];
  const existing = pending[index]!;
  if (existing.kind !== "transition" || change.kind !== "transition" || change.appliedAt === undefined || existing.appliedAt !== undefined) return null;
  return pending.map((item, at) => (at === index ? { ...existing, appliedAt: change.appliedAt } : item));
}

/** Состояние после перевода: удалённое — по карте, остальное как было. Зеркало для подсчёта до следующего хода. */
export const mappedState = (stateId: string, map: StateMap): string => (Object.hasOwn(map, stateId) ? map[stateId]! : stateId);

export const byVersionAndState = (left: ChatsInState, right: ChatsInState) =>
  compareText(left.versionId, right.versionId) || compareText(left.stateId, right.stateId);

/** Порядок строк как у базы (`COLLATE "C"` и `BINARY`): по кодам символов, без учёта языка. */
export const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Время к одному виду: `toISOString` с миллисекундами, как его вернёт база. */
export const normalizeTime = (iso: string) => new Date(iso).toISOString();

/** PostgreSQL не хранит символ NUL ни в тексте, ни в JSON: вырезаем его до записи. */
export function withoutNul<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replaceAll("\u0000", "") as T;
  if (typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === "string" ? item.replaceAll("\u0000", "") : item))) as T;
}

/** Запись доставки к одному виду: времена — как их вернёт база. */
export function normalizedDelivery(delivery: FlowPendingDelivery): FlowPendingDelivery {
  return {
    ...delivery,
    retryAt: normalizeTime(delivery.retryAt),
    ...(delivery.pausedAt !== undefined && { pausedAt: normalizeTime(delivery.pausedAt) }),
    ...(delivery.resumedAt !== undefined && { resumedAt: normalizeTime(delivery.resumedAt) }),
  };
}

/** Та же запись доставки для `swapDelivery`: обе нет или совпали `messageId`, `attempt` и `token`. */
export function sameDelivery(stored: FlowPendingDelivery | null, expected: FlowPendingDelivery | null): boolean {
  if (stored === null || expected === null) return stored === expected;
  return stored.messageId === expected.messageId && stored.attempt === expected.attempt && (stored.token ?? null) === (expected.token ?? null);
}

/** Сколько дней счётчика «писал первым» хранится до текущего дня человека. */
const FIRST_MESSAGE_DAYS_KEPT = 7;

/** День, раньше которого счётчики человека убираются: `day` — «ГГГГ-ММ-ДД». */
export const firstMessagesKeptFrom = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - FIRST_MESSAGE_DAYS_KEPT * 86_400_000).toISOString().slice(0, 10);
