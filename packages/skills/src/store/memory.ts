import { SkillExistsError, SkillNotFoundError, SkillVersionConflictError } from "../types";
import type { Skill, SkillLoad, SkillStore, SkillVersion } from "../types";
import { brief, byName, sameText, storedText } from "./skill-store";

/** Навыки в памяти процесса: для тестов и проб, живут до перезапуска. */
export function memorySkillStore(): SkillStore {
  const skills = new Map<string, Skill>();
  const versions = new Map<string, SkillVersion[]>();
  let loads: SkillLoad[] = [];

  const existing = (name: string): Skill => {
    const skill = skills.get(name);
    if (!skill) throw new SkillNotFoundError(name);
    return skill;
  };

  return {
    async list() {
      return [...skills.values()].sort(byName).map((skill) => ({ ...skill }));
    },
    async listBrief() {
      return [...skills.values()].sort(byName).map(brief);
    },
    async get(name) {
      const skill = skills.get(name);
      return skill ? { ...skill } : null;
    },
    async create(input, at) {
      if (skills.has(input.name)) throw new SkillExistsError(input.name);
      const skill: Skill = {
        name: input.name,
        ...storedText(input),
        status: input.status,
        version: 1,
        createdBy: input.author,
        createdAt: at,
        updatedBy: input.author,
        updatedAt: at,
      };
      skills.set(skill.name, skill);
      versions.set(skill.name, [{ name: skill.name, version: 1, whenToUse: skill.whenToUse, body: skill.body, author: input.author, createdAt: at }]);
      return { ...skill };
    },
    async updateText(name, edit, at) {
      const skill = existing(name);
      if (skill.version !== edit.expectedVersion) throw new SkillVersionConflictError(name, skill.version);
      const text = storedText(edit);
      if (sameText(skill, text)) return { ...skill };
      const next: Skill = { ...skill, ...text, version: skill.version + 1, updatedBy: edit.author, updatedAt: at };
      skills.set(name, next);
      versions.get(name)!.push({ name, version: next.version, whenToUse: next.whenToUse, body: next.body, author: edit.author, createdAt: at });
      return { ...next };
    },
    async setStatus(name, status, author, at) {
      const next: Skill = { ...existing(name), status, updatedBy: author, updatedAt: at };
      skills.set(name, next);
      return { ...next };
    },
    async delete(name) {
      const had = skills.delete(name);
      versions.delete(name);
      loads = loads.filter((load) => load.name !== name);
      return had;
    },
    async listVersions(name) {
      return [...(versions.get(name) ?? [])].reverse().map((version) => ({ ...version }));
    },
    async getVersion(name, version) {
      const found = versions.get(name)?.find((candidate) => candidate.version === version);
      return found ? { ...found } : null;
    },
    async recordLoad(load) {
      loads.push({ ...load });
    },
    async loadStats(name, limit) {
      const own = loads.filter((load) => load.name === name);
      const recent = [...own].sort((left, right) => (left.loadedAt < right.loadedAt ? 1 : left.loadedAt > right.loadedAt ? -1 : 0)).slice(0, limit);
      return { total: own.length, recent: recent.map((load) => ({ ...load })) };
    },
    async loadCounts() {
      const counts: Record<string, number> = {};
      for (const load of loads) counts[load.name] = (counts[load.name] ?? 0) + 1;
      return counts;
    },
  };
}
