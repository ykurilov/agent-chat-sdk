import { checkSkillName, checkSkillStatus, checkSkillText } from "./skill-rules";
import { SkillNotFoundError } from "./types";
import type { Skill, SkillBrief, SkillLoadStats, SkillStatus, SkillStore, SkillVersion } from "./types";

/** Сколько последних загрузок показывает карточка навыка. */
export const RECENT_LOADS_LIMIT = 20;

export interface SkillSummary extends SkillBrief {
  /** Сколько раз тело загружали в чатах. */
  loads: number;
}

export interface SkillsManager {
  list(): Promise<SkillSummary[]>;
  /** Навык и учёт загрузок; нет — `null`. */
  get(name: string): Promise<{ skill: Skill; loads: SkillLoadStats } | null>;
  create(input: { name: string; whenToUse: string; body: string; status?: string }, author: string): Promise<Skill>;
  updateText(name: string, edit: { whenToUse: string; body: string; expectedVersion: number }, author: string): Promise<Skill>;
  setStatus(name: string, status: string, author: string): Promise<Skill>;
  versions(name: string): Promise<SkillVersion[]>;
  /** Откат — новая версия с текстом старой; текст проверяется нынешними правилами; история не переписывается. */
  rollback(name: string, version: number, expectedVersion: number, author: string): Promise<Skill>;
  delete(name: string): Promise<boolean>;
}

export function createSkillsManager({ store, maxBodyChars, now }: { store: SkillStore; maxBodyChars: number; now: () => Date }): SkillsManager {
  const at = () => now().toISOString();
  return {
    async list() {
      const [skills, counts] = await Promise.all([store.listBrief(), store.loadCounts()]);
      return skills.map((skill) => ({ ...skill, loads: counts[skill.name] ?? 0 }));
    },
    async get(name) {
      const skill = await store.get(name);
      return skill ? { skill, loads: await store.loadStats(name, RECENT_LOADS_LIMIT) } : null;
    },
    async create(input, author) {
      checkSkillName(input.name);
      const status: SkillStatus = input.status === undefined ? "off" : checkSkillStatus(input.status);
      return store.create({ name: input.name, ...checkSkillText(input, maxBodyChars), status, author }, at());
    },
    async updateText(name, edit, author) {
      return store.updateText(name, { ...checkSkillText(edit, maxBodyChars), author, expectedVersion: edit.expectedVersion }, at());
    },
    async setStatus(name, status, author) {
      return store.setStatus(name, checkSkillStatus(status), author, at());
    },
    versions: (name) => store.listVersions(name),
    async rollback(name, version, expectedVersion, author) {
      const old = await store.getVersion(name, version);
      if (!old) throw new SkillNotFoundError(name);
      return store.updateText(name, { ...checkSkillText(old, maxBodyChars), author, expectedVersion }, at());
    },
    delete: (name) => store.delete(name),
  };
}
