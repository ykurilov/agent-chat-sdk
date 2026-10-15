import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { InvalidSkillReason } from "../skill-rules";
import type { SkillStatus } from "../types";

/** Надписи экрана навыков. */
export interface SkillsLabels {
  title: string;
  create: string;
  empty: string;
  loading: string;
  failed: string;
  retry: string;
  notFound: string;
  pickSkill: string;
  statuses: Record<SkillStatus, string>;
  status: string;
  /** «3 загрузки» рядом с навыком в списке. */
  loadsCount: (count: number) => string;
  /** «Версия 3» в шапке навыка. */
  versionLabel: (version: number) => string;
  /** «Правка: anna, 15.10.2026, 12:05». */
  updatedBy: (author: string, time: string) => string;
  /** Время для людей из ISO. */
  formatTime: (iso: string) => string;
  name: string;
  nameHint: string;
  whenToUse: string;
  whenToUseHint: string;
  body: string;
  edit: string;
  preview: string;
  previewEmpty: string;
  counter: (length: number, max: number) => string;
  save: string;
  saving: string;
  cancel: string;
  delete: string;
  deleteConfirm: (name: string) => string;
  deleteYes: string;
  /** Переход или откат при несохранённых правках. */
  discardWarning: string;
  discardYes: string;
  stay: string;
  deleting: string;
  conflict: string;
  reloadLatest: string;
  versions: string;
  current: string;
  /** Строка версии: «Версия 2 · boris · 15.10.2026, 12:05». */
  versionRow: (version: number, author: string, time: string) => string;
  showChanges: string;
  hideChanges: string;
  rollback: (version: number) => string;
  rollingBack: string;
  loads: string;
  loadsTotal: (count: number) => string;
  noLoads: string;
  /** Строка учёта: «Чат chat-1 · anna · версия 2 · 15.10.2026, 12:05». */
  loadRow: (chatId: string, ownerId: string, version: number, time: string) => string;
  errors: Record<InvalidSkillReason | "skill_exists" | "too_large" | "other", string>;
}

const russianPlural = (count: number, one: string, few: string, many: string) => {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
};

export const russianSkillsLabels: SkillsLabels = {
  title: "Навыки агента",
  create: "Новый навык",
  empty: "Навыков пока нет",
  loading: "Загружаем…",
  failed: "Не загрузилось",
  retry: "Повторить",
  notFound: "Не найдено",
  pickSkill: "Выберите навык слева или создайте новый",
  statuses: { off: "Выключен", admins: "Только админам", everyone: "Всем" },
  status: "Кому виден",
  loadsCount: (count) => `${count} ${russianPlural(count, "загрузка", "загрузки", "загрузок")}`,
  versionLabel: (version) => `Версия ${version}`,
  updatedBy: (author, time) => `Правка: ${author}, ${time}`,
  formatTime: (iso) => new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }),
  name: "Имя",
  nameHint: "Строчные буквы, цифры и дефис, 2–48 знаков. Потом не меняется.",
  whenToUse: "Когда брать",
  whenToUseHint: "1–2 фразы: агент видит их в списке навыков и по ним решает, загружать ли навык.",
  body: "Указания (markdown)",
  edit: "Текст",
  preview: "Предпросмотр",
  previewEmpty: "Пусто",
  counter: (length, max) => `${length} / ${max}`,
  save: "Сохранить",
  saving: "Сохраняем…",
  cancel: "Отмена",
  delete: "Удалить",
  deleteConfirm: (name) => `Удалить навык «${name}» со всеми версиями и учётом?`,
  deleteYes: "Да, удалить",
  discardWarning: "Несохранённые правки пропадут.",
  discardYes: "Уйти без сохранения",
  stay: "Остаться",
  deleting: "Удаляем…",
  conflict: "Навык успели изменить, пока вы правили. Загрузите свежую версию и внесите правку снова.",
  reloadLatest: "Загрузить свежую",
  versions: "История версий",
  current: "текущая",
  versionRow: (version, author, time) => `Версия ${version} · ${author} · ${time}`,
  showChanges: "Что изменилось",
  hideChanges: "Скрыть",
  rollback: (version) => `Вернуть версию ${version}`,
  rollingBack: "Возвращаем…",
  loads: "Где загружали",
  loadsTotal: (count) => `Всего: ${count}`,
  noLoads: "Агент ещё не загружал этот навык",
  loadRow: (chatId, ownerId, version, time) => `Чат ${chatId} · ${ownerId} · версия ${version} · ${time}`,
  errors: {
    name_format: "Имя: строчные латинские или русские буквы, цифры и дефис, 2–48 знаков, не с дефиса",
    when_to_use_empty: "Напишите, когда брать навык",
    when_to_use_too_long: "«Когда брать» — не длиннее 300 знаков",
    when_to_use_multiline: "«Когда брать» — одной строкой",
    body_empty: "Напишите указания",
    body_too_long: "Указания длиннее предела",
    status_unknown: "Неизвестный статус",
    skill_exists: "Навык с таким именем уже есть",
    too_large: "Слишком большой текст",
    other: "Не сохранилось. Попробуйте ещё раз",
  },
};

export const englishSkillsLabels: SkillsLabels = {
  title: "Agent skills",
  create: "New skill",
  empty: "No skills yet",
  loading: "Loading…",
  failed: "Failed to load",
  retry: "Retry",
  notFound: "Not found",
  pickSkill: "Pick a skill on the left or create a new one",
  statuses: { off: "Off", admins: "Admins only", everyone: "Everyone" },
  status: "Visible to",
  loadsCount: (count) => `${count} ${count === 1 ? "load" : "loads"}`,
  versionLabel: (version) => `Version ${version}`,
  updatedBy: (author, time) => `Edited by ${author}, ${time}`,
  formatTime: (iso) => new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }),
  name: "Name",
  nameHint: "Lowercase letters, digits and hyphens, 2–48 characters. Cannot be changed later.",
  whenToUse: "When to use",
  whenToUseHint: "1–2 sentences: the agent sees them in the skills list and decides whether to load the skill.",
  body: "Instructions (markdown)",
  edit: "Text",
  preview: "Preview",
  previewEmpty: "Empty",
  counter: (length, max) => `${length} / ${max}`,
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  delete: "Delete",
  deleteConfirm: (name) => `Delete skill “${name}” with all versions and load history?`,
  deleteYes: "Yes, delete",
  discardWarning: "Unsaved changes will be lost.",
  discardYes: "Leave without saving",
  stay: "Stay",
  deleting: "Deleting…",
  conflict: "Someone changed this skill while you were editing. Load the latest version and make your edit again.",
  reloadLatest: "Load latest",
  versions: "Version history",
  current: "current",
  versionRow: (version, author, time) => `Version ${version} · ${author} · ${time}`,
  showChanges: "What changed",
  hideChanges: "Hide",
  rollback: (version) => `Restore version ${version}`,
  rollingBack: "Restoring…",
  loads: "Where it was loaded",
  loadsTotal: (count) => `Total: ${count}`,
  noLoads: "The agent has not loaded this skill yet",
  loadRow: (chatId, ownerId, version, time) => `Chat ${chatId} · ${ownerId} · version ${version} · ${time}`,
  errors: {
    name_format: "Name: lowercase Latin or Cyrillic letters, digits and hyphens, 2–48 characters, not starting with a hyphen",
    when_to_use_empty: "Say when to use the skill",
    when_to_use_too_long: "“When to use” must be at most 300 characters",
    when_to_use_multiline: "“When to use” must be a single line",
    body_empty: "Write the instructions",
    body_too_long: "Instructions are over the limit",
    status_unknown: "Unknown status",
    skill_exists: "A skill with this name already exists",
    too_large: "The text is too large",
    other: "Not saved. Please try again",
  },
};

const SkillsLabelsContext = createContext<SkillsLabels>(russianSkillsLabels);

/** Свой словарь экрана навыков; без провайдера — русский. */
export function SkillsLabelsProvider({ labels, children }: { labels: SkillsLabels; children?: ReactNode }) {
  return createElement(SkillsLabelsContext.Provider, { value: labels }, children);
}

export function useSkillsLabels(): SkillsLabels {
  return useContext(SkillsLabelsContext);
}
