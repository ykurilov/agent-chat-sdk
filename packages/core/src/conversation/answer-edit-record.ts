import type { StoredMessage } from "./types";
import { AnswerEditError } from "./edit-answer-parts";

const PART = "data-answer-edit";
/** Durable, storage-only lineage. The original answer remains a sibling, untouched. */
export interface AnswerEditRecord {
  sourceMessageId: string;
  ownerId: string;
  editedAt: string;
  data?: Record<string, unknown>;
}
/** Hook delivery is retried in this process; use messageId as the idempotency key. */
export interface AnswerEditedInput extends AnswerEditRecord {
  chatId: string;
  messageId: string;
  sourceText: string;
  text: string;
}
export type AnswerEditedHandler = (input: AnswerEditedInput) => void | Promise<void>;
export function answerEditOf(parts: StoredMessage["parts"]): AnswerEditRecord | undefined {
  const part = parts.find(p => p.type === PART);
  if (!part || !("data" in part) || !part.data || typeof part.data !== "object") return undefined;
  const value = part.data as AnswerEditRecord;
  return typeof value.sourceMessageId === "string" && typeof value.ownerId === "string" && typeof value.editedAt === "string" ? value : undefined;
}
export function withoutAnswerEdit(parts: StoredMessage["parts"]): StoredMessage["parts"] {
  return parts.filter(p => p.type !== PART);
}
export function withAnswerEdit(parts: StoredMessage["parts"], record: AnswerEditRecord): StoredMessage["parts"] {
  return [...withoutAnswerEdit(parts), { type: PART, data: record }];
}
/** Reject values JSON would silently lose or coerce, cycles, excessive depth and oversized payloads. */
export function checkedAnswerEditData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (data === undefined) return undefined;
  const ancestors = new Set<object>();
  function json(value: unknown, depth: number): boolean {
    if (depth > 32) return false;
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || ancestors.has(value)) return false;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    ancestors.add(value);
    const ok = Object.values(value).every(v => json(v, depth + 1));
    ancestors.delete(value);
    return ok;
  }
  try {
    if (data === null || typeof data !== "object" || Array.isArray(data) || !json(data, 0)) throw new Error();
    const encoded = JSON.stringify(data);
    if (new TextEncoder().encode(encoded).length > 16 * 1024) throw new Error();
    return JSON.parse(encoded) as Record<string, unknown>;
  } catch { throw new AnswerEditError("invalid_data"); }
}
