import type { MemoryApi, MemoryCounts, MemoryMerge, MemoryNote, MemoryNoteInput } from "./memory-types";

type Fetch = typeof globalThis.fetch;

/** Сервер ответил отказом; `status` — код ответа, `kind` — `error.kind` из тела, если оно было (404 без тела — памяти нет). */
export class MemoryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string | undefined,
    action: string,
  ) {
    super(`Memory request failed (${action}): HTTP ${status}${kind ? ` ${kind}` : ""}`);
    this.name = "MemoryRequestError";
  }
}

const jsonBody = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function readKind(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { kind?: unknown } };
    return typeof body.error?.kind === "string" ? body.error.kind : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Клиент адресов памяти сервера: `GET/POST {api}/memory`, `PATCH/DELETE {api}/memory/{id}`, `DELETE {api}/memory`,
 * склейки повторов — `GET {api}/memory/merges` и `POST {api}/memory/merges/{runId}/revert`.
 * `api` — тот же адрес обработчика чата, например `/api/chat`. Вызывайте один раз (например, в `useMemo`):
 * экран загружает список заново при смене объекта.
 */
export function createMemoryApi({ api, fetch: customFetch }: { api: string; fetch?: Fetch }): MemoryApi {
  const base = `${api.replace(/\/+$/, "")}/memory`;
  const noteUrl = (id: string) => `${base}/${encodeURIComponent(id)}`;

  async function request(action: string, url: string, init?: RequestInit): Promise<Response> {
    const response = await (customFetch ?? globalThis.fetch)(url, init);
    if (!response.ok) throw new MemoryRequestError(response.status, await readKind(response), action);
    return response;
  }

  return {
    async list() {
      const response = await request("list", base);
      return (await response.json()) as { notes: MemoryNote[]; counts: MemoryCounts };
    },
    async create(input: MemoryNoteInput) {
      const response = await request("create", base, { method: "POST", ...jsonBody(input) });
      return ((await response.json()) as { note: MemoryNote }).note;
    },
    async update(id, version, input) {
      const response = await request("update", noteUrl(id), { method: "PATCH", ...jsonBody({ ...input, version }) });
      return ((await response.json()) as { note: MemoryNote }).note;
    },
    async remove(id, version) {
      await request("remove", `${noteUrl(id)}?version=${version}`, { method: "DELETE" });
    },
    async clear() {
      const response = await request("clear", base, { method: "DELETE" });
      return ((await response.json()) as { deleted: number }).deleted;
    },
    async listMerges() {
      const response = await request("listMerges", `${base}/merges`);
      return ((await response.json()) as { merges?: MemoryMerge[] }).merges ?? [];
    },
    async revertMerge(runId) {
      await request("revertMerge", `${base}/merges/${encodeURIComponent(runId)}/revert`, { method: "POST" });
    },
  };
}
