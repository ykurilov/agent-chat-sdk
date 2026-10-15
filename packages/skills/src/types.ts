/** Кому виден навык: никому, только админам, всем. */
export type SkillStatus = "off" | "admins" | "everyone";

export const SKILL_STATUSES: readonly SkillStatus[] = ["off", "admins", "everyone"];

/** Навык: текущая версия и статус. */
export interface Skill {
  /** Короткое уникальное имя, не меняется. */
  name: string;
  /** Когда брать навык: 1–2 фразы, одна строка. */
  whenToUse: string;
  /** Указания в markdown. */
  body: string;
  status: SkillStatus;
  /** Номер текущей версии текста, с 1. */
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

/** Навык без тела: для списка в вопросе модели и на экране, тела не читаются из базы. */
export type SkillBrief = Omit<Skill, "body">;

/** Версия текста навыка: что было после правки. Статус версий не создаёт. */
export interface SkillVersion {
  name: string;
  version: number;
  whenToUse: string;
  body: string;
  author: string;
  createdAt: string;
}

/** Загрузка тела навыка агентом. */
export interface SkillLoad {
  name: string;
  version: number;
  chatId: string;
  ownerId: string;
  /** Ход — id ответа агента. */
  turnId: string;
  loadedAt: string;
}

/** Учёт загрузок навыка: всего и последние. */
export interface SkillLoadStats {
  total: number;
  /** Новые сверху. */
  recent: SkillLoad[];
}

export interface NewSkill {
  name: string;
  whenToUse: string;
  body: string;
  status: SkillStatus;
  author: string;
}

export interface SkillTextEdit {
  whenToUse: string;
  body: string;
  author: string;
  /** Версия, которую правили: другая в базе — `SkillVersionConflictError`. */
  expectedVersion: number;
}

/**
 * Хранилище навыков: память, SQLite, PostgreSQL ведут себя одинаково (общий контрактный тест). Время передаёт
 * вызывающий (`at`, ISO): часы — у службы навыков. Символ NUL в тексте не хранится: запись его убирает.
 */
export interface SkillStore {
  /** Все навыки по имени. */
  list(): Promise<Skill[]>;
  /** Все навыки по имени, без тел. */
  listBrief(): Promise<SkillBrief[]>;
  get(name: string): Promise<Skill | null>;
  /** Новый навык с версией 1. Имя занято — `SkillExistsError`. */
  create(skill: NewSkill, at: string): Promise<Skill>;
  /**
   * Правка текста: новая версия, если текст другой, иначе навык как есть. Нет навыка — `SkillNotFoundError`;
   * версия не та — `SkillVersionConflictError`. Проверка и запись — одним действием базы.
   */
  updateText(name: string, edit: SkillTextEdit, at: string): Promise<Skill>;
  /** Смена статуса без новой версии. Нет навыка — `SkillNotFoundError`. */
  setStatus(name: string, status: SkillStatus, author: string, at: string): Promise<Skill>;
  /** Удаляет навык, его версии и учёт загрузок. Был — `true`. */
  delete(name: string): Promise<boolean>;
  /** Версии навыка, новые сверху. */
  listVersions(name: string): Promise<SkillVersion[]>;
  getVersion(name: string, version: number): Promise<SkillVersion | null>;
  recordLoad(load: SkillLoad): Promise<void>;
  /** Учёт загрузок: всего и `limit` последних. */
  loadStats(name: string, limit: number): Promise<SkillLoadStats>;
  /** Сколько раз загружали каждый навык: имя → число. Навыков без загрузок в ответе нет. */
  loadCounts(): Promise<Record<string, number>>;
}

export class SkillExistsError extends Error {
  constructor(readonly skillName: string) {
    super(`Skill "${skillName}" already exists`);
    this.name = "SkillExistsError";
  }
}

export class SkillNotFoundError extends Error {
  constructor(readonly skillName: string) {
    super(`Skill "${skillName}" not found`);
    this.name = "SkillNotFoundError";
  }
}

export class SkillVersionConflictError extends Error {
  constructor(
    readonly skillName: string,
    readonly currentVersion: number,
  ) {
    super(`Skill "${skillName}" changed: current version is ${currentVersion}`);
    this.name = "SkillVersionConflictError";
  }
}
