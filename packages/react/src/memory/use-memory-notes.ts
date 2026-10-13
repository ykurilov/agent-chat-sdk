import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryRequestError } from "./memory-client";
import type { MemoryActionResult, MemoryApi, MemoryCounts, MemoryFailure, MemoryMerge, MemoryNote, MemoryNoteInput, MemoryStatus } from "./memory-types";

export interface MemoryNotesState {
  state: MemoryStatus;
  /** Записи в порядке сервера: новейшие первыми. */
  notes: MemoryNote[];
  /** `null`, пока список не загружен. */
  counts: MemoryCounts | null;
  /** Склейки повторов, новейшие первыми; пусто, если их нет или сервер их не отдаёт. */
  merges: MemoryMerge[];
  /** Как закончилось последнее действие, если отказом; следующее действие сбрасывает. */
  error: MemoryFailure | null;
  add(input: MemoryNoteInput): Promise<MemoryActionResult>;
  /** Уходит версия записи из списка. Конфликт версий: список перезагружен, вызывающий держит свои значения и может повторить. */
  edit(id: string, input: MemoryNoteInput): Promise<MemoryActionResult>;
  remove(id: string): Promise<MemoryActionResult>;
  clear(): Promise<MemoryActionResult>;
  /** «Вернуть как было»: оригиналы возвращаются вместо результата, список записей и склеек загружается заново. */
  revertMerge(runId: string): Promise<MemoryActionResult>;
  /** Загружает список заново: после отказа — с экраном загрузки, иначе тихо. */
  reload(): void;
}

const knownKinds = new Set<string>(["not_found", "stale_version", "limit_reached", "duplicate", "invalid", "conflict"]);

/** Отказ действия по ответу сервера. 404 без `not_found` в теле — адреса памяти нет совсем. */
function failureOf(error: unknown): MemoryFailure {
  if (!(error instanceof MemoryRequestError)) return "other";
  if (error.kind !== undefined && knownKinds.has(error.kind)) return error.kind as MemoryFailure;
  return error.status === 404 ? "unavailable" : "other";
}

/** Состояние экрана памяти: загрузка, добавление, правка, удаление, стирание. Ничего не рисует. */
export function useMemoryNotes(api: MemoryApi): MemoryNotesState {
  const [status, setStatus] = useState<MemoryStatus>("loading");
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [counts, setCounts] = useState<MemoryCounts | null>(null);
  const [merges, setMerges] = useState<MemoryMerge[]>([]);
  const [error, setError] = useState<MemoryFailure | null>(null);

  const apiRef = useRef(api);
  apiRef.current = api;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const statusRef = useRef(status);
  statusRef.current = status;
  const countsRef = useRef(counts);
  countsRef.current = counts;
  /** Номер последнего запроса списка: ответ более раннего не затирает свежий. */
  const listRequest = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const show = useCallback((next: MemoryNote[], nextCounts: MemoryCounts | null) => {
    notesRef.current = next;
    setNotes(next);
    setCounts(nextCounts);
    setStatus(next.length === 0 ? "empty" : "ready");
  }, []);

  /** `quiet`: список уже на экране, экран загрузки не нужен, отказ не ломает то, что показано. */
  const load = useCallback(
    async (quiet: boolean) => {
      const request = ++listRequest.current;
      if (!quiet) setStatus("loading");
      try {
        // Склейки — дополнение к списку: их сбой (или сервер без склеек) записи не ломает, прежние склейки остаются.
        const [loaded, loadedMerges] = await Promise.all([apiRef.current.list(), apiRef.current.listMerges().catch(() => null)]);
        if (!alive.current || request !== listRequest.current) return;
        show(loaded.notes, loaded.counts);
        if (loadedMerges) setMerges(loadedMerges);
      } catch (failure) {
        if (!alive.current || request !== listRequest.current || quiet) return;
        setStatus(failureOf(failure) === "unavailable" ? "unavailable" : "error");
      }
    },
    [show],
  );

  useEffect(() => {
    void load(false);
  }, [api, load]);

  const reload = useCallback(() => {
    void load(statusRef.current === "ready" || statusRef.current === "empty");
  }, [load]);

  /** Действие с отказом: его причина остаётся в `error`; при конфликте список заново. */
  const refuse = useCallback(
    async (failure: MemoryFailure): Promise<MemoryActionResult> => {
      if (failure === "stale_version" || failure === "not_found" || failure === "conflict") await load(true);
      if (alive.current) setError(failure);
      return { ok: false, failure };
    },
    [load],
  );

  const succeed = useCallback(
    (next: MemoryNote[]): MemoryActionResult => {
      show(next, countsRef.current === null ? null : { ...countsRef.current, total: next.length });
      // Счётчик «показано агенту» считает сервер: тихо спрашиваем его после изменения.
      void load(true);
      return { ok: true };
    },
    [load, show],
  );

  const add = useCallback(
    async (input: MemoryNoteInput): Promise<MemoryActionResult> => {
      setError(null);
      try {
        const created = await apiRef.current.create(input);
        return alive.current ? succeed([created, ...notesRef.current]) : { ok: true };
      } catch (failure) {
        return refuse(failureOf(failure));
      }
    },
    [refuse, succeed],
  );

  const edit = useCallback(
    async (id: string, input: MemoryNoteInput): Promise<MemoryActionResult> => {
      setError(null);
      const current = notesRef.current.find((item) => item.id === id);
      if (!current) return refuse("not_found");
      try {
        const saved = await apiRef.current.update(id, current.version, input);
        return alive.current ? succeed([saved, ...notesRef.current.filter((item) => item.id !== id)]) : { ok: true };
      } catch (failure) {
        return refuse(failureOf(failure));
      }
    },
    [refuse, succeed],
  );

  const remove = useCallback(
    async (id: string): Promise<MemoryActionResult> => {
      setError(null);
      const current = notesRef.current.find((item) => item.id === id);
      if (!current) return refuse("not_found");
      try {
        await apiRef.current.remove(id, current.version);
      } catch (failure) {
        const kind = failureOf(failure);
        // Записи уже нет — человек этого и хотел.
        if (kind !== "not_found") return refuse(kind);
      }
      return alive.current ? succeed(notesRef.current.filter((item) => item.id !== id)) : { ok: true };
    },
    [refuse, succeed],
  );

  const clear = useCallback(async (): Promise<MemoryActionResult> => {
    setError(null);
    try {
      await apiRef.current.clear();
    } catch (failure) {
      return refuse(failureOf(failure));
    }
    return alive.current ? succeed([]) : { ok: true };
  }, [refuse, succeed]);

  const revertMerge = useCallback(
    async (runId: string): Promise<MemoryActionResult> => {
      setError(null);
      try {
        await apiRef.current.revertMerge(runId);
      } catch (failure) {
        return refuse(failureOf(failure));
      }
      if (!alive.current) return { ok: true };
      await load(true);
      return { ok: true };
    },
    [load, refuse],
  );

  return { state: status, notes, counts, merges, error, add, edit, remove, clear, revertMerge, reload };
}
