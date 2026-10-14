import type { StateMap } from "../engine/migrate-run";
import type { ChatsInState, MigrateBatchInput, PendingFlowChange } from "./flow-store";

// Общее у трёх хранилищ сценариев: одинаковые ключи, порядок и правила, чтобы договор держался везде.

/** Ожидающий перевод версии. Ключ с временем: перевод v1 → v2 → v1 → v2 не схлопывается в один. */
export function migratePending(input: MigrateBatchInput): PendingFlowChange {
  return { kind: "migrate", key: `migrate:${input.toVersionId}:${input.at}`, versionId: input.toVersionId, map: input.map, at: input.at };
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
