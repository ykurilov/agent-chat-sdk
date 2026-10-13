import { vi } from "vitest";

export interface FakeNote {
  id: string;
  categories: string[];
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type MemoryEndpoint = "list" | "create" | "update" | "delete" | "clear" | "merges" | "revert";

/** Слияние для начального состояния: результат «стало» и оригиналы «было». */
export interface FakeMerge {
  runId: string;
  finishedAt: string;
  revertible: boolean;
  groups: { result: FakeNote; originals: FakeNote[] }[];
}

/** Запись для начального состояния: всё, кроме разделов и текста, выдумывается. */
export const note = (id: string, categories: string[], content: string, version = 1): FakeNote => ({
  id,
  categories,
  content,
  version,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
});

/**
 * Подменённый `fetch` сервера памяти по договору адресов (`contracts/memory.md`, раздел 3): `GET/POST {base}/memory`,
 * `PATCH/DELETE {base}/memory/{id}`, `DELETE {base}/memory`. Ошибки — `{ error: { kind } }` с кодами договора.
 * `state.off` — память в приложении не включена (все адреса 404 без тела); `state.fail` — адреса, отвечающие 500;
 * `state.down` — сервер не отвечает; `state.limit` и `state.shown` — счётчики ответа списка. Склейки повторов:
 * `GET {base}/memory/merges` и `POST {base}/memory/merges/{runId}/revert` (ок — оригиналы возвращаются вместо результатов,
 * `revertible: false` — 409 `conflict`, `state.revertRefusal` — 409 с этим кодом, чужой запуск — 404 `not_found`); `state.noMerges` — сервер старый, этих адресов
 * у него нет (404 без тела).
 */
export function fakeMemoryServer(initial: FakeNote[] = [], initialMerges: FakeMerge[] = []) {
  const state = {
    off: false,
    down: false,
    notes: initial.map((item) => ({ ...item })),
    merges: structuredClone(initialMerges),
    noMerges: false,
    /** Сервер отказывает вернуть слияние: память заполнена или вернулся бы повтор записи (409 с этим кодом). */
    revertRefusal: undefined as "limit_reached" | "duplicate" | undefined,
    fail: new Set<MemoryEndpoint>(),
    limit: 200,
    /** Сколько записей попадает в запрос агента; `undefined` — все. */
    shown: undefined as number | undefined,
    created: 0,
    clock: 0,
  };
  const requests: Array<{ method: string; path: string; search: string; body: unknown }> = [];
  const now = () => new Date(Date.UTC(2026, 8, 2, 12, 0, state.clock++)).toISOString();
  const error = (kind: string, status: number) => Response.json({ error: { kind } }, { status });
  const counts = () => ({
    total: state.notes.length,
    limit: state.limit,
    shown: Math.min(state.notes.length, state.shown ?? state.notes.length),
  });
  const sorted = () => [...state.notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://test.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    requests.push({ method, path: url.pathname, search: url.search, body });
    if (state.down) throw new TypeError("Failed to fetch");
    const [, , , memory, rawId, mergeRun, mergeAction] = url.pathname.split("/");
    const id = rawId === undefined ? undefined : decodeURIComponent(rawId);
    if (memory !== "memory") return new Response(null, { status: 404 });
    if (state.off) return new Response(null, { status: 404 });
    if (id === "merges") {
      if (state.noMerges) return new Response(null, { status: 404 });
      const revert = mergeRun !== undefined && mergeAction === "revert";
      if (state.fail.has(revert ? "revert" : "merges")) return error("other", 500);
      if (!revert) return Response.json({ merges: state.merges });
      const merge = state.merges.find((item) => item.runId === decodeURIComponent(mergeRun));
      if (!merge) return error("not_found", 404);
      if (!merge.revertible) return error("conflict", 409);
      if (state.revertRefusal) return error(state.revertRefusal, 409);
      const resultIds = new Set(merge.groups.map((group) => group.result.id));
      state.notes = [...state.notes.filter((item) => !resultIds.has(item.id)), ...merge.groups.flatMap((group) => group.originals)];
      state.merges = state.merges.filter((item) => item !== merge);
      return Response.json({ reverted: merge.runId });
    }
    const endpoint: MemoryEndpoint =
      id === undefined ? (method === "GET" ? "list" : method === "POST" ? "create" : "clear") : method === "PATCH" ? "update" : "delete";
    if (state.fail.has(endpoint)) return error("other", 500);

    if (endpoint === "list") return Response.json({ notes: sorted(), counts: counts() });
    if (endpoint === "clear") {
      const deleted = state.notes.length;
      state.notes = [];
      return Response.json({ deleted });
    }
    if (endpoint === "create") {
      const fields = checkFields(body);
      if (!fields) return error("invalid", 400);
      if (state.notes.some((item) => sameNote(item, fields))) return error("duplicate", 409);
      if (state.notes.length >= state.limit) return error("limit_reached", 409);
      state.created += 1;
      const stamp = now();
      const created: FakeNote = { id: `n${state.created}`, ...fields, version: 1, createdAt: stamp, updatedAt: stamp };
      state.notes.push(created);
      return Response.json({ note: created }, { status: 201 });
    }
    const target = state.notes.find((item) => item.id === id);
    if (endpoint === "update") {
      if (!target) return error("not_found", 404);
      const fields = checkFields(body);
      if (!fields || typeof body?.version !== "number") return error("invalid", 400);
      if (body.version !== target.version) return error("stale_version", 409);
      if (state.notes.some((item) => item.id !== id && sameNote(item, fields))) return error("duplicate", 409);
      Object.assign(target, fields, { version: target.version + 1, updatedAt: now() });
      return Response.json({ note: target });
    }
    if (!target) return error("not_found", 404);
    if (Number(url.searchParams.get("version")) !== target.version) return error("stale_version", 409);
    state.notes = state.notes.filter((item) => item.id !== id);
    return new Response(null, { status: 204 });
  });

  return {
    fetch,
    state,
    requests,
    /** Запросы к серверу памяти по методу. */
    requestsOf: (method: string) => requests.filter((request) => request.method === method),
    /** Запись поменялась «в другом месте»: версия растёт, как при правке. */
    editElsewhere(id: string, content: string) {
      const target = state.notes.find((item) => item.id === id)!;
      Object.assign(target, { content, version: target.version + 1, updatedAt: now() });
    },
    removeElsewhere(id: string) {
      state.notes = state.notes.filter((item) => item.id !== id);
    },
  };
}

function checkFields(body: Record<string, unknown> | undefined): { categories: string[]; content: string } | null {
  const categories = body?.categories;
  const content = body?.content;
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > 3) return null;
  if (!categories.every((item) => typeof item === "string" && item.trim() !== "")) return null;
  if (typeof content !== "string" || content.trim() === "") return null;
  return { categories: categories as string[], content };
}

const sameNote = (a: { categories: string[]; content: string }, b: { categories: string[]; content: string }) =>
  a.categories.join("/").toLowerCase() === b.categories.join("/").toLowerCase() && a.content.toLowerCase() === b.content.toLowerCase();
