import type { Skill, SkillBrief } from "../types";

/** Порядок по имени — по кодам знаков: одинаковый в памяти, SQLite и PostgreSQL при любой локали базы. */
export function byName<T extends { name: string }>(left: T, right: T): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

/** Текст навыка не изменился: новая версия не нужна. */
export function sameText(skill: Skill, edit: { whenToUse: string; body: string }): boolean {
  return skill.whenToUse === edit.whenToUse && skill.body === edit.body;
}

/** PostgreSQL не хранит символ NUL в тексте; все хранилища убирают его до записи, чтобы вести себя одинаково. */
export function withoutNul(text: string): string {
  return text.replaceAll("\u0000", "");
}

/** Текст навыка без символа NUL. */
export function storedText(text: { whenToUse: string; body: string }): { whenToUse: string; body: string } {
  return { whenToUse: withoutNul(text.whenToUse), body: withoutNul(text.body) };
}

/** Навык без тела. */
export function brief({ body: _body, ...skill }: Skill): SkillBrief {
  return skill;
}
