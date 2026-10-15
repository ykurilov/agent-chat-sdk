import type { Skill, SkillLoadStats, SkillStatus, SkillVersion } from "../types";

type Fetch = typeof globalThis.fetch;

export const DEFAULT_SKILLS_BASE_PATH = "/api/skills";

/** Навык в списке: без тела, с числом загрузок. */
export type SkillListEntry = Omit<Skill, "body"> & { loads: number };

/** Сервер отказал: `status` — код ответа, `kind` — вид ошибки, `reason` — причина ошибки проверки, `currentVersion` — при гонке. */
export class SkillsRequestError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string | null,
    readonly reason: string | null,
    readonly currentVersion: number | null,
  ) {
    super(`Skills request failed: HTTP ${status}${kind ? ` ${kind}` : ""}`);
    this.name = "SkillsRequestError";
  }
}

export interface SkillsClient {
  list(): Promise<SkillListEntry[]>;
  get(name: string): Promise<{ skill: Skill; loads: SkillLoadStats }>;
  create(input: { name: string; whenToUse: string; body: string; status: SkillStatus }): Promise<Skill>;
  update(name: string, edit: { whenToUse: string; body: string; expectedVersion: number }): Promise<Skill>;
  setStatus(name: string, status: SkillStatus): Promise<Skill>;
  versions(name: string): Promise<SkillVersion[]>;
  rollback(name: string, version: number, expectedVersion: number): Promise<Skill>;
  remove(name: string): Promise<void>;
}

export function createSkillsClient({ basePath = DEFAULT_SKILLS_BASE_PATH, fetch: fetchImpl = (...args) => globalThis.fetch(...args) }: { basePath?: string; fetch?: Fetch } = {}): SkillsClient {
  const base = basePath.replace(/\/+$/, "");
  const skill = (name: string) => `${base}/${encodeURIComponent(name)}`;

  async function send<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
    const response = await fetchImpl(url, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      ...(init?.body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null))?.error ?? {};
      throw new SkillsRequestError(response.status, error.kind ?? null, error.reason ?? null, error.currentVersion ?? null);
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  return {
    list: async () => (await send<{ skills: SkillListEntry[] }>(base)).skills,
    get: (name) => send(skill(name)),
    create: async (input) => (await send<{ skill: Skill }>(base, { method: "POST", body: input })).skill,
    update: async (name, edit) => (await send<{ skill: Skill }>(skill(name), { method: "PUT", body: edit })).skill,
    setStatus: async (name, status) => (await send<{ skill: Skill }>(`${skill(name)}/status`, { method: "PUT", body: { status } })).skill,
    versions: async (name) => (await send<{ versions: SkillVersion[] }>(`${skill(name)}/versions`)).versions,
    rollback: async (name, version, expectedVersion) =>
      (await send<{ skill: Skill }>(`${skill(name)}/rollback`, { method: "POST", body: { version, expectedVersion } })).skill,
    remove: (name) => send(skill(name), { method: "DELETE" }),
  };
}
