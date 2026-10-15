import { SKILL_STATUSES } from "./types";
import type { SkillStatus } from "./types";
import { withoutNul } from "./store/skill-store";

/** Имя: строчные латинские или русские буквы, цифры, дефис; 2–48 знаков; первый знак — не дефис. */
export const SKILL_NAME_PATTERN = /^[a-zа-яё0-9][a-zа-яё0-9-]{1,47}$/;
export const MAX_WHEN_TO_USE_CHARS = 300;
export const DEFAULT_MAX_BODY_CHARS = 50_000;

export type InvalidSkillReason =
  | "name_format"
  | "when_to_use_empty"
  | "when_to_use_too_long"
  | "when_to_use_multiline"
  | "body_empty"
  | "body_too_long"
  | "status_unknown";

/** Навык не прошёл проверку: какое поле и почему. */
export class InvalidSkillError extends Error {
  constructor(
    readonly field: "name" | "whenToUse" | "body" | "status",
    readonly reason: InvalidSkillReason,
  ) {
    super(`Invalid skill ${field}: ${reason}`);
    this.name = "InvalidSkillError";
  }
}

export function checkSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) throw new InvalidSkillError("name", "name_format");
}

/** Любой перевод строки, включая юникодные: `whenToUse` — одна строка списка в вопросе модели. */
const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;

/** Проверяет и чистит текст: без символа NUL (его не хранит ни одно хранилище), `whenToUse` без пробелов по краям. */
export function checkSkillText(text: { whenToUse: string; body: string }, maxBodyChars: number): { whenToUse: string; body: string } {
  const whenToUse = withoutNul(text.whenToUse).trim();
  const body = withoutNul(text.body);
  if (whenToUse === "") throw new InvalidSkillError("whenToUse", "when_to_use_empty");
  if (LINE_BREAK.test(whenToUse)) throw new InvalidSkillError("whenToUse", "when_to_use_multiline");
  if (whenToUse.length > MAX_WHEN_TO_USE_CHARS) throw new InvalidSkillError("whenToUse", "when_to_use_too_long");
  if (body.trim() === "") throw new InvalidSkillError("body", "body_empty");
  if (body.length > maxBodyChars) throw new InvalidSkillError("body", "body_too_long");
  return { whenToUse, body };
}

export function checkSkillStatus(status: string): SkillStatus {
  if (!(SKILL_STATUSES as readonly string[]).includes(status)) throw new InvalidSkillError("status", "status_unknown");
  return status as SkillStatus;
}
