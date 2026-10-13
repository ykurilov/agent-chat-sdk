import type { LongTermMemory, MemoryError, MemoryErrorKind, MemoryMergeRevertResult, MemoryNote } from "@ykurilov/agent-chat-core";
import { readJsonBody } from "./request-body";

/** Исход действия с памятью: запись или ошибка-ответ. То же, что у пакета `@ykurilov/agent-chat-memory`. */
export type MemoryResult<T> = { ok: true; value: T } | { ok: false; error: MemoryError };

/** Сколько записей человека, какой предел и сколько из них агент видит в каждом запросе. */
export interface MemoryCounts {
  total: number;
  limit: number;
  shown: number;
}

/** Слияние одного запуска: что стало (`result`) вместо каких записей (`originals`). Как у пакета `@ykurilov/agent-chat-memory`. */
export interface MemoryMergeRecord {
  runId: string;
  finishedAt: string;
  revertible: boolean;
  groups: { result: MemoryNote; originals: MemoryNote[] }[];
}

/**
 * Долгая память вместе с действиями для адресов `/memory`. Даёт пакет `@ykurilov/agent-chat-memory`.
 * `listMerges` и `revertMerge` есть не у всякой памяти: без них адреса `/memory/merges` отвечают 404.
 */
export interface ChatMemory extends LongTermMemory {
  list(ownerId: string): Promise<{ notes: MemoryNote[]; counts: MemoryCounts }>;
  create(ownerId: string, input: unknown): Promise<MemoryResult<MemoryNote>>;
  update(ownerId: string, id: string, version: number, input: unknown): Promise<MemoryResult<MemoryNote>>;
  remove(ownerId: string, id: string, version: number): Promise<MemoryResult<{ deleted: string }>>;
  clear(ownerId: string): Promise<number>;
  listMerges?(ownerId: string, limit?: number): Promise<MemoryMergeRecord[]>;
  revertMerge?(ownerId: string, runId: string): Promise<MemoryMergeRevertResult>;
}

const statusOfKind: Record<MemoryErrorKind, number> = {
  invalid: 400,
  not_found: 404,
  stale_version: 409,
  duplicate: 409,
  limit_reached: 409,
};

const errorResponse = (kind: MemoryErrorKind) => Response.json({ error: { kind } }, { status: statusOfKind[kind] });

/** Запись для экрана: только поля договора, всё служебное хранилища остаётся внутри. */
function publicNote({ id, categories, content, version, createdAt, updatedAt }: MemoryNote): MemoryNote {
  return { id, categories, content, version, createdAt, updatedAt };
}

/** Склейки для экрана: записи только с полями договора (оригиналы без служебного `mergedInto`). */
function publicMerge({ runId, finishedAt, revertible, groups }: MemoryMergeRecord) {
  return {
    runId,
    finishedAt,
    revertible,
    groups: groups.map(({ result, originals }) => ({ result: publicNote(result), originals: originals.map(publicNote) })),
  };
}

const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;

/** @throws RequestBodyTooLargeError тело больше 1 МиБ. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await readJsonBody(request);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Разделы и текст из тела запроса; всё остальное (`id`, `version`, `ownerId`…) до памяти не доходит. */
const noteFrom = (body: Record<string, unknown> | null) => ({ categories: body?.categories, content: body?.content });

/**
 * Всё под `{base}/memory`. `segments` — путь после `memory`. Человек уже определён; память по своей природе
 * его собственная, поэтому чужая запись для сервера — просто «не найдена».
 */
export async function handleMemoryRequest(input: { memory: ChatMemory; request: Request; userId: string; segments: string[] }): Promise<Response> {
  const { memory, request, userId, segments } = input;
  const method = request.method.toUpperCase();
  const [id, ...rest] = segments;
  if (id === "merges") return handleMergesRequest({ memory, method, userId, rest });
  if (rest.length > 0) return errorResponse("not_found");

  if (id === undefined) {
    if (method === "GET") return Response.json(await listForScreen(memory, userId));
    if (method === "POST") {
      const created = await memory.create(userId, noteFrom(await readBody(request)));
      return created.ok ? Response.json({ note: publicNote(created.value) }, { status: 201 }) : errorResponse(created.error.kind);
    }
    if (method === "DELETE") return Response.json({ deleted: await memory.clear(userId) });
    return errorResponse("not_found");
  }

  if (method === "PATCH") {
    const body = await readBody(request);
    if (!isVersion(body?.version)) return errorResponse("invalid");
    const updated = await memory.update(userId, id, body.version, noteFrom(body));
    return updated.ok ? Response.json({ note: publicNote(updated.value) }) : errorResponse(updated.error.kind);
  }

  if (method === "DELETE") {
    const version = Number(new URL(request.url).searchParams.get("version") || Number.NaN);
    if (!isVersion(version)) return errorResponse("invalid");
    const removed = await memory.remove(userId, id, version);
    return removed.ok ? new Response(null, { status: 204 }) : errorResponse(removed.error.kind);
  }

  return errorResponse("not_found");
}

/** `/memory/merges` (список) и `/memory/merges/:runId/revert` (вернуть как было). Память без склеек — 404. */
async function handleMergesRequest(input: { memory: ChatMemory; method: string; userId: string; rest: string[] }): Promise<Response> {
  const { memory, method, userId, rest } = input;
  const { listMerges, revertMerge } = memory;
  if (typeof listMerges !== "function" || typeof revertMerge !== "function") return errorResponse("not_found");

  if (rest.length === 0 && method === "GET") {
    const merges = await listMerges.call(memory, userId);
    return Response.json({ merges: merges.map(publicMerge) });
  }
  const [runId, action, ...extra] = rest;
  if (runId !== undefined && action === "revert" && extra.length === 0 && method === "POST") {
    const result = await revertMerge.call(memory, userId, runId);
    if (result === "ok") return Response.json({ reverted: runId });
    // 409: результат менялся (`conflict`), либо возврат вышел бы за пределы (`limit_reached`) или вернул бы повтор (`duplicate`).
    return result === "not_found" ? errorResponse("not_found") : Response.json({ error: { kind: result } }, { status: 409 });
  }
  return errorResponse("not_found");
}

async function listForScreen(memory: ChatMemory, userId: string) {
  const { notes, counts } = await memory.list(userId);
  return { notes: notes.map(publicNote), counts: { total: counts.total, limit: counts.limit, shown: counts.shown } };
}
